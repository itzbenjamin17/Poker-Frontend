import type {
    AuthResponse,
    GameEndResult,
    GameState,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
    PokerAction,
    RoomState,
    RoomUpdate,
    SessionSnapshot,
    WsStatus,
} from '../types';
import {
    isGameStatePayload,
    isGameEndPayload,
    isPrivateStatePayload,
    isRoomUpdatePayload,
    normalizeErrorMessage,
} from '../lib/payloads';
import {
    HOST_LEFT,
    GAME_FINISHED_FALLBACK,
    RAISE_ERROR_FORBIDDEN_BET,
    SESSION_EXPIRED,
    STATUS_RETURNING,
} from '../constants/strings';
import { logger } from '../security/logger';
import { SystemClock, type Clock, type TimerHandle } from './clock';
import type { GameTransport, TransportStatus, TransportSubscription } from '../services/transport';

const SHOWDOWN_FALLBACK_HIDE_MS = 65_000;
const ROOM_CLOSED_REDIRECT_MS = 3_000;
const ACTION_LOCK_TIMEOUT_MS = 3_000;

export interface GameSessionOptions {
    auth: AuthResponse;
    transport: GameTransport;
    clock?: Clock;
    initialRoomState?: RoomState | null;
    initialGameState?: GameState | null;
    initialGameEndResult?: GameEndResult | null;
    onLeave?: () => void;
}

export class GameSession {
    private readonly auth: AuthResponse;
    private transport: GameTransport;
    private readonly clock: Clock;
    private onLeave?: () => void;

    private listeners = new Set<() => void>();
    private connectListeners = new Set<() => void>();
    private socketErrorListeners = new Set<(message: string) => void>();
    private subscriptions: TransportSubscription[] = [];
    private unsubStatus?: () => void;
    private unsubError?: () => void;
    private lastStateSyncTime = 0;

    private actionTimeoutTimers = new Map<string, TimerHandle>();
    private notificationTimer: TimerHandle | null = null;
    private showdownTimer: TimerHandle | null = null;
    private showdownResultTimer: TimerHandle | null = null;
    private redirectTimer: TimerHandle | null = null;

    private snapshot: SessionSnapshot;

    constructor(options: GameSessionOptions) {
        this.auth = options.auth;
        this.transport = options.transport;
        this.clock = options.clock ?? new SystemClock();
        this.onLeave = options.onLeave;

        const initialRoom: RoomState = options.initialRoomState ?? {
            roomId: options.auth.roomId,
            roomName: '',
            players: [{ name: options.auth.playerName, isHost: false }],
            gameStarted: false,
        };

        const isGameOver = Boolean(options.initialGameEndResult);

        this.snapshot = Object.freeze({
            roomState: initialRoom,
            gameState: options.initialGameState ?? options.initialGameEndResult?.finalState ?? null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            notification: null,
            loadingStatus: 'Connecting...',
            myPlayerId: null,
            claimPending: false,
            wsStatus: 'disconnected' as WsStatus,
            isHydrated: false,
            isGameOver,
            gameEndResult: options.initialGameEndResult ?? null,
            pendingActions: new Set<string>(),
            error: null,
        });
    }

    public setOnLeave = (onLeave?: () => void): void => {
        this.onLeave = onLeave;
    };

    public getSnapshot = (): SessionSnapshot => {
        return this.snapshot;
    };

    public getTransport = (): GameTransport => {
        return this.transport;
    };

    public getLastStateSyncTime = (): number => {
        return this.lastStateSyncTime;
    };

    public now = (): number => {
        return this.clock.now();
    };

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    public onConnect = (listener: () => void): (() => void) => {
        this.connectListeners.add(listener);
        return () => {
            this.connectListeners.delete(listener);
        };
    };

    public onSocketError = (listener: (message: string) => void): (() => void) => {
        this.socketErrorListeners.add(listener);
        return () => {
            this.socketErrorListeners.delete(listener);
        };
    };

