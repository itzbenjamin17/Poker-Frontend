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
    isDealer?: boolean;
    isAllIn?: boolean;
    isCurrentPlayer?: boolean;
    holeCards?: string[];
    handRank?: string;
    bestHand?: string[];
    isWinner?: boolean;
    chipsWon?: number;
}

export interface GameEnd {
    winner: string | null;
    winnerChips?: number;
    isForfeit: boolean;
    abandoned?: boolean;
    /** `INACTIVITY` for an abandoned game; for a forfeit win `TURN_TIMEOUT`, `PLAYER_LEFT` or `DISCONNECTED`. */
    reason?: string | null;
    /** For a forfeit win with a known reason: the players who forfeited, in seat order. */
    forfeitedPlayers?: string[];
    message: string;
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
    turnDeadlineEpochMs?: number;
    claimWinAvailable?: boolean;
    claimWinPlayerName?: string;
    inactivityDeadlineEpochMs?: number | null;
    gameEnd?: GameEnd | null;
}

export interface RoomDataResponse {
    roomId: string;
    roomName: string;
    maxPlayers: number;
    buyIn: number;
    smallBlind: number;
    bigBlind: number;
    players: {
        name: string;
        isHost: boolean;
    }[];
    canStartGame: boolean;
    gameStarted: boolean;
    gameFinished?: boolean;
    inactivityDeadlineEpochMs?: number | null;
    serverTimeEpochMs?: number | null;
    closedReason?: string | null;
}

/** Derived lobby state used internally by GameView / GameContext */
export interface RoomState {
    roomId: string;
    roomName?: string;
    players?: { name: string; isHost: boolean }[];
    maxPlayers?: number;
    buyIn?: number;
    smallBlind?: number;
    bigBlind?: number;
    canStartGame?: boolean;
    gameStarted?: boolean;
    gameFinished?: boolean;
    inactivityDeadlineEpochMs?: number | null;
    serverTimeEpochMs?: number | null;
    closedReason?: string | null;
}

/** Token and room identification payload returned by room create and join endpoints. */
export interface TokenResponse {
    token: string;
    roomId: string;
    playerName: string;
    // NOTE: playerId is NOT part of the auth response from the backend.
    // It is obtained later from game state (PublicGameStateResponse.players[].id).
}

export type AuthResponse = TokenResponse;

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
    | 'turnDeadlineEpochMs'
    | 'handNumber'
    | 'stateRevision'
    | 'serverTimeEpochMs'
    | 'readyGateState'
    | 'inactivityDeadlineEpochMs'
> & {
    gameId?: string;
    claimWinAvailable?: boolean | null;
    claimWinPlayerName?: string | null;
    uncalledAmount?: number | null;
    pots?: number[] | null;
    isReadyCountdownActive?: boolean | null;
    readyCountdownDeadlineEpochMs?: number | null;
    turnDeadlineEpochMs?: number | null;
    handNumber?: number | null;
    stateRevision?: number | null;
    serverTimeEpochMs?: number | null;
    readyGateState?: ReadyGateState | null;
    inactivityDeadlineEpochMs?: number | null;
    gameEnd?: GameEnd | null;
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

export interface PlayerNotification {
    type: 'PLAYER_NOTIFICATION';
    message: string;
}

export type Card = string;

export interface PrivatePlayerState {
    playerId: string;
    handNumber: number;
    holeCards: Card[];
}

export type PublicGameStateResponse = GameState;

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
    hasConnectedOnce?: boolean;
    isHydrated: boolean;
    isGameOver: boolean;
    gameEndResult: PublicGameStateResponse | null;
    pendingActions: ReadonlySet<string>;
    error: ActionError | null;
    isRecovering?: boolean;
    recoveryFailed?: boolean;
    isRedirecting?: boolean;
    isLobbyInactivityWarningActive?: boolean;
    isGameInactivityWarningActive?: boolean;
}

