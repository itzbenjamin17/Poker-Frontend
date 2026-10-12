import type {
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
    RoomDataResponse,
    RoomState,
    RoomUpdate,
} from '../types';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../constants/strings';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function isRoomDataPayload(value: unknown): value is RoomDataResponse {
    if (!isObject(value)) return false;
    return (
        (typeof value.roomId === 'string' || value.roomId === undefined) &&
        Array.isArray(value.players) &&
        value.players.every(
            (p) => isObject(p) && typeof p.name === 'string' && typeof p.isHost === 'boolean',
        )
    );
}

export function mapRoomDataToRoomState(
    roomData: RoomDataResponse,
    fallbackRoomId?: string,
): RoomState {
    return {
        roomId: roomData.roomId ?? fallbackRoomId ?? '',
        roomName: roomData.roomName,
        players: roomData.players.map((p) => ({
            name: p.name,
            isHost: p.isHost,
            joinedAt: p.joinedAt,
        })),
        maxPlayers: roomData.maxPlayers,
        buyIn: roomData.buyIn,
        smallBlind: roomData.smallBlind,
        bigBlind: roomData.bigBlind,
        canStartGame: roomData.canStartGame,
        gameStarted: roomData.gameStarted,
    };
}

export function isGameStatePayload(value: unknown): value is IncomingGameStatePayload {
    if (!isObject(value)) return false;
    return (
        (typeof value.gameId === 'string' || value.gameId === undefined) &&
        typeof value.phase === 'string' &&
        Array.isArray(value.players) &&
        Array.isArray(value.communityCards) &&
        typeof value.pot === 'number' &&
        (value.claimWinAvailable == null || typeof value.claimWinAvailable === 'boolean') &&
        (value.claimWinPlayerName == null || typeof value.claimWinPlayerName === 'string') &&
        (value.uncalledAmount == null || typeof value.uncalledAmount === 'number') &&
        (value.isReadyCountdownActive == null || typeof value.isReadyCountdownActive === 'boolean') &&
        (value.readyCountdownDeadlineEpochMs == null || typeof value.readyCountdownDeadlineEpochMs === 'number') &&
        (value.pots == null || (Array.isArray(value.pots) && value.pots.every((p) => typeof p === 'number')))
    );
}

export function isGameEndPayload(value: unknown): value is {
    type: string;
    winner?: string;
    winnerChips?: number;
    isForfeit?: boolean;
    message?: string;
    gameId?: string;
    finalState?: unknown;
} {
    if (!isObject(value)) return false;
    return (
        typeof value.type === 'string' &&
        value.type === 'GAME_END' &&
        (value.winner == null || typeof value.winner === 'string') &&
        (value.winnerChips == null || typeof value.winnerChips === 'number') &&
        (value.isForfeit == null || typeof value.isForfeit === 'boolean') &&
        (value.message == null || typeof value.message === 'string') &&
        (value.gameId == null || typeof value.gameId === 'string')
    );
}

export function isPrivateStatePayload(value: unknown): value is IncomingPrivateStatePayload {
    if (!isObject(value)) return false;
    return (
        (typeof value.playerId === 'string' || value.playerId === undefined) &&
        (value.holeCards == null ||
            (Array.isArray(value.holeCards) && value.holeCards.every((c) => typeof c === 'string')))
    );
}

export function isRoomUpdatePayload(value: unknown): value is RoomUpdate {
    if (!isObject(value) || typeof value.message !== 'string') return false;
    if (value.message === 'ROOM_CLOSED') {
        return value.data == null || isObject(value.data);
    }
    if (
        value.message === 'ROOM_CREATED' ||
        value.message === 'PLAYER_JOINED' ||
        value.message === 'PLAYER_LEFT'
    ) {
        if (!isObject(value.data)) return false;
        const data = value.data;
        return (
            (data.roomId == null || typeof data.roomId === 'string') &&
            (data.roomName == null || typeof data.roomName === 'string') &&
            Array.isArray(data.players) &&
            data.players.every((p) => isObject(p) && typeof p.name === 'string')
        );
    }
    return false;
}

export function getErrorStatusCode(error: unknown): number | undefined {
    if (!isObject(error)) return undefined;
    return typeof error.status === 'number' ? error.status : undefined;
}

export function normalizeErrorMessage(message: string | null): string | null {
    if (!message) return null;
    const msg = message.trim();
    if (msg.includes('Cannot deserialize') || msg.includes('JSON parse error') || msg.includes('HttpMessageNotReadable')) {
        return ERROR_INVALID_FORMAT;
    }
    if (/internal server error/i.test(msg) || /\b(?:status(?:\s+code)?|http|error)\s*:?\s*500\b/i.test(msg)) {
        return ERROR_TECHNICAL;
    }
    if (msg.includes('java.lang') || msg.includes('org.springframework')) return ERROR_SYSTEM;
    const MAX_LENGTH = 80;
    return msg.length > MAX_LENGTH ? msg.substring(0, MAX_LENGTH - 3) + '...' : msg;
}