    private updateSnapshot(updater: (prev: SessionSnapshot) => Partial<SessionSnapshot>): void {
        const partial = updater(this.snapshot);
        let hasChanges = false;
        for (const key of Object.keys(partial) as Array<keyof SessionSnapshot>) {
            if (this.snapshot[key] !== partial[key]) {
                hasChanges = true;
                break;
            }
        }
        if (!hasChanges) return;

        this.snapshot = Object.freeze({
            ...this.snapshot,
            ...partial,
        });

        for (const listener of this.listeners) {
            listener();
        }
    }

    // ── Transport Lifecycle & Subscriptions ───────────────────────────────────────

    private cleanupSubscriptions(): void {
        for (const sub of this.subscriptions) {
            sub.unsubscribe();
        }
        this.subscriptions = [];

        this.unsubStatus?.();
        this.unsubStatus = undefined;
        this.unsubError?.();
        this.unsubError = undefined;
    }

    public connect(transportOverride?: GameTransport): void {
        if (transportOverride && transportOverride !== this.transport) {
            this.transport = transportOverride;
        }

        this.cleanupSubscriptions();

        this.unsubStatus = this.transport.onStatusChange((status: TransportStatus) => {
            this.handleStatusChange(status);
        });

        if (this.transport.onError) {
            this.unsubError = this.transport.onError((errorMsg: string) => {
                this.handleTransportError(errorMsg);
            });
        }

        const subPrivate = this.transport.subscribe('/user/queue/private', (body: string) => {
            this.handlePrivateMessage(body);
        });
        const subRoom = this.transport.subscribe(`/room/${this.auth.roomId}`, (body: string) => {
            this.handleRoomMessage(body);
        });
        const subGame = this.transport.subscribe(`/game/${this.auth.roomId}`, (body: string) => {
            this.handleGameMessage(body);
        });

        this.subscriptions.push(subPrivate, subRoom, subGame);
        this.transport.connect();
    }

    public disconnect(): void {
        this.cancelActionLocks();
        this.clearShowdownTimers();
        this.clearNotificationTimer();
        this.clearRedirectTimer();
        this.cleanupSubscriptions();

        this.updateSnapshot(() => ({
            wsStatus: 'disconnected',
        }));

        this.transport.disconnect();
    }

    // ── Status & Error Handlers ───────────────────────────────────────────────────

    private handleStatusChange(status: TransportStatus): void {
        if (this.snapshot.isGameOver && status === 'reconnecting') return;

        // Disconnections immediately cancel in-flight action locks
        if (status === 'disconnected' || status === 'reconnecting') {
            this.cancelActionLocks();
        }

        this.updateSnapshot(() => ({
            wsStatus: status,
        }));

        if (status === 'connected') {
            for (const listener of this.connectListeners) {
                listener();
            }
        }
    }

    private handleTransportError(errorMsg: string): void {
        if (this.snapshot.isGameOver) return;

        this.updateSnapshot(() => ({
            wsStatus: 'reconnecting',
        }));

        this.handleActionError(errorMsg);
    }

    // ── Message Handlers ──────────────────────────────────────────────────────────

    private handlePrivateMessage(body: string): void {
        try {
            const parsed = JSON.parse(body);

            if (parsed.type === 'ACTION_ERROR' && typeof parsed.message === 'string') {
                this.handleActionError(parsed.message);
                return;
            }

            if (isPrivateStatePayload(parsed)) {
                this.applyPrivateState(parsed);
            }
        } catch (err) {
            logger.warn('Ignoring malformed private payload:', body, err);
        }
    }

    public handleActionError(message: string): void {
        this.cancelActionLocks();

        if (/game not found|room not found|no longer part of this game/i.test(message)) {
            this.scheduleRedirect(SESSION_EXPIRED);
            for (const listener of this.socketErrorListeners) {
                listener(message);
            }
            return;
        }

        const normalized = normalizeErrorMessage(message) || 'Error occurred';
        const isBetRaiseError = /bet|raise|insufficient|amount|chip/i.test(message);

        if (isBetRaiseError) {
            this.updateSnapshot(() => ({
                error: { message: normalized },
            }));
            this.setNotification(RAISE_ERROR_FORBIDDEN_BET);
        } else {
            this.setNotification(normalized);
        }

        for (const listener of this.socketErrorListeners) {
            listener(message);
        }
    }

