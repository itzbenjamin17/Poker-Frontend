import {
    useCallback,
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
    WsStatus,
} from '../types';
import { useShowdownTimers } from '../hooks/useShowdownTimers';
import {
    GameContext,
    type GameContextState,
    type Action,
    type GameContextValue,
} from './GameContext';

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
        case 'SET_GAME_END_RESULT': return { ...state, gameEndResult: action.payload };
        case 'CLEAR_GAME_STATE': return {
            ...state,
            gameState: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            claimPending: false,
            myPlayerId: null,
            gameEndResult: null,
        };
        default: return state;
    }
}

interface GameProviderProps {
    auth: AuthResponse;
    onLeave?: () => void;
    children: ReactNode;
}

export function GameProvider({ auth, onLeave, children }: GameProviderProps) {
    const [state, dispatch] = useReducer(reducer, {
        roomState: {
            roomId: auth.roomId,
            roomName: '',
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
        gameEndResult: null,
    });

    const latestGameStateRef = useRef<GameState | null>(null);
    const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const setShowdown = useCallback((v: GameState | null) => dispatch({ type: 'SET_SHOWDOWN', payload: v }), []);
    const setShowdownResult = useCallback((v: GameState | null) => dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: v }), []);

    const { clearShowdownTimers, scheduleShowdownHide } = useShowdownTimers(setShowdown, setShowdownResult);

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
            if (!hadWinnersBefore) dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: null });
            dispatch({ type: 'SET_SHOWDOWN', payload: data });
            dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: data });
            scheduleShowdownHide(data);
        } else if (data.phase === 'SHOWDOWN') {
            const currentShowdownResult = previousState?.phase === 'SHOWDOWN' ? previousState : null;
            if (currentShowdownResult && currentShowdownResult.winners && currentShowdownResult.winners.length > 0) {
                const mergedShowdownResult = {
                    ...currentShowdownResult,
                    isReadyCountdownActive: data.isReadyCountdownActive,
                    readyCountdownDeadlineEpochMs: data.readyCountdownDeadlineEpochMs,
                    players: currentShowdownResult.players.map(p => {
                        const updatedPlayer = data.players.find(up => up.id === p.id);
                        if (!updatedPlayer) return p;
                        return {
                            ...p,
                            chips: updatedPlayer.chips,
                            status: updatedPlayer.status,
                            isReadyForNextHand: updatedPlayer.isReadyForNextHand,
                            disconnectDeadlineEpochMs: updatedPlayer.disconnectDeadlineEpochMs,
                        };
                    })
                };
                dispatch({ type: 'SET_SHOWDOWN', payload: mergedShowdownResult });
                dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: mergedShowdownResult });
            } else {
                dispatch({ type: 'SET_SHOWDOWN', payload: data });
                dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: data });
            }
            if (data.isReadyCountdownActive) scheduleShowdownHide(data);
        } else {
            dispatch({ type: 'SET_SHOWDOWN', payload: null });
            dispatch({ type: 'SET_SHOWDOWN_RESULT', payload: null });
            clearShowdownTimers();
        }

        const myPlayer = data.players.find((p) => p.name === auth.playerName);
        if (myPlayer?.id) dispatch({ type: 'SET_MY_PLAYER_ID', payload: myPlayer.id });
    }, [auth.playerName, auth.roomId, clearShowdownTimers, scheduleShowdownHide]);

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
        setNotificationWithAutoDismiss,
    } as GameContextValue & { setNotificationWithAutoDismiss: typeof setNotificationWithAutoDismiss }), [
        state, auth, onLeave,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, scheduleShowdownHide,
        setNotificationWithAutoDismiss,
    ]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
