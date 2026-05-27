/* eslint-disable react-refresh/only-export-components */
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useReducer,
    useRef,
    type ReactNode,
} from 'react';
import type {
    AuthResponse,
    GameState,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
    RoomState,
    WsStatus,
} from '../types';
import { useShowdownTimers } from '../hooks/useShowdownTimers';

// ─── State ────────────────────────────────────────────────────────────────────

export interface GameContextState {
    roomState: RoomState | null;
    gameState: GameState | null;
    privateState: { holeCards: string[] } | null;
    showdown: GameState | null;
    showdownResult: GameState | null;
    notification: string | null;
    loadingStatus: string;
    myPlayerId: string | null;
    claimPending: boolean;
    wsStatus: WsStatus;
    isHydrated: boolean;
}

type Action =
    | { type: 'SET_ROOM'; payload: RoomState | null }
    | { type: 'SET_GAME'; payload: GameState | null }
    | { type: 'SET_PRIVATE'; payload: { holeCards: string[] } | null }
    | { type: 'SET_SHOWDOWN'; payload: GameState | null }
    | { type: 'SET_SHOWDOWN_RESULT'; payload: GameState | null }
    | { type: 'SET_NOTIFICATION'; payload: string | null }
    | { type: 'SET_LOADING_STATUS'; payload: string }
    | { type: 'SET_MY_PLAYER_ID'; payload: string | null }
    | { type: 'SET_CLAIM_PENDING'; payload: boolean }
    | { type: 'SET_WS_STATUS'; payload: WsStatus }
    | { type: 'SET_HYDRATED'; payload: boolean }
    | { type: 'CLEAR_GAME_STATE' };