    public scheduleRedirect(message: string): void {
        if (this.snapshot.isGameOver) return;
        const cleanMsg = normalizeErrorMessage(message);
        this.clearNotificationTimer();
        this.updateSnapshot(() => ({
            notification: cleanMsg,
            loadingStatus: cleanMsg || STATUS_RETURNING,
        }));
        this.clearRedirectTimer();
        this.redirectTimer = this.clock.setTimeout(() => {
            this.onLeave?.();
        }, ROOM_CLOSED_REDIRECT_MS);
    }

    private handleRoomMessage(body: string): void {
        try {
            const parsed: unknown = JSON.parse(body);
            if (!isRoomUpdatePayload(parsed)) {
                logger.warn('Ignoring invalid room update payload:', body);
                return;
            }
            const update: RoomUpdate = parsed;

            if (update.message === 'ROOM_CLOSED') {
                if (this.snapshot.isGameOver) return;
                this.updateSnapshot(() => ({
                    roomState: null,
                }));
                this.scheduleRedirect(HOST_LEFT);
                return;
            }

            if (
                update.message === 'ROOM_CREATED' ||
                update.message === 'PLAYER_JOINED' ||
                update.message === 'PLAYER_LEFT'
            ) {
                this.updateSnapshot((prev) => ({
                    roomState: {
                        roomId: update.data.roomId ?? prev.roomState?.roomId ?? this.auth.roomId,
                        roomName: update.data.roomName ?? prev.roomState?.roomName,
                        players: update.data.players,
                        maxPlayers: update.data.maxPlayers ?? prev.roomState?.maxPlayers,
                        buyIn: update.data.buyIn ?? prev.roomState?.buyIn,
                        smallBlind: update.data.smallBlind ?? prev.roomState?.smallBlind,
                        bigBlind: update.data.bigBlind ?? prev.roomState?.bigBlind,
                        canStartGame: update.data.canStartGame ?? prev.roomState?.canStartGame,
                        gameStarted: update.data.gameStarted ?? prev.roomState?.gameStarted,
                    },
                }));
            }
        } catch (err) {
            logger.warn('Ignoring malformed room update payload:', body, err);
        }
    }

    private handleGameMessage(body: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch (err) {
            logger.warn('Ignoring malformed game payload:', body, err);
            return;
        }

        if (!parsed || typeof parsed !== 'object') return;
        const p = parsed as Record<string, unknown>;

        const messageType = typeof p.type === 'string' ? p.type : null;
        const messageText = typeof p.message === 'string' ? p.message : null;

        if (isGameEndPayload(parsed)) {
            this.handleGameEnd(parsed);
            return;
        }

        if (
            messageType === 'PLAYER_NOTIFICATION' ||
            messageType === 'AUTO_ADVANCE_START' ||
            messageType === 'AUTO_ADVANCE_COMPLETE'
        ) {
            const cleanNotification = messageText?.trim();
            if (cleanNotification) {
                this.setNotification(cleanNotification);
            }
            return;
        }

        if (!isGameStatePayload(parsed)) {
            logger.warn('Ignoring non-game payload on game topic:', { keys: Object.keys(p) });
            return;
        }

        if (this.snapshot.isGameOver) return;

        this.lastStateSyncTime = this.clock.now();
        this.applyGameState(parsed);
    }

