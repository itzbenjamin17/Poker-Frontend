import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type PlayerStatus = 'ACTIVE' | 'FOLDED' | 'OUT' | 'ALL_IN';
export type GamePhase = 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface Player {
    playerId: string;
    name: string;
    chips: number;
    status: PlayerStatus;
    currentBet: number;
    hasFolded: boolean;
    holeCards?: string[]; // Only present in private state
    handRank?: string;    // Only present in showdown
}

export interface GameState {
    gameId: string;
    maxPlayers: number;
    pot: number;
    phase: GamePhase;
    currentHighestBet: number;
    communityCards: string[];
    players: Player[];
    currentPlayerName: string;
    currentPlayerId: string;
}

export interface RoomUpdate {
    message: 'ROOM_CREATED' | 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'ROOM_CLOSED';
    data: {
        roomId: string;
        roomName?: string;
        players?: { name: string; isHost: boolean }[];
        maxPlayers?: number;
        canStart?: boolean;
        player?: string;
        currentCount?: number;
    };
}

export interface ShowdownUpdate {
    type: 'SHOWDOWN';
    winnerNames: string[];
    winnings: Record<string, number>;
    players: Player[];
    communityCards: string[];
    pot: number;
}

export interface AuthResponse {
    message: string;
    token: string;
    roomId: string;
    playerName: string;
    playerId: string;
}
