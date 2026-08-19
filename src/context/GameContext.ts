import { createContext, useContext } from 'react';
import type {
    AuthResponse,
    GameState,
    GameEndResult,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
    RoomState,
    WsStatus,
} from '../types';

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
    isGameOver: boolean;
    gameEndResult: GameEndResult | null;
}

export type Action =
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
    | { type: 'SET_GAME_END_RESULT'; payload: GameEndResult | null }
    | { type: 'CLEAR_GAME_STATE' };

export interface GameContextValue extends GameContextState {
    auth: AuthResponse;
    onLeave?: () => void;
    dispatch: React.Dispatch<Action>;
    applyIncomingGameState: (payload: IncomingGameStatePayload) => void;
    applyIncomingPrivateState: (payload: IncomingPrivateStatePayload) => void;
    clearShowdownTimers: () => void;
    scheduleShowdownHide: (state: GameState) => void;
    latestGameStateRef: React.RefObject<GameState | null>;
    notificationTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
    const ctx = useContext(GameContext);
    if (!ctx) throw new Error('useGameContext must be used inside <GameProvider>');
    return ctx;
}