    private handleGameEnd(payload: {
        winner?: string | null;
        winnerChips?: number | null;
        isForfeit?: boolean;
        message?: string | null;
        finalState?: unknown;
    }): void {
        if (this.snapshot.isGameOver) return;

        this.cancelActionLocks();
        this.clearRedirectTimer();
        this.clearShowdownTimers();
        this.clearNotificationTimer();

        const endMsg = normalizeErrorMessage(payload.message ?? GAME_FINISHED_FALLBACK);
        const winnerName = typeof payload.winner === 'string' ? payload.winner : null;
        const isForfeit = payload.isForfeit === true;

        let finalGameState: GameState | undefined = undefined;
        if (payload.finalState && isGameStatePayload(payload.finalState)) {
            const fs = payload.finalState;
            let pot = fs.pot;
            let pots = fs.pots ?? undefined;
            if (fs.phase === 'SHOWDOWN' && fs.pot === 0 && this.snapshot.gameState && this.snapshot.gameState.pot > 0) {
                pot = this.snapshot.gameState.pot;
                pots = this.snapshot.gameState.pots;
            }
            finalGameState = {
                ...fs,
                gameId: fs.gameId ?? this.auth.roomId,
                pot,
                pots,
                claimWinAvailable: fs.claimWinAvailable ?? undefined,
                claimWinPlayerName: fs.claimWinPlayerName ?? undefined,
                uncalledAmount: fs.uncalledAmount ?? undefined,
                isReadyCountdownActive: fs.isReadyCountdownActive ?? undefined,
                readyCountdownDeadlineEpochMs: fs.readyCountdownDeadlineEpochMs ?? undefined,
            };
        }

        const stateForWinner = finalGameState ?? this.snapshot.gameState;
        const fallbackWinnerChips = winnerName
            ? stateForWinner?.players.find((p) => p.name === winnerName)?.chips
            : undefined;
        const winnerChips =
            typeof payload.winnerChips === 'number' ? payload.winnerChips : fallbackWinnerChips;

        const gameEndResult: GameEndResult = {
            winnerName,
            winnerChips,
            isForfeit,
            message: endMsg || GAME_FINISHED_FALLBACK,
            finalState: finalGameState,
        };

        this.updateSnapshot(() => ({
            isGameOver: true,
            gameEndResult,
            gameState: finalGameState ?? this.snapshot.gameState,
            showdown: null,
            showdownResult: null,
            notification: null,
        }));
    }

    // ── Public State Mutation Methods ─────────────────────────────────────────────

