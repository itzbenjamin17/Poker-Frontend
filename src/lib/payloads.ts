import type {
    ActionError,
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
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Check = (value: unknown) => boolean;
const text: Check = value => typeof value === 'string';
const boolean: Check = value => typeof value === 'boolean';
const nonnegative: Check = value =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const capacity: Check = value => nonnegative(value) && Number(value) >= 2 && Number(value) <= 10;
const optional = (check: Check): Check => value => value === undefined || check(value);
const nullable = (check: Check): Check => value => value == null || check(value);
const list = (check: Check, max = Infinity): Check => value =>
    Array.isArray(value) && value.length <= max && value.every(check);
const member = (values: readonly string[]): Check => value =>
    typeof value === 'string' && values.includes(value);
const card: Check = value => typeof value === 'string' && /^(?:[2-9TJQKA]|10)[CDHS]$/i.test(value);
const action = member(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN']);

function fields(value: unknown, schema: Record<string, Check>): boolean {
    return isObject(value) && Object.entries(schema).every(([key, check]) => check(value[key]));
}

const roomPlayer = (value: unknown): boolean => fields(value, {
    name: text, isHost: boolean, joinedAt: optional(text),
});

const player = (value: unknown): boolean => fields(value, {
    id: text, name: text, chips: nonnegative, currentBet: nonnegative,
    status: member(['ACTIVE', 'FOLDED', 'OUT', 'ALL_IN', 'DISCONNECTED']),
    hasFolded: boolean, disconnectDeadlineEpochMs: optional(nonnegative),
    isReadyForNextHand: optional(boolean), isSmallBlind: optional(boolean),
    isBigBlind: optional(boolean), isAllIn: optional(boolean),
    isCurrentPlayer: optional(boolean), holeCards: optional(list(card, 2)),
    handRank: optional(text), bestHand: optional(list(card, 5)),
    isWinner: optional(boolean), chipsWon: optional(nonnegative),
});

function omitNulls(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const result = { ...value };
    for (const key of keys) if (result[key] === null) delete result[key];
    return result;
}

/** Decode nullable wire metadata into the optional fields used by the domain. */
export function decodeGameStatePayload(value: unknown): IncomingGameStatePayload | null {
    if (!isObject(value) || !Array.isArray(value.players)) return null;
    const decoded = omitNulls(value, [
        'legalActions', 'winners', 'winningsPerPlayer', 'isAutoAdvancing',
        'autoAdvanceMessage',
    ]);
    // The backend uses null when no player currently has the turn.
    if (decoded.currentPlayerName === null) decoded.currentPlayerName = '';
    if (decoded.currentPlayerId === null) decoded.currentPlayerId = '';
    decoded.players = value.players.map(p => isObject(p) ? omitNulls(p, [
        'disconnectDeadlineEpochMs', 'isReadyForNextHand', 'isSmallBlind',
        'isBigBlind', 'isAllIn', 'isCurrentPlayer', 'holeCards', 'handRank',
        'bestHand', 'isWinner', 'chipsWon',
    ]) : p);
    return isGameStatePayload(decoded) ? decoded : null;
}

export function isRoomDataPayload(value: unknown): value is RoomDataResponse {
    return fields(value, {
        roomId: text, roomName: text, maxPlayers: capacity,
        buyIn: nonnegative, smallBlind: nonnegative, bigBlind: nonnegative,
        createdAt: text, hostName: text, currentPlayers: nonnegative,
        canStartGame: boolean, gameStarted: boolean,
        players: list(p => fields(p, { name: text, isHost: boolean, joinedAt: text }), 10),
    });
}

export function mapRoomDataToRoomState(
    roomData: RoomDataResponse,
    fallbackRoomId?: string,
): RoomState {
    return {
        roomId: roomData.roomId ?? fallbackRoomId ?? '',
        roomName: roomData.roomName,
        players: roomData.players.map(p => ({
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
    return fields(value, {
        gameId: optional(text), maxPlayers: capacity, pot: nonnegative,
        pots: nullable(list(nonnegative, 10)), uncalledAmount: nullable(nonnegative),
        phase: member(['PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN']),
        currentBet: nonnegative, communityCards: list(card, 5), players: list(player, 10),
        currentPlayerName: text, currentPlayerId: text,
        legalActions: optional(list(action, 6)), winners: optional(list(text, 10)),
        winningsPerPlayer: optional(nonnegative), isAutoAdvancing: optional(boolean),
        autoAdvanceMessage: optional(text), isReadyCountdownActive: nullable(boolean),
        readyCountdownDeadlineEpochMs: nullable(nonnegative),
        claimWinAvailable: nullable(boolean), claimWinPlayerName: nullable(text),
    });
}

export function isActionErrorPayload(value: unknown): value is ActionError {
    if (!isObject(value) || value.type !== 'ACTION_ERROR') return false;
    return Object.keys(value).length === 4 &&
        typeof value.code === 'string' && value.code.trim().length > 0 &&
        /^[A-Z][A-Z0-9_]*$/.test(value.code) &&
        action(value.action) &&
        typeof value.message === 'string' && value.message.trim().length > 0;
}

export function isGameEndPayload(value: unknown): value is {
    type: 'GAME_END';
    winner?: string | null;
    winnerChips?: number | null;
    isForfeit?: boolean | null;
    message?: string | null;
    gameId?: string | null;
    finalState?: unknown;
} {
    if (!isObject(value)) return false;
    return (
        typeof value.type === 'string' &&
        value.type === 'GAME_END' &&
        (value.winner == null || typeof value.winner === 'string') &&
        (value.winnerChips == null || nonnegative(value.winnerChips)) &&
        (value.isForfeit == null || typeof value.isForfeit === 'boolean') &&
        (value.message == null || typeof value.message === 'string') &&
        (value.gameId == null || typeof value.gameId === 'string')
    );
}

export function isPrivateStatePayload(value: unknown): value is IncomingPrivateStatePayload {
    if (!isObject(value) || (!Object.hasOwn(value, 'playerId') && !Object.hasOwn(value, 'holeCards'))) return false;
    if (value.type !== undefined) return false;
    return (
        (typeof value.playerId === 'string' || value.playerId === undefined) &&
        (value.holeCards == null || list(card, 2)(value.holeCards))
    );
}

export function isRoomUpdatePayload(value: unknown): value is RoomUpdate {
    if (!isObject(value) || typeof value.message !== 'string') return false;
    if (value.message === 'ROOM_CLOSED') {
        return value.data == null || fields(value.data, { roomId: optional(text) });
    }
    if (
        value.message === 'ROOM_CREATED' ||
        value.message === 'PLAYER_JOINED' ||
        value.message === 'PLAYER_LEFT'
    ) {
        if (!isObject(value.data)) return false;
        const data = value.data;
        return fields(data, {
            roomId: optional(text), roomName: optional(text),
            players: list(roomPlayer, 10), maxPlayers: optional(capacity),
            buyIn: optional(nonnegative), smallBlind: optional(nonnegative),
            bigBlind: optional(nonnegative), canStartGame: optional(boolean),
            gameStarted: optional(boolean),
        });
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
