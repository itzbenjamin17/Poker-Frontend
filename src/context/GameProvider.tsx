import {
    useCallback,
    useEffect,
    useMemo,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import type {
    AuthResponse,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
} from '../types';
import {
    GameContext,
    type Action,
    type GameContextValue,
} from './GameContext';
import { GameSession } from '../domain/GameSession';
import { StompTransportAdapter, type GameTransport } from '../services/transport';
import { loadPersistedGameEnd, savePersistedGameEnd } from '../services/gameEndStorage';
import type { Clock } from '../domain/clock';

export interface GameProviderProps {
    auth: AuthResponse;
    onLeave?: () => void;
    session?: GameSession;
    transport?: GameTransport;
    clock?: Clock;
    children: ReactNode;
}

/**
 * Lean context compatibility wrapper: connects the in-process GameSession domain store
 * to React context consumers using useSyncExternalStore.
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
            transport: transportProp ?? new StompTransportAdapter(auth.token),
            clock,
            initialGameEndResult: persistedGameEnd,
            onLeave,
        });
    }, [sessionProp, auth, transportProp, clock, onLeave]);

    useEffect(() => {
        if (onLeave) {
            session.setOnLeave(onLeave);
        }
    }, [session, onLeave]);

    // React external store subscription
    const state = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot
    );

    useEffect(() => {
        savePersistedGameEnd(auth.roomId, state.gameEndResult);
    }, [auth.roomId, state.gameEndResult]);

    const dispatch = useCallback((action: Action) => {
        switch (action.type) {
            case 'SET_ROOM':
                session.setRoomState(action.payload);
                break;
            case 'SET_PRIVATE':
                session.applyPrivateState(action.payload);
                break;
            case 'SET_NOTIFICATION':
                session.setNotification(action.payload);
                break;
            case 'SET_LOADING_STATUS':
                session.setLoadingStatus(action.payload);
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
    }, [session]);

    const applyIncomingPrivateState = useCallback((payload: IncomingPrivateStatePayload) => {
        session.applyPrivateState(payload);
    }, [session]);

    const clearShowdownTimers = useCallback(() => {
        session.clearShowdownTimers();
    }, [session]);

    const retryConnection = useCallback(() => {
        session.retryConnection();
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
        pendingActions: state.pendingActions,
        error: state.error,
        isRecovering: state.isRecovering,
        recoveryFailed: state.recoveryFailed,
        auth,
        onLeave,
        session,
        transport: session.getTransport(),
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        retryConnection,
    }), [
        state,
        auth,
        onLeave,
        session,
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        retryConnection,
    ]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