    public applyGameState(payload: IncomingGameStatePayload, syncTime?: number): void {
        if (this.snapshot.isGameOver) return;

        if (typeof syncTime === 'number' && syncTime > this.lastStateSyncTime) {
            this.lastStateSyncTime = syncTime;
        }

        // Any incoming game state clears in-flight action locks
        this.cancelActionLocks();

        const incomingData: GameState = {
            ...payload,
            gameId: payload.gameId ?? this.auth.roomId,
            claimWinAvailable: payload.claimWinAvailable ?? undefined,
            claimWinPlayerName: payload.claimWinPlayerName ?? undefined,
            uncalledAmount: payload.uncalledAmount ?? undefined,
            pots: payload.pots ?? undefined,
            isReadyCountdownActive: payload.isReadyCountdownActive ?? undefined,
            readyCountdownDeadlineEpochMs: payload.readyCountdownDeadlineEpochMs ?? undefined,
        };

        if (incomingData.phase !== 'SHOWDOWN') {
            incomingData.isReadyCountdownActive = false;
            incomingData.readyCountdownDeadlineEpochMs = undefined;
        }

        const previousState = this.snapshot.gameState;
        let data = incomingData;
        const hadWinnersBefore = Boolean(previousState?.winners && previousState.winners.length > 0);

        if (previousState?.phase === 'SHOWDOWN' && incomingData.phase === 'SHOWDOWN') {
            const prevReadyActive = Boolean(previousState.isReadyCountdownActive);
            const inReadyActive = Boolean(incomingData.isReadyCountdownActive);
            const prevDeadline =
                typeof previousState.readyCountdownDeadlineEpochMs === 'number'
                    ? previousState.readyCountdownDeadlineEpochMs
                    : undefined;
            const inDeadline =
                typeof incomingData.readyCountdownDeadlineEpochMs === 'number'
                    ? incomingData.readyCountdownDeadlineEpochMs
                    : undefined;
            const mergedDeadline =
                prevDeadline === undefined
                    ? inDeadline
                    : inDeadline === undefined
                    ? prevDeadline
                    : Math.max(prevDeadline, inDeadline);

            if (prevReadyActive && !inReadyActive) {
                data = {
                    ...incomingData,
                    isReadyCountdownActive: true,
                    readyCountdownDeadlineEpochMs: mergedDeadline,
                };
            } else if (
                inReadyActive &&
                incomingData.readyCountdownDeadlineEpochMs == null &&
                previousState.readyCountdownDeadlineEpochMs != null
            ) {
                data = {
                    ...incomingData,
                    readyCountdownDeadlineEpochMs: previousState.readyCountdownDeadlineEpochMs,
                };
            } else if (inReadyActive && mergedDeadline !== undefined) {
                data = { ...incomingData, readyCountdownDeadlineEpochMs: mergedDeadline };
            }
        } else if (previousState?.phase !== 'SHOWDOWN' && incomingData.phase === 'SHOWDOWN') {
            // Guard against stale SHOWDOWN packets arriving after hand transitioned
            const inDeadline =
                typeof incomingData.readyCountdownDeadlineEpochMs === 'number'
                    ? incomingData.readyCountdownDeadlineEpochMs
                    : 0;
            if (incomingData.isReadyCountdownActive && inDeadline > 0 && inDeadline <= this.clock.now()) {
                return;
            }
        }

        // Preserve non-zero pot during showdown if server reports 0
        if (data.phase === 'SHOWDOWN' && data.pot === 0 && previousState && previousState.pot > 0) {
            data = {
                ...data,
                pot: previousState.pot,
                pots: previousState.pots,
            };
        }

        let nextShowdown: GameState | null = this.snapshot.showdown;
        let nextShowdownResult: GameState | null = this.snapshot.showdownResult;

        if (data.winners && data.winners.length > 0) {
            if (!hadWinnersBefore) nextShowdownResult = null;
            nextShowdown = data;
            nextShowdownResult = data;
            this.scheduleShowdownHide(data);
        } else if (data.phase === 'SHOWDOWN') {
            const currentShowdownResult =
                this.snapshot.showdownResult ?? (previousState?.phase === 'SHOWDOWN' ? previousState : null);
            if (currentShowdownResult && currentShowdownResult.winners && currentShowdownResult.winners.length > 0) {
                const mergedShowdownResult: GameState = {
                    ...currentShowdownResult,
                    claimWinAvailable: data.claimWinAvailable,
                    claimWinPlayerName: data.claimWinPlayerName,
                    isReadyCountdownActive: data.isReadyCountdownActive,
                    readyCountdownDeadlineEpochMs: data.readyCountdownDeadlineEpochMs,
                    players: currentShowdownResult.players.map((p) => {
                        const updatedPlayer = data.players.find((up) => up.id === p.id);
                        if (!updatedPlayer) return p;
                        return {
                            ...p,
                            chips: updatedPlayer.chips,
                            status: updatedPlayer.status,
                            isReadyForNextHand: updatedPlayer.isReadyForNextHand,
                            disconnectDeadlineEpochMs: updatedPlayer.disconnectDeadlineEpochMs,
                        };
                    }),
                };
                data = mergedShowdownResult;
                nextShowdown = mergedShowdownResult;
                nextShowdownResult = mergedShowdownResult;
            } else {
                nextShowdown = data;
                nextShowdownResult = data;
            }
            if (data.isReadyCountdownActive) {
                this.scheduleShowdownHide(data);
            }
        } else {
            nextShowdown = null;
            nextShowdownResult = null;
            this.clearShowdownTimers();
        }

        let myPlayerId = this.snapshot.myPlayerId;
        const myPlayer = data.players.find((p) => p.name === this.auth.playerName);
        if (myPlayer?.id) {
            myPlayerId = myPlayer.id;
        }

        this.updateSnapshot(() => ({
            gameState: data,
            showdown: nextShowdown,
            showdownResult: nextShowdownResult,
            myPlayerId,
            claimPending: false,
        }));
    }

    public applyPrivateState(payload: IncomingPrivateStatePayload | { holeCards: string[] } | null): void {
        if (!payload) {
            this.updateSnapshot(() => ({
                privateState: null,
            }));
            return;
        }
        const nextHoleCards = Array.isArray(payload.holeCards) ? payload.holeCards : [];
        this.updateSnapshot((prev) => ({
            privateState: { holeCards: nextHoleCards },
            myPlayerId: ('playerId' in payload && payload.playerId) ? payload.playerId : prev.myPlayerId,
        }));
    }

    public setGameState(gameState: GameState | null): void {
        this.updateSnapshot(() => ({
            gameState,
        }));
    }

