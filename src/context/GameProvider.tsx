import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import type {
    AuthResponse,
    GameEndResult,
    GameState,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
} from '../types';
import {
    GameContext,
    type Action,
    type GameContextValue,
} from './GameContext';
import { GameSession } from '../domain/GameSession';
import { InMemoryTransportAdapter, type GameTransport } from '../services/transport';
import type { Clock } from '../domain/clock';

const GAME_END_STORAGE_PREFIX = 'poker-game-end:';

/**
 * Reads a previously frozen final-game snapshot from localStorage so a page
 * refresh during the post-game review can restore the review screen instead
 * of falling through to REST hydration (which 404s once the server has
 * cleaned up the room, kicking the player back to the lobby).
 */
function loadPersistedGameEnd(roomId: string): GameEndResult | null {
    try {
        const raw = localStorage.getItem(GAME_END_STORAGE_PREFIX + roomId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'isForfeit' in parsed && 'message' in parsed) {
            return parsed as GameEndResult;
        }
        return null;
    } catch {
        return null;
    }
}

function savePersistedGameEnd(roomId: string, result: GameEndResult | null): void {
    try {
        if (result) {
            localStorage.setItem(GAME_END_STORAGE_PREFIX + roomId, JSON.stringify(result));
        } else {
            localStorage.removeItem(GAME_END_STORAGE_PREFIX + roomId);
        }
    } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
}

export interface GameProviderProps {
    auth: AuthResponse;
    onLeave?: () => void;
    session?: GameSession;
    transport?: GameTransport;
    clock?: Clock;
    children: ReactNode;
}

/**
 * Expand-phase compatibility adapter: connects the in-process GameSession domain store
 * to legacy React context consumers using useSyncExternalStore.
 */
export function GameProvider({
    auth,
    onLeave,
    session: sessionProp,
    transport: transportProp,
    clock,
    children,
}: GameProviderProps) {
    const session = useMemo(() => {
        if (sessionProp) return sessionProp;
        const persistedGameEnd = loadPersistedGameEnd(auth.roomId);
        return new GameSession({
            auth,
            transport: transportProp ?? new InMemoryTransportAdapter(),
            clock,
            initialGameEndResult: persistedGameEnd,
            onLeave,
        });
    }, [sessionProp, auth, transportProp, clock, onLeave]);

    // React 18/19 concurrent external store subscription
    const state = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot
    );

    const latestGameStateRef = useRef<GameState | null>(null);
    const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        latestGameStateRef.current = state.gameState;
    }, [state.gameState]);

    useEffect(() => {
        savePersistedGameEnd(auth.roomId, state.gameEndResult);
    }, [auth.roomId, state.gameEndResult]);

    const dispatch = useCallback((action: Action) => {
        switch (action.type) {
            case 'SET_ROOM':
                session.setRoomState(action.payload);
                break;
            case 'SET_GAME':
                session.setGameState(action.payload);
                break;
            case 'SET_PRIVATE':
                session.applyPrivateState(action.payload);
                break;
            case 'SET_SHOWDOWN':
                session.setShowdown(action.payload);
                break;
            case 'SET_SHOWDOWN_RESULT':
                session.setShowdownResult(action.payload);
                break;
            case 'SET_NOTIFICATION':
                session.setNotification(action.payload);
                break;
            case 'SET_LOADING_STATUS':
                session.setLoadingStatus(action.payload);
                break;
            case 'SET_MY_PLAYER_ID':
                session.setMyPlayerId(action.payload);
                break;
            case 'SET_CLAIM_PENDING':
                session.setClaimPending(action.payload);
                break;
            case 'SET_WS_STATUS':
                session.setWsStatus(action.payload);
                break;
            case 'SET_HYDRATED':
                session.setHydrated(action.payload);
                break;
            case 'SET_GAME_END_RESULT':
                session.setGameEndResult(action.payload);
                break;
            case 'CLEAR_GAME_STATE':
                session.clearGameState();
                break;
        }
    }, [session]);

    const applyIncomingGameState = useCallback((payload: IncomingGameStatePayload) => {
        session.applyGameState(payload);
        latestGameStateRef.current = session.getSnapshot().gameState;
    }, [session]);

    const applyIncomingPrivateState = useCallback((payload: IncomingPrivateStatePayload) => {
        session.applyPrivateState(payload);
    }, [session]);

    const clearShowdownTimers = useCallback(() => {
        session.clearShowdownTimers();
    }, [session]);

    const scheduleShowdownHide = useCallback((s: GameState) => {
        session.scheduleShowdownHide(s);
    }, [session]);

    const setNotificationWithAutoDismiss = useCallback((msg: string | null, ms = 4000) => {
        session.setNotification(msg, ms);
    }, [session]);

    const value = useMemo<GameContextValue>(() => ({
        roomState: state.roomState,
        gameState: state.gameState,
        privateState: state.privateState,
        showdown: state.showdown,
        showdownResult: state.showdownResult,
        notification: state.notification,
        loadingStatus: state.loadingStatus,
        myPlayerId: state.myPlayerId,
        claimPending: state.claimPending,
        wsStatus: state.wsStatus,
        isHydrated: state.isHydrated,
        isGameOver: state.isGameOver,
        gameEndResult: state.gameEndResult,
        auth,
        onLeave,
        session,
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        scheduleShowdownHide,
        latestGameStateRef,
        notificationTimerRef,
        setNotificationWithAutoDismiss,
    } as GameContextValue & { setNotificationWithAutoDismiss: typeof setNotificationWithAutoDismiss; session: GameSession }), [
        state,
        auth,
        onLeave,
        session,
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        scheduleShowdownHide,
        setNotificationWithAutoDismiss,
    ]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