function reducer(state: GameContextState, action: Action): GameContextState {
    switch (action.type) {
        case 'SET_ROOM': return { ...state, roomState: action.payload };
        case 'SET_GAME': return { ...state, gameState: action.payload };
        case 'SET_PRIVATE': return { ...state, privateState: action.payload };
        case 'SET_SHOWDOWN': return { ...state, showdown: action.payload };
        case 'SET_SHOWDOWN_RESULT': return { ...state, showdownResult: action.payload };
        case 'SET_NOTIFICATION': return { ...state, notification: action.payload };
        case 'SET_LOADING_STATUS': return { ...state, loadingStatus: action.payload };
        case 'SET_MY_PLAYER_ID': return {
            ...state,
            myPlayerId: action.payload,
        };
        case 'SET_CLAIM_PENDING': return { ...state, claimPending: action.payload };
        case 'SET_WS_STATUS': return { ...state, wsStatus: action.payload };
        case 'SET_HYDRATED': return { ...state, isHydrated: action.payload };
        case 'CLEAR_GAME_STATE': return {
            ...state,
            gameState: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            claimPending: false,
            myPlayerId: null,
        };
        default: return state;
    }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface GameContextValue extends GameContextState {
    auth: AuthResponse;
    onLeave?: () => void;
    dispatch: React.Dispatch<Action>;
    // Stable callbacks (used by hooks)
    applyIncomingGameState: (payload: IncomingGameStatePayload) => void;
    applyIncomingPrivateState: (payload: IncomingPrivateStatePayload) => void;
    clearShowdownTimers: () => void;
    scheduleShowdownHide: (state: GameState) => void;
    // Stable refs
    latestGameStateRef: React.RefObject<GameState | null>;
    notificationTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
    const ctx = useContext(GameContext);
    if (!ctx) throw new Error('useGameContext must be used inside <GameProvider>');
    return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface GameProviderProps {
    auth: AuthResponse;
    onLeave?: () => void;
    children: ReactNode;
}

export function GameProvider({ auth, onLeave, children }: GameProviderProps) {
    const [state, dispatch] = useReducer(reducer, {
        roomState: {
            roomId: auth.roomId,
            roomName: auth.roomId,
            players: [{ name: auth.playerName, isHost: false }],
            gameStarted: false,
        },
        gameState: null,
        privateState: null,
        showdown: null,
        showdownResult: null,
        notification: null,
        loadingStatus: 'Connecting...',
        myPlayerId: null,
        claimPending: false,
        wsStatus: 'disconnected' as WsStatus,
        isHydrated: false,
    });

    // Stable refs to avoid stale closures in WebSocket callbacks
    const latestGameStateRef = useRef<GameState | null>(null);
    const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Notification helper ---
    const setNotificationWithAutoDismiss = useCallback((msg: string | null, ms = 4000) => {
        if (notificationTimerRef.current !== null) clearTimeout(notificationTimerRef.current);
        dispatch({ type: 'SET_NOTIFICATION', payload: msg });
        if (msg !== null && ms > 0) {
            notificationTimerRef.current = setTimeout(() => {
                dispatch({ type: 'SET_NOTIFICATION', payload: null });
                notificationTimerRef.current = null;
            }, ms);
        }
    }, []);

    // --- Showdown timers ---
    const setShowdown = useCallback((v: GameState | null) => dispatch({ type: 'SET_SHOWDOWN', payload: v }), []);
    const setShowdownResult = useCallback((v: GameState | null) => dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: v }), []);

    const { clearShowdownTimers, scheduleShowdownHide } = useShowdownTimers(setShowdown, setShowdownResult);

    // --- applyIncomingGameState ---
    const applyIncomingGameState = useCallback((payload: IncomingGameStatePayload) => {
        const incomingData: GameState = {
            ...payload,
            gameId: payload.gameId ?? auth.roomId,
            claimWinAvailable: payload.claimWinAvailable ?? undefined,
            claimWinPlayerName: payload.claimWinPlayerName ?? undefined,
            uncalledAmount: payload.uncalledAmount ?? undefined,
            pots: payload.pots ?? undefined,
            isReadyCountdownActive: payload.isReadyCountdownActive ?? undefined,
            readyCountdownDeadlineEpochMs: payload.readyCountdownDeadlineEpochMs ?? undefined,
        };

        const previousState = latestGameStateRef.current;
        let data = incomingData;
        const hadWinnersBefore = Boolean(previousState?.winners && previousState.winners.length > 0);

        // Preserve READY countdown state across stale payloads
        if (previousState?.phase === 'SHOWDOWN' && incomingData.phase === 'SHOWDOWN') {
            const prevReadyActive = Boolean(previousState.isReadyCountdownActive);
            const inReadyActive = Boolean(incomingData.isReadyCountdownActive);
            const prevDeadline = typeof previousState.readyCountdownDeadlineEpochMs === 'number' ? previousState.readyCountdownDeadlineEpochMs : undefined;
            const inDeadline = typeof incomingData.readyCountdownDeadlineEpochMs === 'number' ? incomingData.readyCountdownDeadlineEpochMs : undefined;
            const mergedDeadline = prevDeadline === undefined ? inDeadline : inDeadline === undefined ? prevDeadline : Math.max(prevDeadline, inDeadline);

            if (prevReadyActive && !inReadyActive) {
                data = { ...incomingData, isReadyCountdownActive: true, readyCountdownDeadlineEpochMs: mergedDeadline };
            } else if (inReadyActive && incomingData.readyCountdownDeadlineEpochMs == null && previousState.readyCountdownDeadlineEpochMs != null) {
                data = { ...incomingData, readyCountdownDeadlineEpochMs: previousState.readyCountdownDeadlineEpochMs };
            } else if (inReadyActive && mergedDeadline !== undefined) {
                data = { ...incomingData, readyCountdownDeadlineEpochMs: mergedDeadline };
            }
        }

        dispatch({ type: 'SET_GAME', payload: data });
        latestGameStateRef.current = data;

        if (data.winners && data.winners.length > 0) {
            if (!hadWinnersBefore) dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: null }); // Reset layout trigger
            dispatch({ type: 'SET_SHOWDOWN', payload: data });
            dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: data });
            scheduleShowdownHide(data);
        } else if (data.phase === 'SHOWDOWN' && data.isReadyCountdownActive) {
            scheduleShowdownHide(data);
        } else if (data.phase !== 'SHOWDOWN') {
            dispatch({ type: 'SET_SHOWDOWN', payload: null });
            dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: null });
            clearShowdownTimers();
        }

        // Discover myPlayerId from game state
        const myPlayer = data.players.find((p) => p.name === auth.playerName);
        if (myPlayer?.id) dispatch({ type: 'SET_MY_PLAYER_ID', payload: myPlayer.id });
    }, [auth.playerName, auth.roomId, clearShowdownTimers, scheduleShowdownHide]);

    // --- applyIncomingPrivateState ---
    const applyIncomingPrivateState = useCallback((payload: IncomingPrivateStatePayload) => {
        const nextHoleCards = Array.isArray(payload.holeCards) ? payload.holeCards : [];
        dispatch({ type: 'SET_PRIVATE', payload: { holeCards: nextHoleCards } });
        if (payload.playerId) dispatch({ type: 'SET_MY_PLAYER_ID', payload: payload.playerId });
    }, []);

    const value = useMemo<GameContextValue>(() => ({
        ...state,
        auth,
        onLeave,
        dispatch,
        applyIncomingGameState,
        applyIncomingPrivateState,
        clearShowdownTimers,
        scheduleShowdownHide,
        latestGameStateRef,
        notificationTimerRef,
        // Expose notification setter for hooks
        setNotificationWithAutoDismiss,
    } as GameContextValue & { setNotificationWithAutoDismiss: typeof setNotificationWithAutoDismiss }), [
        state, auth, onLeave,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, scheduleShowdownHide,
        setNotificationWithAutoDismiss,
    ]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// Export so hooks can access without going through context re-renders
export { type Action };