    public setShowdown(v: GameState | null): void {
        this.updateSnapshot(() => ({
            showdown: v,
        }));
    }

    public setShowdownResult(v: GameState | null): void {
        this.updateSnapshot(() => ({
            showdownResult: v,
        }));
    }

    public setRoomState(room: RoomState | null): void {
        this.updateSnapshot(() => ({
            roomState: room,
        }));
    }

    public setLoadingStatus(status: string): void {
        this.updateSnapshot(() => ({
            loadingStatus: status,
        }));
    }

    public setMyPlayerId(id: string | null): void {
        this.updateSnapshot(() => ({
            myPlayerId: id,
        }));
    }

    public setClaimPending(pending: boolean): void {
        this.updateSnapshot(() => ({
            claimPending: pending,
        }));
    }

    public setWsStatus(status: WsStatus): void {
        this.updateSnapshot(() => ({
            wsStatus: status,
        }));
    }

    public setHydrated(hydrated: boolean): void {
        this.updateSnapshot(() => ({
            isHydrated: hydrated,
        }));
    }

    public setGameEndResult(result: GameEndResult | null): void {
        let nextGameState = this.snapshot.gameState;
        if (result?.finalState) {
            const fs = result.finalState;
            if (fs.phase === 'SHOWDOWN' && fs.pot === 0 && this.snapshot.gameState && this.snapshot.gameState.pot > 0) {
                nextGameState = {
                    ...fs,
                    pot: this.snapshot.gameState.pot,
                    pots: this.snapshot.gameState.pots,
                };
            } else {
                nextGameState = fs;
            }
        }
        this.clearShowdownTimers();
        this.clearNotificationTimer();
        this.updateSnapshot(() => ({
            gameEndResult: result,
            isGameOver: result !== null,
            gameState: nextGameState,
            showdown: null,
            showdownResult: null,
            notification: null,
        }));
    }

    public clearGameState(): void {
        this.clearShowdownTimers();
        this.cancelActionLocks();
        this.updateSnapshot(() => ({
            gameState: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            claimPending: false,
            myPlayerId: null,
            gameEndResult: null,
            isGameOver: false,
        }));
    }

    public clearError(): void {
        this.updateSnapshot(() => ({
            error: null,
        }));
    }

    // ── Actions & Locking ─────────────────────────────────────────────────────────

    public playAction(action: PokerAction, amount?: number): void {
        if (!this.isConnected()) {
            this.setNotification('Waiting for connection...');
            return;
        }

        if (this.snapshot.pendingActions.has('PLAY_ACTION')) return;

        this.clearError();
        this.acquireActionLock('PLAY_ACTION');

        const targetGameId = this.snapshot.gameState?.gameId ?? this.auth.roomId;
        try {
            this.transport.publish(
                `/app/${encodeURIComponent(targetGameId)}/action`,
                JSON.stringify({ action, amount: amount || 0 })
            );
        } catch (err) {
            this.releaseActionLock('PLAY_ACTION');
            logger.error('Failed to publish PLAY_ACTION:', err);
            this.setNotification('System malfunction');
        }
    }

    public ready(): void {
        if (!this.isConnected()) {
            this.setNotification('Waiting for connection...');
            return;
        }

        if (this.snapshot.pendingActions.has('READY')) return;

        this.clearError();
        this.acquireActionLock('READY');

        const targetGameId = this.snapshot.gameState?.gameId ?? this.auth.roomId;
        try {
            this.transport.publish(`/app/${encodeURIComponent(targetGameId)}/ready`, '{}');
        } catch (err) {
            this.releaseActionLock('READY');
            logger.error('Failed to publish READY:', err);
            this.setNotification('System malfunction');
        }
    }

    public unready(): void {
        if (!this.isConnected()) {
            this.setNotification('Waiting for connection...');
            return;
        }

        if (this.snapshot.pendingActions.has('UNREADY')) return;

        this.clearError();
        this.acquireActionLock('UNREADY');

        const targetGameId = this.snapshot.gameState?.gameId ?? this.auth.roomId;
        try {
            this.transport.publish(`/app/${encodeURIComponent(targetGameId)}/unready`, '{}');
        } catch (err) {
            this.releaseActionLock('UNREADY');
            logger.error('Failed to publish UNREADY:', err);
            this.setNotification('System malfunction');
        }
    }

