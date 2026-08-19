import type { IncomingGameStatePayload, IncomingPrivateStatePayload } from '../types';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../constants/strings';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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
    if (msg.includes('Internal Server Error') || msg.includes('500')) return ERROR_TECHNICAL;
    if (msg.includes('java.lang') || msg.includes('org.springframework')) return ERROR_SYSTEM;
    const MAX_LENGTH = 80;
    return msg.length > MAX_LENGTH ? msg.substring(0, MAX_LENGTH - 3) + '...' : msg;
}
