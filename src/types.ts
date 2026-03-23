import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type PlayerStatus = 'ACTIVE' | 'FOLDED' | 'OUT' | 'ALL_IN';
export type GamePhase = 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface Player {
    id: string;
    name: string;
    chips: number;
    status: PlayerStatus;
    currentBet: number;
    hasFolded: boolean;
    holeCards?: string[]; // Only present in private state or showdown
    handRank?: string;    // Only present in showdown
    bestHand?: string[];
    isWinner?: boolean;
    chipsWon?: number;
}

export interface GameState {
    gameId: string;
    maxPlayers: number;
    pot: number;
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
}

export interface RoomUpdate {
    message: 'ROOM_CREATED' | 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'ROOM_CLOSED';
    data: {
        roomId: string;
        roomName?: string;
        players?: { name: string; isHost: boolean }[];
        maxPlayers?: number;
        canStart?: boolean;
        canStartGame?: boolean;
        player?: string;
        currentCount?: number;
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
}

export interface AuthResponse {
    message: string;
    token: string;
    roomId: string;
    playerName: string;
    playerId?: string;
}
