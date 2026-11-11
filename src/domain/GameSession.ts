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
    getErrorStatusCode,
    decodeGameStatePayload,
    decodeGameEndResult,
    decodePrivatePlayerState,
    isGameEndPayload,
    isActionErrorPayload,
    isRoomUpdatePayload,
    normalizeErrorMessage,
} from '../lib/payloads';
import {
    HOST_LEFT,
    LOBBY_INACTIVE_CLOSED,
    ERROR_INITIAL_TABLE_LOAD,
    SESSION_EXPIRED,
    SESSION_SEAT_GONE,
    SESSION_SEAT_TIMED_OUT,
    STATUS_CONNECTED,
    STATUS_CONNECTING,
    STATUS_RECOVERING_TABLE,
    STATUS_RETURNING,
} from '../constants/strings';
import { logger } from '../security/logger';
import { SystemClock, type Clock, type TimerHandle } from './clock';
import type { GameTransport, TransportStatus, TransportSubscription } from '../services/transport';
import { loadSessionData, type SyncResult } from './sessionSync';
import { pokerApi } from '../services/api';

const ROOM_CLOSED_REDIRECT_MS = 3_000;
export const INACTIVITY_WARNING_WINDOW_MS = 120_000;
const ACTION_LOCK_TIMEOUT_MS = 3_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RECOVERY_RETRIES = 3;

const PHASE_ORDER: Record<string, number> = {
    PRE_FLOP: 0,
    FLOP: 1,
    TURN: 2,
    RIVER: 3,
    SHOWDOWN: 4,
};

export interface GameSessionOptions {
    auth: AuthResponse;
    transport: GameTransport;
    clock?: Clock;
    initialRoomState?: RoomState | null;
    initialGameState?: GameState | null;
    initialGameEndResult?: GameEndResult | null;
    onLeave?: (originatingToken?: string) => void;
    pokerApi?: typeof pokerApi;
}

export class GameSession {
    private readonly auth: AuthResponse;
    private transport: GameTransport;
    private readonly clock: Clock;
    private onLeave?: (originatingToken?: string) => void;
    private readonly api: typeof pokerApi;

    private listeners = new Set<() => void>();
    private connectListeners = new Set<() => void>();
    private manualRetryListeners = new Set<() => void>();
    private socketErrorListeners = new Set<(message: string) => void>();
    private subscriptions: TransportSubscription[] = [];
    private unsubStatus?: () => void;
    private unsubError?: () => void;
    private lastStateSyncTime = 0;
    private roomRevision = 0;
    private stateSyncRevision = 0;
    private privateSyncRevision = 0;
    private attemptId = 0;
    private activeAttemptController: AbortController | null = null;
    private gameStarted = false;
    private bufferedPrivateState: { handNumber: number; playerId: string; holeCards: string[] } | null = null;
    private currentPrivateHandNumber: number | null = null;
    private currentPrivatePlayerId: string | null = null;
    private lifecyclePermission = true;
    private isLeavingPending = false;
    private isDisposed = false;
    private isRedirecting = false;
    private attachmentEpoch = 1;
    private attached = true;
    private subscriptionGeneration = 0;

    private actionTimeoutTimers = new Map<string, TimerHandle>();
    private notificationTimer: TimerHandle | null = null;
    private redirectTimer: TimerHandle | null = null;
    private lobbyInactivityWarningTimer: TimerHandle | null = null;
    private gameInactivityWarningTimer: TimerHandle | null = null;
    private recoveryTimer: TimerHandle | null = null;
    private recoveryRetryAttempt = 0;
    private recoveryGeneration = 0;
    private serverClockOffsetMs = 0;
    private notificationSequence = 0;
    private snapshotBatchDepth = 0;
    private snapshotBatchDirty = false;
    private claimRecoveryGeneration = 0;
    private claimRecoveryController: AbortController | null = null;
    private claimRecoveryActive = false;
    private claimRecoveryGameId: string | null = null;
    private claimRecoveryOriginalError: unknown;

    private snapshot: SessionSnapshot;

    constructor(options: GameSessionOptions) {
        this.auth = options.auth;
        this.transport = options.transport;
        this.clock = options.clock ?? new SystemClock();
        this.onLeave = options.onLeave;
        this.api = options.pokerApi ?? pokerApi;

        const initialRoom: RoomState = options.initialRoomState ?? {
            roomId: options.auth.roomId,
            roomName: '',
            players: [{ name: options.auth.playerName, isHost: false }],
            gameStarted: false,
        };

        const isGameOver = Boolean(options.initialGameEndResult);
        this.gameStarted = Boolean(initialRoom.gameStarted);

        const initialGameState = options.initialGameState ?? options.initialGameEndResult?.finalState ?? null;
        let initialHeroId: string | null = null;
        if (initialGameState?.players && options.auth.playerName) {
            const hero = initialGameState.players.find((p) => p.name === options.auth.playerName);
            if (hero?.id) {
                initialHeroId = hero.id;
            }
        }

        this.snapshot = Object.freeze({
            roomState: initialRoom,
            gameState: initialGameState,
            privateState: null,
            showdown: null,
            showdownResult: null,
            notification: null,
            notificationSequence: 0,
            loadingStatus: 'Connecting...',
            myPlayerId: initialHeroId,
            claimPending: false,
            wsStatus: 'disconnected' as WsStatus,
            isHydrated: isGameOver,
            isGameOver,
            gameEndResult: options.initialGameEndResult ?? null,
            pendingActions: new Set<string>(),
            error: null,
            isRecovering: false,
            recoveryFailed: false,
            isRedirecting: false,
            isLobbyInactivityWarningActive: false,
            isGameInactivityWarningActive: false,
        });

        if (initialRoom && !initialRoom.gameStarted && typeof initialRoom.inactivityDeadlineEpochMs === 'number') {
            this.updateLobbyInactivity(initialRoom);
        } else if (this.gameStarted || initialGameState) {
            this.updateGameInactivity(initialGameState, initialRoom);
        }
    }

    public setOnLeave(onLeave: ((originatingToken?: string) => void) | undefined): void {
        if (!this.attached && onLeave !== undefined) {
            return;
        }
        this.onLeave = onLeave;
    }

    public getAuth = (): AuthResponse => {
        return this.auth;
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

    public getStateSyncRevision = (): number => {
        return this.stateSyncRevision;
    };

    public getPrivateSyncRevision(): number {
        return this.privateSyncRevision;
    }

    public getAttemptId(): number {
        return this.attemptId;
    }

    public getRoomRevision(): number {
        return this.roomRevision;
    }

    public isStarted(): boolean {
        return this.gameStarted || Boolean(this.snapshot.roomState?.gameStarted);
    }

    public isAttached(): boolean {
        return this.attached;
    }

    public getAttachmentEpoch(): number {
        return this.attachmentEpoch;
    }

    public getAttachmentGeneration(): number {
        return this.attachmentEpoch;
    }

    public attach(): number {
        if (this.attached) {
            return this.attachmentEpoch;
        }
        this.attached = true;
        this.attachmentEpoch += 1;
        if (!this.snapshot.isGameOver && !this.isDisposed && this.redirectTimer === null && !this.isRedirecting) {
            this.lifecyclePermission = true;
        }
        return this.attachmentEpoch;
    }

    public acquire(): number {
        return this.attach();
    }

    public detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.attachmentEpoch += 1;
        this.onLeave = undefined;
        this.connectListeners.clear();
        this.manualRetryListeners.clear();
        this.socketErrorListeners.clear();
        this.lifecyclePermission = false;
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.attemptId += 1;
        this.cancelActionLocks();
        this.clearShowdownTimers();
        this.clearNotificationTimer();
        this.clearRedirectTimer();
        this.clearLobbyInactivityTimer();
        this.clearGameInactivityTimer();
        this.isRedirecting = false;
        this.cancelRecovery();
        this.cleanupSubscriptions();
        this.updateSnapshot(() => ({
            wsStatus: 'disconnected',
            claimPending: false,
            notification: null,
            isRedirecting: false,
            isLobbyInactivityWarningActive: false,
            isGameInactivityWarningActive: false,
        }));
        this.transport.disconnect();
    }

