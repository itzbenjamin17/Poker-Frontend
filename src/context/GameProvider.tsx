import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
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
    onLeave?: (originatingToken?: string) => void;
    requestLeave?: (originatingToken?: string) => Promise<boolean>;
    leaveError?: string | null;
    session?: GameSession;
    transport?: GameTransport;
    clock?: Clock;
    children?: ReactNode;
}

/**
 * Lean context compatibility wrapper: connects the in-process GameSession domain store
 * to React context consumers using useSyncExternalStore.
 */
export function GameProvider({
    auth,
    onLeave,
    requestLeave,
    leaveError,
    session: sessionProp,
    transport: transportProp,
    clock,
    children,
}: GameProviderProps) {
    const { roomId, playerName, token, message } = auth;

    const session = useMemo(() => {
        if (sessionProp) return sessionProp;
        const persistedGameEnd = loadPersistedGameEnd(auth);
        return new GameSession({
            auth: { roomId, playerName, token, message },
            transport: transportProp ?? new StompTransportAdapter(token),
            clock,
            initialGameEndResult: persistedGameEnd,
        });
    }, [sessionProp, auth, roomId, playerName, token, message, transportProp, clock]);

    const onLeaveRef = useRef(onLeave);
    useEffect(() => {
        onLeaveRef.current = onLeave;
        if (session.isAttached()) {
            session.setOnLeave(onLeave);
        }
    }, [session, onLeave]);

    const activeSessionRef = useRef<GameSession | null>(null);

    useLayoutEffect(() => {
        if (activeSessionRef.current && activeSessionRef.current !== session) {
            activeSessionRef.current.detach();
        }
        activeSessionRef.current = session;
        session.attach();
        session.setOnLeave(onLeaveRef.current);
        return () => {
            session.detach();
            if (activeSessionRef.current === session) {
                activeSessionRef.current = null;
            }
        };
    }, [session, auth.roomId, auth.playerName, auth.token]);

    // React external store subscription
    const state = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot
    );

    // Persist terminal review snapshot bound to active auth credentials (roomId, playerName, token)
    useEffect(() => {
        if (!session.isAttached()) return;
        const sessionAuth = session.getAuth();
        if (
            sessionAuth.roomId !== auth.roomId ||
            sessionAuth.playerName !== auth.playerName ||
            sessionAuth.token !== auth.token
        ) {
            return;
        }
        savePersistedGameEnd(auth, state.gameEndResult);
    }, [auth, session, state.gameEndResult]);

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
            case 'INSTALL_TERMINAL_RESULT':
                session.installTerminalResult(action.payload);
                break;
            case 'CLEAR_GAME_STATE':
                session.clearGameState();
                break;
        }
    }, [session]);

    const applyIncomingGameState = useCallback((payload: IncomingGameStatePayload) => {
        return session.applyGameState(payload);
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
        notificationSequence: state.notificationSequence,
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
        isRedirecting: state.isRedirecting,
        isLobbyInactivityWarningActive: state.isLobbyInactivityWarningActive,
        auth,
        onLeave,
        requestLeave,
        leaveError,
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
        requestLeave,
        leaveError,
        session,
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        retryConnection,
    ]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
