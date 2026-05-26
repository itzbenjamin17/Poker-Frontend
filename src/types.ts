import { cn } from './lib/cn';

export { cn };

export type PlayerStatus = 'ACTIVE' | 'FOLDED' | 'OUT' | 'ALL_IN' | 'DISCONNECTED';
export type WsStatus = 'connected' | 'reconnecting' | 'disconnected';
export type GamePhase = 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface Player {
    id: string;
    name: string;
    chips: number;
    status: PlayerStatus;
    disconnectDeadlineEpochMs?: number;
    isReadyForNextHand?: boolean;
    currentBet: number;
    hasFolded: boolean;
    isSmallBlind?: boolean;
    isBigBlind?: boolean;
    isAllIn?: boolean;
    isCurrentPlayer?: boolean;
    holeCards?: string[];
    handRank?: string;
    bestHand?: string[];
    isWinner?: boolean;
    chipsWon?: number;
}

export interface GameState {
    gameId: string;
    maxPlayers: number;
    pot: number;
    pots?: number[];
    uncalledAmount?: number;
    phase: GamePhase;
    currentBet: number;
    communityCards: string[];
    players: Player[];
    currentPlayerName: string;
    currentPlayerId: string;
    winners?: string[];
    winningsPerPlayer?: number;
    isAutoAdvancing?: boolean;
    autoAdvanceMessage?: string;
    isReadyCountdownActive?: boolean;
    readyCountdownDeadlineEpochMs?: number;
    claimWinAvailable?: boolean;
    claimWinPlayerName?: string;
}

/** Shape broadcast by the backend: ApiResponse<RoomDataResponse> */
export interface RoomUpdate {
    message: 'ROOM_CREATED' | 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'ROOM_CLOSED';
    data: {
        roomId: string;
        roomName?: string;
        players?: { name: string; isHost: boolean; joinedAt?: string }[];
        maxPlayers?: number;
        buyIn?: number;
        smallBlind?: number;
        bigBlind?: number;
        canStartGame?: boolean;
        gameStarted?: boolean;
    };
}

export interface RoomDataResponse {
    roomId: string;
    roomName: string;
    maxPlayers: number;
    buyIn: number;
    smallBlind: number;
    bigBlind: number;
    createdAt: string;
    hostName: string;
    players: {
        name: string;
        isHost: boolean;
        joinedAt: string;
    }[];
    currentPlayers: number;
    canStartGame: boolean;
    gameStarted: boolean;
}

/** Derived lobby state used internally by GameView / GameContext */
export interface RoomState {
    roomId: string;
    roomName?: string;
    players?: { name: string; isHost: boolean; joinedAt?: string }[];
    maxPlayers?: number;
    buyIn?: number;
    smallBlind?: number;
    bigBlind?: number;
    canStartGame?: boolean;
    gameStarted?: boolean;
}

export interface AuthResponse {
    message: string;
    token: string;
    roomId: string;
    playerName: string;
    // NOTE: playerId is NOT part of the auth response from the backend.
    // It is obtained later from game state (PublicGameStateResponse.players[].id).
}

// ─── GameView internal types (exported for hook/component use) ─────────────────

export type IncomingGameStatePayload = Omit<GameState, 'gameId' | 'claimWinAvailable' | 'claimWinPlayerName' | 'uncalledAmount' | 'pots'> & {
    gameId?: string;
    claimWinAvailable?: boolean | null;
    claimWinPlayerName?: string | null;
    uncalledAmount?: number | null;
    pots?: number[] | null;
    isReadyCountdownActive?: boolean | null;
    readyCountdownDeadlineEpochMs?: number | null;
};

export type IncomingPrivateStatePayload = {
    playerId?: string;
    holeCards?: string[] | null;
};

export type ShowdownModalLayout = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ShowdownModalInteractionState = {
    mode: 'drag' | 'resize';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLayout: ShowdownModalLayout;
};

export type SeatPosition = {
    left: number;
    top: number;
    cardPlacement: 'left' | 'right' | 'below';
};

export type TableTier = 'compact' | 'standard' | 'wide';