    public release(): void {
        this.detach();
    }

    public hasGameStarted(): boolean {
        return this.gameStarted;
    }

    public markGameStarted(): void {
        this.gameStarted = true;
        this.clearLobbyInactivityTimer();
        if (this.snapshot.roomState && !this.snapshot.roomState.gameStarted) {
            this.updateSnapshot((prev) => ({
                roomState: prev.roomState ? { ...prev.roomState, gameStarted: true, inactivityDeadlineEpochMs: undefined } : null,
                isLobbyInactivityWarningActive: false,
            }));
        } else if (this.snapshot.isLobbyInactivityWarningActive) {
            this.updateSnapshot(() => ({ isLobbyInactivityWarningActive: false }));
        }
    }

    public isRedirectingActive(): boolean {
        return this.isRedirecting;
    }

    public hasLifecyclePermission(): boolean {
        return (
            this.attached &&
            this.lifecyclePermission &&
            !this.snapshot.isGameOver &&
            !this.isDisposed &&
            this.redirectTimer === null &&
            !this.isRedirecting &&
            !this.isLeavingPending
        );
    }

    public setPendingLeave(pending: boolean): void {
        if (pending) {
            this.isLeavingPending = true;
            this.claimRecoveryGeneration += 1;
            this.claimRecoveryController?.abort();
            this.claimRecoveryController = null;
            this.clearRecoveryTimer();
            if (this.activeAttemptController) {
                this.activeAttemptController.abort();
                this.activeAttemptController = null;
            }
        } else {
            this.isLeavingPending = false;
            if (!this.snapshot.isGameOver && !this.isDisposed) {
                if (this.claimRecoveryActive) this.retryClaimReview();
                else void this.synchronizeSession({ resetBudget: true });
            }
        }
    }

    public now = (): number => {
        return this.clock.now();
    };

    public displayNow = (): number => this.clock.now() + this.serverClockOffsetMs;

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

    public onManualRetry = (listener: () => void): (() => void) => {
        this.manualRetryListeners.add(listener);
        return () => {
            this.manualRetryListeners.delete(listener);
        };
    };

    public retryConnection = (): void => {
        if (this.snapshot.isGameOver || this.isRedirecting || !this.attached || this.isDisposed) return;
        this.clearRecoveryTimer();
        if (this.claimRecoveryActive) {
            void this.recoverClaimReview(this.claimRecoveryGameId ?? this.auth.roomId, this.claimRecoveryOriginalError, { resetBudget: true });
            return;
        }
        for (const listener of this.manualRetryListeners) {
            listener();
        }
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

        if (this.snapshotBatchDepth > 0) this.snapshotBatchDirty = true;
        else this.notifyListeners();
    }

    private notifyListeners(): void {
        if (!this.attached) return;
        for (const listener of this.listeners) listener();
    }

    private beginSnapshotBatch(): void { this.snapshotBatchDepth += 1; }

    private endSnapshotBatch(): void {
        this.snapshotBatchDepth = Math.max(0, this.snapshotBatchDepth - 1);
        if (this.snapshotBatchDepth === 0 && this.snapshotBatchDirty) {
            this.snapshotBatchDirty = false;
            this.notifyListeners();
        }
    }

    // ── Transport Lifecycle & Subscriptions ───────────────────────────────────────

    private cleanupSubscriptions(): void {
        this.subscriptionGeneration += 1;
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
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) {
            return;
        }
        if (transportOverride && transportOverride !== this.transport) {
            this.disconnect();
            this.transport = transportOverride;
        }
        if (!this.snapshot.isGameOver && !this.isDisposed && this.redirectTimer === null && !this.isRedirecting) {
            this.lifecyclePermission = true;
        }

        this.cleanupSubscriptions();
        const subGen = ++this.subscriptionGeneration;
        const currentAttachment = this.attachmentEpoch;

        this.unsubStatus = this.transport.onStatusChange((status: TransportStatus) => {
            if (!this.attached || this.isDisposed || this.isRedirecting || this.attachmentEpoch !== currentAttachment || this.subscriptionGeneration !== subGen) return;
            this.handleStatusChange(status);
        });

        if (this.transport.onError) {
            this.unsubError = this.transport.onError((errorMsg: string) => {
                if (!this.attached || this.isDisposed || this.isRedirecting || this.attachmentEpoch !== currentAttachment || this.subscriptionGeneration !== subGen) return;
                this.handleTransportError(errorMsg);
            });
        }

        const subPrivate = this.transport.subscribe('/user/queue/private', (body: string) => {
            if (!this.attached || this.isDisposed || this.isRedirecting || this.attachmentEpoch !== currentAttachment || this.subscriptionGeneration !== subGen) return;
            this.handlePrivateMessage(body);
        });
        const subRoom = this.transport.subscribe(`/room/${this.auth.roomId}`, (body: string) => {
            if (!this.attached || this.isDisposed || this.isRedirecting || this.attachmentEpoch !== currentAttachment || this.subscriptionGeneration !== subGen) return;
            this.handleRoomMessage(body);
        });
        const subGame = this.transport.subscribe(`/game/${this.auth.roomId}`, (body: string) => {
            if (!this.attached || this.isDisposed || this.isRedirecting || this.attachmentEpoch !== currentAttachment || this.subscriptionGeneration !== subGen) return;
            this.handleGameMessage(body);
        });