    public isActionPending(type: string): boolean {
        return this.snapshot.pendingActions.has(type);
    }

    public cancelActionLocks(): void {
        for (const timer of this.actionTimeoutTimers.values()) {
            this.clock.clearTimeout(timer);
        }
        this.actionTimeoutTimers.clear();

        if (this.snapshot.pendingActions.size > 0) {
            this.updateSnapshot(() => ({
                pendingActions: new Set<string>(),
            }));
        }
    }

    private acquireActionLock(type: string): void {
        const nextPending = new Set(this.snapshot.pendingActions);
        nextPending.add(type);

        const existingTimer = this.actionTimeoutTimers.get(type);
        if (existingTimer !== undefined) {
            this.clock.clearTimeout(existingTimer);
        }

        const timer = this.clock.setTimeout(() => {
            this.releaseActionLock(type);
        }, ACTION_LOCK_TIMEOUT_MS);
        this.actionTimeoutTimers.set(type, timer);

        this.updateSnapshot(() => ({
            pendingActions: nextPending,
        }));
    }

    private releaseActionLock(type: string): void {
        const timer = this.actionTimeoutTimers.get(type);
        if (timer !== undefined) {
            this.clock.clearTimeout(timer);
            this.actionTimeoutTimers.delete(type);
        }

        if (this.snapshot.pendingActions.has(type)) {
            const nextPending = new Set(this.snapshot.pendingActions);
            nextPending.delete(type);
            this.updateSnapshot(() => ({
                pendingActions: nextPending,
            }));
        }
    }

    private isConnected(): boolean {
        return this.transport.isConnected?.() ?? this.snapshot.wsStatus === 'connected';
    }

    // ── Notifications ─────────────────────────────────────────────────────────────

    public setNotification(msg: string | null, ms = 4000): void {
        this.clearNotificationTimer();
        this.updateSnapshot(() => ({
            notification: msg,
        }));

        if (msg !== null && ms > 0) {
            this.notificationTimer = this.clock.setTimeout(() => {
                this.updateSnapshot(() => ({
                    notification: null,
                }));
                this.notificationTimer = null;
            }, ms);
        }
    }

    private clearNotificationTimer(): void {
        if (this.notificationTimer !== null) {
            this.clock.clearTimeout(this.notificationTimer);
            this.notificationTimer = null;
        }
    }

    // ── Showdown Timers ───────────────────────────────────────────────────────────

    public clearShowdownTimers = (): void => {
        if (this.showdownTimer !== null) {
            this.clock.clearTimeout(this.showdownTimer);
            this.showdownTimer = null;
        }
        if (this.showdownResultTimer !== null) {
            this.clock.clearTimeout(this.showdownResultTimer);
            this.showdownResultTimer = null;
        }
    };

    public scheduleShowdownHide = (state: GameState): void => {
        this.clearShowdownTimers();

        const deadlineMs =
            state.phase === 'SHOWDOWN' &&
            Boolean(state.isReadyCountdownActive) &&
            typeof state.readyCountdownDeadlineEpochMs === 'number'
                ? state.readyCountdownDeadlineEpochMs
                : undefined;

        const delay =
            deadlineMs !== undefined
                ? Math.max(0, deadlineMs - this.clock.now()) || 250
                : state.phase === 'SHOWDOWN'
                ? SHOWDOWN_FALLBACK_HIDE_MS
                : null;

        if (delay === null) return;

        this.showdownTimer = this.clock.setTimeout(() => {
            this.updateSnapshot(() => ({
                showdown: null,
            }));
            this.showdownTimer = null;
        }, delay);

        this.showdownResultTimer = this.clock.setTimeout(() => {
            this.updateSnapshot(() => ({
                showdownResult: null,
            }));
            this.showdownResultTimer = null;
        }, delay);
    };

    private clearRedirectTimer(): void {
        if (this.redirectTimer !== null) {
            this.clock.clearTimeout(this.redirectTimer);
            this.redirectTimer = null;
        }
    }
}
