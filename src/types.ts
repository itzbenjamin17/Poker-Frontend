import { cn } from './lib/cn';

export { cn };

export type PlayerStatus = 'ACTIVE' | 'FOLDED' | 'OUT' | 'ALL_IN' | 'DISCONNECTED';
export type WsStatus = 'connected' | 'reconnecting' | 'disconnected';
export type GamePhase = 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
export type ReadyGateState = 'CLOSED' | 'COUNTING_DOWN' | 'WAITING_FOR_PLAYERS';
export type PokerAction = 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN';

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
    handNumber?: number;
    stateRevision?: number;
    serverTimeEpochMs?: number;
    readyGateState?: ReadyGateState;
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
    legalActions?: PokerAction[];
    minimumBetAmount?: number | null;
    minimumRaiseAmount?: number | null;
    winners?: string[];
    winningsPerPlayer?: number | null;
    handSettled?: boolean | null;
    carryOverAmount?: number | null;
    isAutoAdvancing?: boolean;
    autoAdvanceMessage?: string;
    isReadyCountdownActive?: boolean;
    readyCountdownDeadlineEpochMs?: number;
    claimWinAvailable?: boolean;
    claimWinPlayerName?: string;
}

/** Shape broadcast by the backend: ApiResponse<RoomDataResponse> */
export type RoomUpdate =
    | { message: 'ROOM_CLOSED'; data?: { roomId?: string; reason?: string } | null }
    | {
        message: 'ROOM_CREATED' | 'PLAYER_JOINED' | 'PLAYER_LEFT';
        data: Partial<RoomState> & { players: NonNullable<RoomState['players']> };
    }
    | {
        message: 'GAME_STARTED';
        data:
            | (Partial<RoomState> & { players: NonNullable<RoomState['players']> })
            | { gameId: string; message?: string };
    };

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
    inactivityDeadlineEpochMs?: number | null;
    serverTimeEpochMs?: number | null;
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
    inactivityDeadlineEpochMs?: number | null;
    serverTimeEpochMs?: number | null;
}

/** Generic API response wrapper matching Spring Boot's ApiResponse<T> envelope. */
export interface ApiResponse<T> {
    message: string;
    data: T;
}

/** Token and room identification payload returned by room create and join endpoints. */
export interface TokenResponse {
    token: string;
    roomId: string;
    playerName: string;
}

/** Wire response format returned by Spring Boot room creation and join endpoints. */
export type RoomAuthResponse = ApiResponse<TokenResponse>;

export interface AuthResponse {
    message: string;
    token: string;
    roomId: string;
    playerName: string;
    // NOTE: playerId is NOT part of the auth response from the backend.
    // It is obtained later from game state (PublicGameStateResponse.players[].id).
}

// ─── GameView internal types (exported for hook/component use) ─────────────────

export type IncomingGameStatePayload = Omit<
    GameState,
    | 'gameId'
    | 'claimWinAvailable'
    | 'claimWinPlayerName'
    | 'uncalledAmount'
    | 'pots'
    | 'isReadyCountdownActive'
    | 'readyCountdownDeadlineEpochMs'
    | 'handNumber'
    | 'stateRevision'
    | 'serverTimeEpochMs'
    | 'readyGateState'
> & {
    gameId?: string;
    claimWinAvailable?: boolean | null;
    claimWinPlayerName?: string | null;
    uncalledAmount?: number | null;
    pots?: number[] | null;
    isReadyCountdownActive?: boolean | null;
    readyCountdownDeadlineEpochMs?: number | null;
    handNumber?: number | null;
    stateRevision?: number | null;
    serverTimeEpochMs?: number | null;
    readyGateState?: ReadyGateState | null;
};

export type IncomingPrivateStatePayload = {
    playerId?: string;
    handNumber?: number;
    holeCards?: string[] | null;
};

export type SeatPosition = {
    left: number;
    top: number;
    cardPlacement: 'left' | 'right' | 'below' | 'above';
    panelPlacement: 'left' | 'centre' | 'right';
    side: 'left' | 'centre' | 'right';
    verticalZone: 'top' | 'middle' | 'bottom';
    /**
     * Where an opponent's hand-rank label goes: 'cards' puts it directly under the hole cards (seats whose cards sit
     * beside the avatar), 'avatar' keeps it under/next to the avatar (hero, cards-below seats, centre seats, heads-up).
     */
    labelPlacement: 'avatar' | 'cards';
};

export type TableTier = 'compact' | 'standard' | 'wide';

export interface ActionError {
    type: 'ACTION_ERROR';
    code: string;
    action: PokerAction | 'READY' | 'UNREADY';
    message: string;
}

export type Card = string;

export interface PrivatePlayerState {
    playerId: string;
    handNumber: number;
    holeCards: Card[];
}

export type PublicGameStateResponse = GameState;

export interface GameEndResult {
    gameId: string;
    winnerName: string | null;
    winnerChips?: number;
    isForfeit: boolean;
    message: string;
    finalState?: PublicGameStateResponse | null;
}

export interface SessionSnapshot {
    roomState: RoomState | null;
    gameState: GameState | null;
    privateState: { holeCards: string[] } | null;
    showdown: GameState | null;
    showdownResult: GameState | null;
    notification: string | null;
    notificationSequence?: number;
    loadingStatus: string;
    myPlayerId: string | null;
    claimPending: boolean;
    wsStatus: WsStatus;
    isHydrated: boolean;
    isGameOver: boolean;
    gameEndResult: GameEndResult | null;
    pendingActions: ReadonlySet<string>;
    error: ActionError | null;
    isRecovering?: boolean;
    recoveryFailed?: boolean;
    isRedirecting?: boolean;
    isLobbyInactivityWarningActive?: boolean;
}