        this.subscriptions.push(subPrivate, subRoom, subGame);
        this.transport.connect();
    }

    public disconnect(): void {
        this.lifecyclePermission = false;
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.cancelActionLocks();
        this.clearShowdownTimers();
        this.clearNotificationTimer();
        this.clearRedirectTimer();
        this.clearLobbyInactivityTimer();
        this.clearGameInactivityTimer();
        this.cancelRecovery();
        this.cleanupSubscriptions();

        this.updateSnapshot(() => ({
            wsStatus: 'disconnected',
        }));

        this.transport.disconnect();
    }

    public dispose(): void {
        this.isDisposed = true;
        this.detach();
    }

    // ── Status & Error Handlers ───────────────────────────────────────────────────

    private handleStatusChange(status: TransportStatus): void {
        if (!this.attached || this.isDisposed || this.isRedirecting) return;
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
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;

        if (this.snapshot.wsStatus !== 'disconnected') {
            this.updateSnapshot(() => ({
                wsStatus: 'reconnecting',
            }));
        }

        this.handleActionError(errorMsg);
    }

    // ── Message Handlers ──────────────────────────────────────────────────────────

    private handlePrivateMessage(body: string): void {
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
        try {
            const parsed = JSON.parse(body);

            if (parsed?.type === 'ACTION_ERROR') {
                if (!isActionErrorPayload(parsed)) {
                    logger.warn('Invalid ACTION_ERROR contract:', { bytes: body.length });
                    return;
                }
                if (parsed.action === 'READY' || parsed.action === 'UNREADY') {
                    this.releaseActionLock(parsed.action);
                    this.setNotification(normalizeErrorMessage(parsed.message) || 'Could not update readiness. Please try again.');
                } else {
                    this.cancelActionLocks();
                }
                this.updateSnapshot(() => ({ error: parsed }));
                if (parsed.code === 'GAME_NOT_FOUND') this.scheduleRedirect(SESSION_EXPIRED);
                return;
            }

            if (parsed?.type === 'PLAYER_NOTIFICATION' && typeof parsed.message === 'string') {
                const targetPlayer = typeof parsed.playerName === 'string' ? parsed.playerName.trim() : typeof parsed.recipient === 'string' ? parsed.recipient.trim() : null;
                if (targetPlayer && targetPlayer !== this.auth.playerName) {
                    return;
                }
                this.setNotification(normalizeErrorMessage(parsed.message));
                return;
            }

            const decodedPrivate = decodePrivatePlayerState(parsed);
            if (decodedPrivate) {
                const currentHandNumber = this.snapshot.gameState?.handNumber ?? null;
                const { handNumber, playerId, holeCards } = decodedPrivate;

                // Match player identity with roster when gameState is present
                const myPlayer = this.snapshot.gameState?.players.find((p) => p.name === this.auth.playerName);
                if (myPlayer?.id && myPlayer.id !== playerId) {
                    return;
                }

                // Older hand: reject
                if (currentHandNumber !== null && handNumber < currentHandNumber) {
                    return;
                }

                // Future hand: buffer until that hand begins
                if (currentHandNumber === null || !myPlayer?.id) {
                    if (!this.bufferedPrivateState || handNumber >= this.bufferedPrivateState.handNumber) {
                        this.bufferedPrivateState = {
                            handNumber,
                            playerId,
                            holeCards,
                        };
                    }
                    return;
                }

                if (handNumber > currentHandNumber) {
                    if (!this.bufferedPrivateState || handNumber >= this.bufferedPrivateState.handNumber) {
                        this.bufferedPrivateState = {
                            handNumber,
                            playerId,
                            holeCards,
                        };
                    }
                    return;
                }

                // Current hand (handNumber === currentHandNumber)
                if (this.bufferedPrivateState && this.bufferedPrivateState.handNumber <= handNumber) {
                    this.bufferedPrivateState = null;
                }
                this.currentPrivateHandNumber = handNumber;
                this.currentPrivatePlayerId = playerId;

                this.applyPrivateState(decodedPrivate);
            }
        } catch {
            logger.warn('Ignoring malformed private payload:', { bytes: body.length });
        }
    }

    public handleActionError(message: string): void {
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
        this.cancelActionLocks();

        if (/game not found|room not found|no longer part of this game/i.test(message)) {
            this.scheduleRedirect(SESSION_EXPIRED);
            for (const listener of this.socketErrorListeners) {
                listener(message);
            }
            return;
        }

        const normalized = normalizeErrorMessage(message) || 'Error occurred';
        this.setNotification(normalized);

        for (const listener of this.socketErrorListeners) {
            listener(message);
        }
    }

    public scheduleRedirect(message: string, options?: { clearRoom?: boolean }): void {
        if (this.snapshot.isGameOver || this.isRedirecting || !this.attached || this.isDisposed) {
            return;
        }
        this.isRedirecting = true;
        this.lifecyclePermission = false;
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.claimRecoveryGeneration += 1;
        this.claimRecoveryController?.abort();
        this.claimRecoveryController = null;
        this.claimRecoveryActive = false;
        this.claimRecoveryGameId = null;

        this.cancelActionLocks();
        this.clearNotificationTimer();
        this.cancelRecovery();
        this.cleanupSubscriptions();
        this.transport.disconnect();

        const cleanMsg = normalizeErrorMessage(message);
        const targetEpoch = this.attachmentEpoch;

        this.clearRedirectTimer();
        this.clearLobbyInactivityTimer();
        this.clearGameInactivityTimer();
        this.redirectTimer = this.clock.setTimeout(() => {
            this.redirectTimer = null;
            if (this.attached && this.attachmentEpoch === targetEpoch && !this.snapshot.isGameOver) {
                this.onLeave?.(this.auth.token);
            }
        }, ROOM_CLOSED_REDIRECT_MS);

        const redirectDisplay = cleanMsg || (options?.clearRoom ? HOST_LEFT : STATUS_RETURNING);

        this.updateSnapshot((prev) => ({
            roomState: options?.clearRoom ? null : prev.roomState,
            loadingStatus: redirectDisplay,
            notification: redirectDisplay,
            notificationSequence: ++this.notificationSequence,
            isRedirecting: true,
            isLobbyInactivityWarningActive: false,
            wsStatus: 'disconnected',
            claimPending: false,
        }));
    }

    private handleRoomMessage(body: string): void {
        if (!this.attached || this.isDisposed) return;
        try {
            const parsed: unknown = JSON.parse(body);
            if (!isRoomUpdatePayload(parsed)) {
                logger.warn('Ignoring invalid room update payload:', body);
                return;
            }
            const update: RoomUpdate = parsed;

            if (update.message === 'ROOM_CLOSED') {
                this.clearLobbyInactivityTimer();
                this.clearGameInactivityTimer();
                const isInactive = Boolean(update.data && 'reason' in update.data && update.data.reason === 'INACTIVITY');
                const redirectMsg = isInactive ? LOBBY_INACTIVE_CLOSED : HOST_LEFT;
                this.scheduleRedirect(redirectMsg, { clearRoom: true });
                return;
            }

            if (this.isRedirecting || this.snapshot.isGameOver) return;

            if (update.message === 'GAME_STARTED') {
                const data = update.data;
                if (!data) return;

                if ('players' in data && Array.isArray(data.players)) {
                    if (data.roomId && data.roomId !== this.auth.roomId) return;
                    const heroStillInRoom = data.players.some((p) => p.name === this.auth.playerName);
                    if (!heroStillInRoom) {
                        if (this.isLeavingPending) return;
                        this.scheduleRedirect(SESSION_SEAT_GONE);
                        return;
                    }

                    this.markGameStarted();
                    this.roomRevision += 1;
                    this.updateSnapshot((prev) => ({
                        roomState: {
                            roomId: data.roomId ?? prev.roomState?.roomId ?? this.auth.roomId,
                            roomName: data.roomName ?? prev.roomState?.roomName,
                            players: data.players,
                            maxPlayers: data.maxPlayers ?? prev.roomState?.maxPlayers,
                            buyIn: data.buyIn ?? prev.roomState?.buyIn,
                            smallBlind: data.smallBlind ?? prev.roomState?.smallBlind,
                            bigBlind: data.bigBlind ?? prev.roomState?.bigBlind,
                            canStartGame: data.canStartGame ?? false,
                            gameStarted: true,
                            inactivityDeadlineEpochMs:
                                typeof data.inactivityDeadlineEpochMs === 'number'
                                    ? data.inactivityDeadlineEpochMs
                                    : prev.roomState?.inactivityDeadlineEpochMs,
                            serverTimeEpochMs:
                                typeof data.serverTimeEpochMs === 'number'
                                    ? data.serverTimeEpochMs
                                    : prev.roomState?.serverTimeEpochMs,
                        },
                    }));
                    this.updateGameInactivity(this.snapshot.gameState, this.snapshot.roomState);
                    void this.synchronizeSession({ resetBudget: true });
                    return;
                }

                if ('gameId' in data && typeof data.gameId === 'string') {
                    if (data.gameId !== this.auth.roomId) return;
                    this.markGameStarted();
                    this.roomRevision += 1;
                    void this.synchronizeSession({ resetBudget: true });
                    return;
                }

                return;
            }

            if (
                update.message === 'ROOM_CREATED' ||
                update.message === 'PLAYER_JOINED' ||
                update.message === 'PLAYER_LEFT'
            ) {
                const heroStillInRoom = update.data.players.some((p) => p.name === this.auth.playerName);
                if (!heroStillInRoom) {
                    if (this.isLeavingPending) {
                        return;
                    }
                    const previousState = this.snapshot.gameState;
                    const hadActiveTurn =
                        previousState?.currentPlayerName === this.auth.playerName &&
                        typeof previousState?.turnDeadlineEpochMs === 'number';
                    const now = typeof update.data.serverTimeEpochMs === 'number'
                        ? update.data.serverTimeEpochMs
                        : this.displayNow();
                    const turnExpired = hadActiveTurn && now >= (previousState!.turnDeadlineEpochMs as number);
                    this.scheduleRedirect(turnExpired ? SESSION_SEAT_TIMED_OUT : SESSION_SEAT_GONE);
                    return;
                }

                this.roomRevision += 1;
                const gameStarted = this.isStarted() || Boolean(update.data.gameStarted);
                if (gameStarted) {
                    this.markGameStarted();
                }

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
                        gameStarted,
                        inactivityDeadlineEpochMs:
                            update.data.inactivityDeadlineEpochMs !== undefined
                                ? update.data.inactivityDeadlineEpochMs
                                : prev.roomState?.inactivityDeadlineEpochMs,
                        serverTimeEpochMs:
                            update.data.serverTimeEpochMs !== undefined
                                ? update.data.serverTimeEpochMs
                                : prev.roomState?.serverTimeEpochMs,
                    },
                }));
                if (gameStarted) {
                    this.updateGameInactivity(this.snapshot.gameState, this.snapshot.roomState);
                } else {
                    this.updateLobbyInactivity(this.snapshot.roomState);
                }
            }
        } catch (err) {
            logger.warn('Ignoring malformed room update payload:', body, err);
        }
    }

    private handleGameMessage(body: string): void {
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch (err) {
            logger.warn('Ignoring malformed game payload:', body, err);
            return;
        }

        if (!parsed || typeof parsed !== 'object') {
            decodeGameStatePayload(parsed, 'WebSocket game state');
            return;
        }
        const p = parsed as Record<string, unknown>;

        const messageType = typeof p.type === 'string' ? p.type : null;
        const messageText = typeof p.message === 'string' ? p.message : null;

        if (messageType === 'GAME_END' || isGameEndPayload(parsed)) {
            const decoded = decodeGameEndResult(parsed, this.auth.roomId);
            if (!decoded) {
                logger.warn('Rejected terminal STOMP payload:', parsed);
                void this.synchronizeSession();
                return;
            }
            this.installTerminalResult(decoded);
            return;
        }

        if (
            messageType === 'PLAYER_NOTIFICATION' ||
            messageType === 'AUTO_ADVANCE_START' ||
            messageType === 'AUTO_ADVANCE_COMPLETE'
        ) {
            if (messageType === 'PLAYER_NOTIFICATION') {
                const targetPlayer = typeof p.playerName === 'string' ? p.playerName.trim() : typeof p.recipient === 'string' ? p.recipient.trim() : null;
                if (targetPlayer && targetPlayer !== this.auth.playerName) {
                    return;
                }
            }
            const cleanNotification = messageText?.trim();
            if (cleanNotification) {
                this.setNotification(cleanNotification);
            }
            return;
        }

        const gamePayload = decodeGameStatePayload(parsed, 'WebSocket game state');
        if (!gamePayload) return;

        if (this.snapshot.isGameOver) return;

        this.applyGameState(gamePayload, this.clock.now());
    }

    // ── Public State Mutation Methods ─────────────────────────────────────────────

    public applyGameState(payload: IncomingGameStatePayload, syncTime?: number): boolean {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return false;

        const incomingData: GameState = {
            ...payload,
            gameId: payload.gameId ?? this.auth.roomId,
            claimWinAvailable: payload.claimWinAvailable ?? undefined,
            claimWinPlayerName: payload.claimWinPlayerName ?? undefined,
            uncalledAmount: payload.uncalledAmount ?? undefined,
            pots: payload.pots ?? undefined,
            isReadyCountdownActive: payload.isReadyCountdownActive ?? undefined,
            readyCountdownDeadlineEpochMs: payload.readyCountdownDeadlineEpochMs ?? undefined,
            turnDeadlineEpochMs: typeof payload.turnDeadlineEpochMs === 'number' && payload.turnDeadlineEpochMs > 0 ? payload.turnDeadlineEpochMs : undefined,
            handNumber: typeof payload.handNumber === 'number' ? payload.handNumber : undefined,
            stateRevision: typeof payload.stateRevision === 'number' ? payload.stateRevision : undefined,
            serverTimeEpochMs: payload.serverTimeEpochMs ?? undefined,
            readyGateState: payload.readyGateState ?? undefined,
        };

        if (incomingData.phase !== 'SHOWDOWN') {
            incomingData.isReadyCountdownActive = false;
            incomingData.readyCountdownDeadlineEpochMs = undefined;
            if (incomingData.readyGateState === undefined) incomingData.readyGateState = 'CLOSED';
        } else if (incomingData.readyGateState === 'CLOSED' || incomingData.readyGateState === 'WAITING_FOR_PLAYERS') {
            incomingData.isReadyCountdownActive = false;
            incomingData.readyCountdownDeadlineEpochMs = undefined;
        } else if (incomingData.readyGateState === 'COUNTING_DOWN') {
            incomingData.isReadyCountdownActive = true;
        }

        if (incomingData.phase === 'SHOWDOWN' || incomingData.isReadyCountdownActive || incomingData.isAutoAdvancing) {
            incomingData.turnDeadlineEpochMs = undefined;
        }

        const previousState = this.snapshot.gameState;
        if (previousState) {
            const prevHasOrdering =
                typeof previousState.handNumber === 'number' &&
                typeof previousState.stateRevision === 'number';
            const incomingHasOrdering =
                typeof incomingData.handNumber === 'number' &&
                typeof incomingData.stateRevision === 'number';

            if (prevHasOrdering && !incomingHasOrdering) {
                return false;
            }

            const incomingHand = incomingData.handNumber ?? 0;
            const prevHand = previousState.handNumber ?? 0;

            if (incomingHand < prevHand) {
                return false;
            }

            if (incomingHand === prevHand) {
                if (
                    typeof incomingData.stateRevision === 'number' &&
                    typeof previousState.stateRevision === 'number'
                ) {
                    if (incomingData.stateRevision < previousState.stateRevision) {
                        return false;
                    }
                    if (incomingData.stateRevision === previousState.stateRevision) {
                        return false;
                    }
                }
                const inPhase = PHASE_ORDER[incomingData.phase] ?? 0;
                const prevPhase = PHASE_ORDER[previousState.phase] ?? 0;
                if (inPhase < prevPhase) {
                    return false;
                }
            }
        }
        if (typeof payload.serverTimeEpochMs === 'number') {
            this.serverClockOffsetMs = payload.serverTimeEpochMs - this.clock.now();
        }
        const sameHand = !previousState || incomingData.handNumber === undefined || previousState.handNumber === undefined
            ? incomingData.phase === 'SHOWDOWN'
            : incomingData.handNumber === previousState.handNumber;
        let data = incomingData;

        if (sameHand && previousState?.phase === 'SHOWDOWN' && incomingData.phase === 'SHOWDOWN'
                && incomingData.readyGateState === undefined
                && incomingData.isReadyCountdownActive === undefined) {
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
            // A past wall-clock deadline can reflect client/server skew. The
            // authoritative SHOWDOWN snapshot remains valid during hydration.
        }

        if (typeof syncTime === 'number' && syncTime > this.lastStateSyncTime) {
            this.lastStateSyncTime = syncTime;
        }

        // Any accepted incoming game state clears in-flight action locks and advances revision
        this.cancelActionLocks();
        this.stateSyncRevision += 1;

        // Preserve non-zero pot during showdown if server reports 0
        if (sameHand && data.phase === 'SHOWDOWN' && data.pot === 0 && previousState && previousState.pot > 0) {
            data = {
                ...data,
                pot: previousState.pot,
                pots: previousState.pots,
            };
        }

        let nextShowdown: GameState | null = this.snapshot.showdown;
        let nextShowdownResult: GameState | null = this.snapshot.showdownResult;
        const hasAuthoritativeSettlement = data.handSettled === true;

        if ((data.winners && data.winners.length > 0) || hasAuthoritativeSettlement) {
            nextShowdown = data;
            nextShowdownResult = data;
        } else if (data.phase === 'SHOWDOWN' && sameHand) {
            const currentShowdownResult =
                this.snapshot.showdownResult ?? (previousState?.phase === 'SHOWDOWN' ? previousState : null);
            if (currentShowdownResult) {
                const settledVoid = hasAuthoritativeSettlement && (data.winners?.length ?? 0) === 0;
                const mergedPlayers = data.players.map((p) => {
                    const prevP = currentShowdownResult.players.find((prev) => prev.name === p.name);
                    return {
                        ...p,
                        holeCards: settledVoid ? undefined : (p.holeCards && p.holeCards.length > 0 ? p.holeCards : prevP?.holeCards),
                        handRank: settledVoid ? undefined : (p.handRank ?? prevP?.handRank),
                        bestHand: settledVoid ? undefined : (p.bestHand ?? prevP?.bestHand),
                        isWinner: hasAuthoritativeSettlement ? p.isWinner : (p.isWinner ?? prevP?.isWinner),
                        chipsWon: hasAuthoritativeSettlement ? p.chipsWon : (p.chipsWon ?? prevP?.chipsWon),
                    };
                });
                const mergedState: GameState = {
                    ...data,
                    players: mergedPlayers,
                    winners: hasAuthoritativeSettlement ? (data.winners ?? []) : (data.winners ?? currentShowdownResult.winners),
                    winningsPerPlayer: hasAuthoritativeSettlement ? data.winningsPerPlayer : (data.winningsPerPlayer ?? currentShowdownResult.winningsPerPlayer),
                    handSettled: data.handSettled ?? currentShowdownResult.handSettled,
                    carryOverAmount: hasAuthoritativeSettlement ? data.carryOverAmount : (data.carryOverAmount ?? currentShowdownResult.carryOverAmount),
                    pot: data.pot > 0 ? data.pot : currentShowdownResult.pot,
                    pots: data.pots ?? currentShowdownResult.pots,
                };
                data = mergedState;
                nextShowdown = mergedState;
                nextShowdownResult = mergedState;
            } else {
                nextShowdown = data;
                nextShowdownResult = data;
            }
        } else {
            nextShowdown = null;
            nextShowdownResult = null;
            this.clearShowdownTimers();
        }

        if (data.phase === 'SHOWDOWN') this.clearShowdownTimers();

        let myPlayerId = this.snapshot.myPlayerId;
        const myPlayer = data.players.find((p) => p.name === this.auth.playerName);
        if (myPlayer?.id) {
            myPlayerId = myPlayer.id;
        } else if (!this.auth.playerName && this.snapshot.myPlayerId) {
            myPlayerId = this.snapshot.myPlayerId;
        } else if (this.auth.playerName && myPlayerId && !data.players.some((p) => p.id === myPlayerId && p.name === this.auth.playerName)) {
            myPlayerId = null;
        }

        if (
            this.auth.playerName &&
            !myPlayer &&
            (this.snapshot.myPlayerId || previousState?.players.some((p) => p.name === this.auth.playerName)) &&
            !this.isLeavingPending &&
            !this.snapshot.isGameOver &&
            !this.isRedirecting
        ) {
            const hadActiveTurn =
                previousState?.currentPlayerName === this.auth.playerName &&
                typeof previousState?.turnDeadlineEpochMs === 'number';
            const now = typeof data.serverTimeEpochMs === 'number'
                ? data.serverTimeEpochMs
                : this.displayNow();
            const turnExpired = hadActiveTurn && now >= (previousState!.turnDeadlineEpochMs as number);
            this.scheduleRedirect(turnExpired ? SESSION_SEAT_TIMED_OUT : SESSION_SEAT_GONE);
            return true;
        }

        let nextPrivateState = this.snapshot.privateState;
        const handChanged =
            typeof data.handNumber === 'number' &&
            data.handNumber !== previousState?.handNumber;

        if (handChanged) {
            if (
                this.bufferedPrivateState &&
                this.bufferedPrivateState.handNumber === data.handNumber &&
                Boolean(myPlayer?.id) &&
                this.bufferedPrivateState.playerId === myPlayer?.id
            ) {
                nextPrivateState = { holeCards: this.bufferedPrivateState.holeCards };
                this.currentPrivateHandNumber = data.handNumber;
                this.currentPrivatePlayerId = this.bufferedPrivateState.playerId;
                if (this.bufferedPrivateState.playerId && (!myPlayer?.id || this.bufferedPrivateState.playerId === myPlayer.id)) {
                    myPlayerId = this.bufferedPrivateState.playerId;
                }
                this.bufferedPrivateState = null;
                this.privateSyncRevision += 1;
            } else {
                nextPrivateState = null;
                this.currentPrivateHandNumber = null;
                this.currentPrivatePlayerId = null;
                this.privateSyncRevision += 1;
                if (this.bufferedPrivateState && typeof data.handNumber === 'number' && this.bufferedPrivateState.handNumber <= data.handNumber) {
                    this.bufferedPrivateState = null;
                }
            }
        }

        if (this.currentPrivatePlayerId && myPlayer?.id !== this.currentPrivatePlayerId) {
            nextPrivateState = null;
            this.currentPrivateHandNumber = null;
            this.currentPrivatePlayerId = null;
        }

        this.updateSnapshot(() => ({
            gameState: data,
            privateState: nextPrivateState,
            error: data.phase !== previousState?.phase || data.gameId !== previousState?.gameId ||
                data.handNumber !== previousState?.handNumber ||
                data.currentPlayerName !== this.auth.playerName ? null : this.snapshot.error,
            showdown: nextShowdown,
            showdownResult: nextShowdownResult,
            myPlayerId,
            claimPending: this.claimRecoveryActive ? this.snapshot.claimPending : false,
        }));
        this.updateGameInactivity(data, this.snapshot.roomState);
        return true;
    }

    public applyPrivateState(payload: IncomingPrivateStatePayload | { holeCards: string[] } | null): void {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return;
        this.privateSyncRevision += 1;
        if (!payload) {
            this.currentPrivateHandNumber = null;
            this.currentPrivatePlayerId = null;
            this.updateSnapshot(() => ({
                privateState: null,
            }));
            return;
        }
        if (
            'handNumber' in payload &&
            typeof payload.handNumber === 'number' &&
            this.currentPrivateHandNumber !== null &&
            typeof this.currentPrivateHandNumber === 'number' &&
            payload.handNumber < this.currentPrivateHandNumber
        ) {
            return;
        }
        if (
            'handNumber' in payload &&
            typeof payload.handNumber === 'number' &&
            this.snapshot.gameState?.handNumber !== undefined &&
            typeof this.snapshot.gameState.handNumber === 'number' &&
            payload.handNumber < this.snapshot.gameState.handNumber
        ) {
            return;
        }
        const nextHoleCards = Array.isArray(payload.holeCards) ? payload.holeCards : [];
        if ('handNumber' in payload && typeof payload.handNumber === 'number') {
            this.currentPrivateHandNumber = payload.handNumber;
        } else {
            this.currentPrivateHandNumber = null;
        }
        this.currentPrivatePlayerId = 'playerId' in payload && typeof payload.playerId === 'string' ? payload.playerId : null;
        let myPlayerId = this.snapshot.myPlayerId;
        if ('playerId' in payload && payload.playerId) {
            const suppliedId = payload.playerId;
            const currentPlayers = this.snapshot.gameState?.players;
            if (this.auth.playerName && currentPlayers && currentPlayers.length > 0) {
                const hero = currentPlayers.find((p) => p.name === this.auth.playerName);
                if (hero) {
                    myPlayerId = hero.id;
                } else {
                    const matchedById = currentPlayers.find((p) => p.id === suppliedId);
                    if (matchedById && matchedById.name === this.auth.playerName) {
                        myPlayerId = suppliedId;
                    }
                }
            } else {
                myPlayerId = suppliedId;
            }
        }
        this.updateSnapshot(() => ({
            privateState: { holeCards: nextHoleCards },
            myPlayerId,
        }));
    }

    public setGameState(gameState: GameState | null): void {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return;
        let myPlayerId: string | null = null;
        if (gameState) {
            myPlayerId = this.snapshot.myPlayerId;
            if (gameState.players) {
                const hero = gameState.players.find((p) => p.name === this.auth.playerName);
                if (hero?.id) {
                    myPlayerId = hero.id;
                } else if (this.auth.playerName && myPlayerId && !gameState.players.some((p) => p.id === myPlayerId && p.name === this.auth.playerName)) {
                    myPlayerId = null;
                }
            }
        }
        this.updateSnapshot(() => ({
            gameState,
            myPlayerId,
        }));
    }

    public setShowdown(v: GameState | null): void {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return;
        this.updateSnapshot(() => ({
            showdown: v,
        }));
    }

    public setShowdownResult(v: GameState | null): void {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return;
        this.updateSnapshot(() => ({
            showdownResult: v,
        }));
    }

    public setRoomState(room: RoomState | null): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => ({
            roomState: room,
        }));
        this.updateLobbyInactivity(room);
    }

    public setLoadingStatus(status: string): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => ({
            loadingStatus: status,
        }));
    }

    public setMyPlayerId(id: string | null): void {
        if (!this.attached || this.isDisposed) return;
        let effectiveId = id;
        if (id && this.auth.playerName && this.snapshot.gameState?.players) {
            const hero = this.snapshot.gameState.players.find((p) => p.name === this.auth.playerName);
            if (hero && hero.id !== id) {
                effectiveId = hero.id;
            }
        }
        this.updateSnapshot(() => ({
            myPlayerId: effectiveId,
        }));
    }

    public setClaimPending(pending: boolean): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => ({
            claimPending: pending,
        }));
    }

    public setWsStatus(status: WsStatus): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => ({
            wsStatus: status,
        }));
    }

    public setHydrated(hydrated: boolean): void {
        if (!this.attached || this.isDisposed || this.snapshot.isGameOver) return;
        this.updateSnapshot(() => ({
            isHydrated: hydrated,
        }));
    }

    public setRecoveryState(partial: {
        isRecovering?: boolean;
        recoveryFailed?: boolean;
        loadingStatus?: string;
    }): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => partial);
    }

    public scheduleRecoveryRetry(callback: () => void, delayMs: number): void {
        this.clearRecoveryTimer();
        const targetEpoch = this.attachmentEpoch;
        const targetRecoveryGen = this.recoveryGeneration;
        this.recoveryTimer = this.clock.setTimeout(() => {
            this.recoveryTimer = null;
            if (!this.attached || this.isDisposed || this.attachmentEpoch !== targetEpoch || this.recoveryGeneration !== targetRecoveryGen) {
                return;
            }
            callback();
        }, delayMs);
    }

    public clearRecoveryTimer = (): void => {
        if (this.recoveryTimer !== null) {
            this.clock.clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }
    };

    public hasPendingRecoveryTimer = (): boolean => {
        return this.recoveryTimer !== null;
    };

    public cancelRecovery = (): void => {
        this.claimRecoveryGeneration += 1;
        this.claimRecoveryController?.abort();
        this.claimRecoveryController = null;
        this.claimRecoveryActive = false;
        this.claimRecoveryGameId = null;
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.attemptId += 1;
        this.recoveryGeneration += 1;
        this.recoveryRetryAttempt = 0;
        this.clearRecoveryTimer();
        this.updateSnapshot(() => ({
            isRecovering: false,
            recoveryFailed: false,
        }));
    };

    public synchronizeSession = (
        options: { resetBudget?: boolean } = {}
    ): Promise<void> => {
        if (!this.hasLifecyclePermission()) {
            return Promise.resolve();
        }

        if (this.claimRecoveryActive) return Promise.resolve();
        const shouldResetBudget = options?.resetBudget || Boolean(this.snapshot.recoveryFailed);
        if (shouldResetBudget) {
            this.recoveryRetryAttempt = 0;
            this.clearRecoveryTimer();
        }

        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }

        const attempt = ++this.attemptId;
        const attemptRoomRevision = this.roomRevision;
        const attemptPrivateRevision = this.privateSyncRevision;
        const attemptStateSyncRevision = this.stateSyncRevision;
        const controller = new AbortController();
        this.activeAttemptController = controller;

        const showRecoveringOverlay =
            this.recoveryRetryAttempt > 0 ||
            Boolean(this.snapshot.isRecovering) ||
            Boolean(this.snapshot.recoveryFailed);

        this.updateSnapshot(() => ({
            isRecovering: showRecoveringOverlay,
            recoveryFailed: false,
            loadingStatus: !this.snapshot.isHydrated && this.recoveryRetryAttempt === 0
                ? STATUS_CONNECTING
                : STATUS_RECOVERING_TABLE,
        }));

        return loadSessionData({
            auth: this.auth,
            isStarted: () => this.isStarted(),
            isHydrated: () => this.snapshot.isHydrated,
            signal: controller.signal,
            pokerApi: this.api,
        })
            .then((result) => {
                if (controller.signal.aborted || attempt !== this.attemptId) {
                    return;
                }
                if (!this.hasLifecyclePermission()) {
                    return;
                }
                this.commitSyncResult(result, attempt, attemptRoomRevision, attemptPrivateRevision, attemptStateSyncRevision);
            })
            .catch((err) => {
                if (controller.signal.aborted || attempt !== this.attemptId) {
                    return;
                }
                if (!this.hasLifecyclePermission()) {
                    return;
                }
                this.handleSyncFailure(err);
            })
            .finally(() => {
                if (this.activeAttemptController === controller) {
                    this.activeAttemptController = null;
                }
            });
    };

    public recoverClaimReview = async (
        targetGameId: string,
        originalErr?: unknown,
        options: { resetBudget?: boolean } = {}
    ): Promise<void> => {
        if (this.snapshot.isGameOver || this.isDisposed || !this.hasLifecyclePermission()) {
            return;
        }
        this.claimRecoveryController?.abort();
        const generation = ++this.claimRecoveryGeneration;
        this.claimRecoveryActive = true;
        this.claimRecoveryGameId = targetGameId;
        if (originalErr !== undefined) this.claimRecoveryOriginalError = originalErr;
        if (options.resetBudget || Boolean(this.snapshot.recoveryFailed)) {
            this.recoveryRetryAttempt = 0;
            this.clearRecoveryTimer();
        }
        const controller = new AbortController();
        this.claimRecoveryController = controller;

        this.updateSnapshot(() => ({
            claimPending: true,
            isRecovering: true,
            recoveryFailed: false,
            loadingStatus: STATUS_RECOVERING_TABLE,
        }));

        try {
            const raw = await this.api.getReview(targetGameId, this.auth.token, controller.signal);
            const review = decodeGameEndResult(raw, targetGameId);
            if (!review) throw new Error('Malformed game review response');
            if (generation !== this.claimRecoveryGeneration || controller.signal.aborted || this.isDisposed || !this.hasLifecyclePermission()) return;
            this.installTerminalResult(review);
        } catch (err) {
            if (generation !== this.claimRecoveryGeneration || controller.signal.aborted || this.snapshot.isGameOver || this.isDisposed || !this.hasLifecyclePermission()) {
                return;
            }
            const status = getErrorStatusCode(err);
            if (status === 403) {
                this.clearRecoveryTimer();
                this.claimRecoveryActive = false;
                this.updateSnapshot(() => ({
                    claimPending: false,
                    isRecovering: false,
                    recoveryFailed: false,
                }));
                this.scheduleRedirect(SESSION_SEAT_GONE);
                return;
            }
            if (status === 401) {
                this.cancelRecovery();
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: this.auth.token } }));
                }
                return;
            }

            this.clearRecoveryTimer();
            if (this.recoveryRetryAttempt < MAX_RECOVERY_RETRIES) {
                this.recoveryRetryAttempt += 1;
                const delayMs = this.computeRecoveryBackoffMs(this.recoveryRetryAttempt);
                this.updateSnapshot(() => ({
                    claimPending: true,
                    isRecovering: true,
                    recoveryFailed: false,
                    loadingStatus: STATUS_RECOVERING_TABLE,
                }));
                this.scheduleRecoveryRetry(() => {
                    if (generation === this.claimRecoveryGeneration && this.hasLifecyclePermission() && !this.snapshot.isGameOver) {
                        void this.recoverClaimReview(targetGameId, originalErr);
                    }
                }, delayMs);
            } else {
                this.updateSnapshot(() => ({
                    claimPending: false,
                    isRecovering: false,
                    recoveryFailed: true,
                    loadingStatus: STATUS_RECOVERING_TABLE,
                }));
            }
        } finally {
            if (this.claimRecoveryController === controller) this.claimRecoveryController = null;
        }
    };

    public claimWin = async (targetGameId: string): Promise<void> => {
        if (this.snapshot.isGameOver || this.isDisposed || !this.hasLifecyclePermission()) return;
        if (this.claimRecoveryActive) return;
        this.cancelRecovery();
        this.claimRecoveryActive = true;
        this.claimRecoveryGameId = targetGameId;
        this.recoveryRetryAttempt = 0;
        const generation = ++this.claimRecoveryGeneration;
        const controller = new AbortController();
        this.claimRecoveryController = controller;
        this.updateSnapshot(() => ({ claimPending: true, recoveryFailed: false, isRecovering: false }));
        try {
            const response = await this.api.claimWin(targetGameId, this.auth.token, controller.signal);
            const result = decodeGameEndResult(response?.data, targetGameId);
            if (!result) throw new Error('Malformed claim response');
            if (generation !== this.claimRecoveryGeneration || controller.signal.aborted) return;
            if (!this.isDisposed && this.hasLifecyclePermission()) {
                this.installTerminalResult(result);
            }
        } catch (err) {
            if (generation !== this.claimRecoveryGeneration || controller.signal.aborted) return;
            if (this.snapshot.isGameOver || this.isDisposed || !this.hasLifecyclePermission()) return;
            const status = getErrorStatusCode(err);
            if (status === 401) {
                this.cancelRecovery();
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: this.auth.token } }));
                }
                return;
            }
            if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
                this.claimRecoveryActive = false;
                this.claimRecoveryGameId = null;
                this.setClaimPending(false);
                this.setNotification(normalizeErrorMessage(err instanceof Error ? err.message : 'Claim failed') ?? 'Claim failed');
                throw err;
            }
            this.claimRecoveryController = null;
            await this.recoverClaimReview(targetGameId, err, { resetBudget: true });
        } finally {
            if (this.claimRecoveryController === controller) this.claimRecoveryController = null;
        }
    };

    public isClaimReviewRecovering(): boolean { return this.claimRecoveryActive; }

    public retryClaimReview(): void {
        if (!this.claimRecoveryActive || this.snapshot.isGameOver) return;
        void this.recoverClaimReview(this.claimRecoveryGameId ?? this.auth.roomId, this.claimRecoveryOriginalError, { resetBudget: true });
    }

    public recoverState = (
        _step?: () => Promise<void>,
        options: { resetBudget: boolean } = { resetBudget: false }
    ): Promise<void> => {
        return this.synchronizeSession(options);
    };

    private commitSyncResult(
        result: SyncResult,
        attemptId: number,
        attemptRoomRevision: number,
        attemptPrivateRevision: number,
        attemptStateSyncRevision: number
    ): void {
        if (attemptId !== this.attemptId) {
            return;
        }

        if (result.type === 'TERMINAL') {
            this.installTerminalResult(result.review);
            return;
        }

        if (result.type === 'LOBBY') {
            if (this.roomRevision === attemptRoomRevision) {
                this.updateSnapshot(() => ({
                    roomState: result.room,
                }));
                this.updateLobbyInactivity(result.room);
            }
            if (result.room.gameStarted) {
                this.markGameStarted();
            }
            this.recoveryRetryAttempt = 0;
            this.clearRecoveryTimer();
            this.updateSnapshot(() => ({
                isHydrated: true,
                loadingStatus: STATUS_CONNECTED,
                isRecovering: false,
                recoveryFailed: false,
            }));
            return;
        }

        if (result.type === 'LIVE') {
            this.beginSnapshotBatch();
            try {
                this.markGameStarted();
                if (result.room && this.roomRevision === attemptRoomRevision) {
                    this.updateSnapshot(() => ({ roomState: result.room ?? null }));
                }
                this.clearLobbyInactivityTimer();
                const isUnorderedLegacy =
                    result.publicState.handNumber == null || result.publicState.stateRevision == null;
                if (!isUnorderedLegacy || this.stateSyncRevision === attemptStateSyncRevision) {
                    this.applyGameState(result.publicState, this.clock.now());
                }

                const current = this.snapshot.gameState;
                const hero = current?.players.find((p) => p.name === this.auth.playerName);
                const currentHandSeq = typeof current?.handNumber === 'number' ? current.handNumber : 0;
                const privateHandSeq = typeof this.currentPrivateHandNumber === 'number' ? this.currentPrivateHandNumber : (this.currentPrivateHandNumber === null ? null : 0);
                const restHandSeq = typeof result.privateState?.handNumber === 'number' ? result.privateState.handNumber : 0;

                const privateMatchesCurrent = Boolean(
                    current && hero?.id && this.snapshot.privateState &&
                    privateHandSeq !== null &&
                    privateHandSeq === currentHandSeq &&
                    this.currentPrivatePlayerId === hero.id
                );
                const restMatchesCurrent = Boolean(
                    current && hero?.id &&
                    restHandSeq === currentHandSeq &&
                    (privateHandSeq === null || restHandSeq >= privateHandSeq) &&
                    result.privateState.playerId === hero.id
                );

                const newerCoherentPrivate = this.privateSyncRevision > attemptPrivateRevision && privateMatchesCurrent;
                if (!newerCoherentPrivate && restMatchesCurrent) {
                    this.applyPrivateState(result.privateState);
                }

                const coherent = Boolean(
                    current && hero?.id && this.snapshot.privateState &&
                    (typeof this.currentPrivateHandNumber === 'number' ? this.currentPrivateHandNumber : 0) === currentHandSeq &&
                    this.currentPrivatePlayerId === hero.id
                );
                if (coherent) {
                    this.recoveryRetryAttempt = 0;
                    this.clearRecoveryTimer();
                    this.updateSnapshot(() => ({
                        isHydrated: true,
                        loadingStatus: STATUS_CONNECTED,
                        isRecovering: false,
                        recoveryFailed: false,
                    }));
                } else {
                    if (!this.snapshot.isHydrated) this.updateSnapshot(() => ({ isHydrated: false }));
                    this.scheduleNextRecoveryRetry();
                }
            } finally {
                this.endSnapshotBatch();
            }
        }
    }

    private handleSyncFailure(err: unknown): void {
        const code = getErrorStatusCode(err);
        if (code === 401) {
            this.cancelRecovery();
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: this.auth.token } }));
            }
            return;
        }
        if (code === 403) {
            this.cancelRecovery();
            if (this.isLeavingPending) {
                return;
            }
            this.scheduleRedirect(SESSION_SEAT_GONE);
            return;
        }
        if (code === 404) {
            this.cancelRecovery();
            this.scheduleRedirect(SESSION_EXPIRED);
            return;
        }

        logger.warn('State recovery attempt failed:', err);
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.attemptId += 1;
        this.scheduleNextRecoveryRetry();
    }

    private scheduleNextRecoveryRetry(): void {
        if (this.snapshot.isGameOver || this.isDisposed || !this.hasLifecyclePermission()) {
            return;
        }
        if (this.activeAttemptController) {
            this.activeAttemptController.abort();
            this.activeAttemptController = null;
        }
        this.attemptId += 1;
        this.clearRecoveryTimer();
        if (this.recoveryRetryAttempt < MAX_RECOVERY_RETRIES) {
            this.recoveryRetryAttempt += 1;
            const delayMs = this.computeRecoveryBackoffMs(this.recoveryRetryAttempt);
            this.updateSnapshot(() => ({
                isRecovering: true,
                recoveryFailed: false,
                loadingStatus: STATUS_RECOVERING_TABLE,
            }));
            this.scheduleRecoveryRetry(() => {
                if (this.hasLifecyclePermission()) {
                    void this.synchronizeSession();
                }
            }, delayMs);
        } else {
            this.updateSnapshot(() => ({
                isRecovering: false,
                recoveryFailed: true,
                loadingStatus: this.snapshot.isHydrated ? STATUS_RECOVERING_TABLE : ERROR_INITIAL_TABLE_LOAD,
            }));
        }
    }

    public installTerminalResult(result: GameEndResult): void {
        if (this.snapshot.isGameOver || !this.attached || this.isDisposed) return;

        this.clearRecoveryTimer();
        this.clearRedirectTimer();
        this.isRedirecting = false;
        this.cancelActionLocks();
        this.clearShowdownTimers();
        this.clearNotificationTimer();
        this.recoveryRetryAttempt = 0;

        let nextGameState = this.snapshot.gameState;
        if (result.finalState) {
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

        const stateForWinner = nextGameState ?? this.snapshot.gameState;
        const winnerName = result.winnerName;
        const fallbackWinnerChips = winnerName
            ? stateForWinner?.players.find((p) => p.name === winnerName)?.chips
            : undefined;
        const winnerChips =
            typeof result.winnerChips === 'number' && result.winnerChips > 0
                ? result.winnerChips
                : (fallbackWinnerChips ?? result.winnerChips);

        const terminalResult: GameEndResult = {
            ...result,
            winnerChips,
            finalState: nextGameState ?? undefined,
        };

        this.cancelRecovery();
        this.setGameEndResult(terminalResult);
        this.updateSnapshot(() => ({
            isHydrated: true,
            loadingStatus: STATUS_CONNECTED,
            isRecovering: false,
            recoveryFailed: false,
        }));
    }

    private computeRecoveryBackoffMs(attempt: number): number {
        const expDelay = Math.min(
            MAX_RETRY_DELAY_MS,
            BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
        );
        const jitter = Math.abs(Math.imul(this.clock.now() ^ attempt, 2654435761)) % 250;
        return Math.min(MAX_RETRY_DELAY_MS, expDelay + jitter);
    }

    public setGameEndResult(result: GameEndResult | null): void {
        if (!this.attached || this.isDisposed) return;
        if (result !== null) {
            this.cancelActionLocks();
            this.clearRedirectTimer();
            this.clearLobbyInactivityTimer();
            this.clearGameInactivityTimer();
            this.isRedirecting = false;
        }
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
        this.cancelRecovery();
        this.updateSnapshot(() => ({
            gameEndResult: result,
            isGameOver: result !== null,
            isRedirecting: result !== null ? false : this.isRedirecting,
            isLobbyInactivityWarningActive: result !== null ? false : this.snapshot.isLobbyInactivityWarningActive,
            isGameInactivityWarningActive: result !== null ? false : this.snapshot.isGameInactivityWarningActive,
            claimPending: false,
            gameState: nextGameState,
            showdown: null,
            showdownResult: null,
            notification: null,
            isRecovering: result !== null ? false : this.snapshot.isRecovering,
            recoveryFailed: result !== null ? false : this.snapshot.recoveryFailed,
        }));
    }

    public clearGameState(): void {
        if (!this.attached || this.isDisposed) return;
        this.clearShowdownTimers();
        this.cancelActionLocks();
        this.cancelRecovery();
        this.clearGameInactivityTimer();
        this.updateSnapshot(() => ({
            gameState: null,
            error: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            claimPending: false,
            myPlayerId: null,
            gameEndResult: null,
            isGameOver: false,
            isGameInactivityWarningActive: false,
        }));
    }

    public clearError(): void {
        if (!this.attached || this.isDisposed) return;
        this.updateSnapshot(() => ({
            error: null,
        }));
    }

    // ── Actions & Locking ─────────────────────────────────────────────────────────

    public playAction(action: PokerAction, amount?: number): void {
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
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
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
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
        if (!this.attached || this.isDisposed || this.isRedirecting || this.snapshot.isGameOver) return;
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

        const targetEpoch = this.attachmentEpoch;
        const timer = this.clock.setTimeout(() => {
            if (!this.attached || this.isDisposed || this.attachmentEpoch !== targetEpoch) return;
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
        if (!this.attached || this.isDisposed) return;
        this.clearNotificationTimer();
        this.updateSnapshot(() => ({
            notification: msg,
            notificationSequence: msg === null ? this.notificationSequence : ++this.notificationSequence,
        }));

        if (msg !== null && ms > 0) {
            const targetEpoch = this.attachmentEpoch;
            this.notificationTimer = this.clock.setTimeout(() => {
                this.notificationTimer = null;
                if (!this.attached || this.isDisposed || this.attachmentEpoch !== targetEpoch) return;
                this.updateSnapshot(() => ({
                    notification: null,
                }));
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
        // Showdown timer retired; showdown results remain visible until next hand or departure.
    };

    private clearRedirectTimer(): void {
        if (this.redirectTimer !== null) {
            this.clock.clearTimeout(this.redirectTimer);
            this.redirectTimer = null;
        }
    }

    private clearLobbyInactivityTimer(): void {
        if (this.lobbyInactivityWarningTimer !== null) {
            this.clock.clearTimeout(this.lobbyInactivityWarningTimer);
            this.lobbyInactivityWarningTimer = null;
        }
    }

    private updateLobbyInactivity(room: RoomState | null): void {
        this.clearLobbyInactivityTimer();

        if (!room || room.gameStarted || typeof room.inactivityDeadlineEpochMs !== 'number') {
            if (this.snapshot.isLobbyInactivityWarningActive) {
                this.updateSnapshot(() => ({ isLobbyInactivityWarningActive: false }));
            }
            return;
        }

        if (typeof room.serverTimeEpochMs === 'number') {
            this.serverClockOffsetMs = room.serverTimeEpochMs - this.clock.now();
        }

        const remainingMs = room.inactivityDeadlineEpochMs - this.displayNow();
        if (remainingMs <= INACTIVITY_WARNING_WINDOW_MS) {
            if (!this.snapshot.isLobbyInactivityWarningActive) {
                this.updateSnapshot(() => ({ isLobbyInactivityWarningActive: true }));
            }
            return;
        }

        if (this.snapshot.isLobbyInactivityWarningActive) {
            this.updateSnapshot(() => ({ isLobbyInactivityWarningActive: false }));
        }

        const delayUntilWarningMs = remainingMs - INACTIVITY_WARNING_WINDOW_MS;
        this.lobbyInactivityWarningTimer = this.clock.setTimeout(() => {
            this.lobbyInactivityWarningTimer = null;
            this.updateSnapshot(() => ({ isLobbyInactivityWarningActive: true }));
        }, Math.max(0, delayUntilWarningMs));
    }

    private clearGameInactivityTimer(): void {
        if (this.gameInactivityWarningTimer !== null) {
            this.clock.clearTimeout(this.gameInactivityWarningTimer);
            this.gameInactivityWarningTimer = null;
        }
    }

    private updateGameInactivity(gameState: GameState | null, room?: RoomState | null): void {
        this.clearGameInactivityTimer();

        const deadline = gameState?.inactivityDeadlineEpochMs ?? room?.inactivityDeadlineEpochMs;
        if (this.snapshot.isGameOver || typeof deadline !== 'number') {
            if (this.snapshot.isGameInactivityWarningActive) {
                this.updateSnapshot(() => ({ isGameInactivityWarningActive: false }));
            }
            return;
        }

        const serverTime = gameState?.serverTimeEpochMs ?? room?.serverTimeEpochMs;
        if (typeof serverTime === 'number') {
            this.serverClockOffsetMs = serverTime - this.clock.now();
        }

        const remainingMs = deadline - this.displayNow();
        if (remainingMs <= INACTIVITY_WARNING_WINDOW_MS) {
            if (!this.snapshot.isGameInactivityWarningActive) {
                this.updateSnapshot(() => ({ isGameInactivityWarningActive: true }));
            }
            return;
        }

        if (this.snapshot.isGameInactivityWarningActive) {
            this.updateSnapshot(() => ({ isGameInactivityWarningActive: false }));
        }

        const delayUntilWarningMs = remainingMs - INACTIVITY_WARNING_WINDOW_MS;
        this.gameInactivityWarningTimer = this.clock.setTimeout(() => {
            this.gameInactivityWarningTimer = null;
            this.updateSnapshot(() => ({ isGameInactivityWarningActive: true }));
        }, Math.max(0, delayUntilWarningMs));
    }
}
