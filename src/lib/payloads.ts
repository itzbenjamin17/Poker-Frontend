import type {
    ActionError,
    AuthResponse,
    Card,
    GameEndResult,
    IncomingGameStatePayload,
    IncomingPrivateStatePayload,
    PrivatePlayerState,
    PublicGameStateResponse,
    RoomDataResponse,
    RoomState,
    RoomUpdate,
} from '../types';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../constants/strings';
import { logger } from '../security/logger';
import { normalizeCardCode } from './game';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAuthResponse(value: unknown): value is AuthResponse {
    if (!isObject(value)) return false;
    return (
        typeof value.token === 'string' && value.token.trim().length > 0 &&
        typeof value.roomId === 'string' && value.roomId.trim().length > 0 &&
        typeof value.playerName === 'string' && value.playerName.trim().length > 0 &&
        typeof value.message === 'string' && value.message.trim().length > 0
    );
}

interface ValidationFailure {
    path: string;
    expected: string;
    receivedType: string;
}

type Check = ((value: unknown) => boolean) & {
    expected: string;
    diagnose: (value: unknown, path: string) => ValidationFailure | null;
};

function receivedType(value: unknown): string {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

function rule(expected: string, accepts: (value: unknown) => boolean): Check {
    return Object.assign(accepts, {
        expected,
        diagnose: (value: unknown, path: string): ValidationFailure | null =>
            accepts(value) ? null : { path, expected, receivedType: receivedType(value) },
    });
}

const text = rule('string', value => typeof value === 'string');
const boolean = rule('boolean', value => typeof value === 'boolean');
const nonnegative = rule('nonnegative safe integer', value =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
const capacity = rule('safe integer between 2 and 10', value => nonnegative(value) && Number(value) >= 2 && Number(value) <= 10);

function optional(check: Check): Check {
    const result = rule(`${check.expected} or undefined`, value => value === undefined || check(value));
    result.diagnose = (value, path) => value === undefined ? null : check.diagnose(value, path);
    return result;
}

function nullable(check: Check): Check {
    const result = rule(`${check.expected}, null, or undefined`, value => value == null || check(value));
    result.diagnose = (value, path) => value == null ? null : check.diagnose(value, path);
    return result;
}

function list(check: Check, max = Infinity): Check {
    const result = rule(max === Infinity ? 'array' : `array with at most ${max} entries`, value =>
        Array.isArray(value) && value.length <= max && value.every(check));
    const diagnoseShape = result.diagnose;
    result.diagnose = (value, path) => {
        if (!Array.isArray(value) || value.length > max) {
            return { path, expected: result.expected, receivedType: receivedType(value) };
        }
        let failure: ValidationFailure | null = null;
        value.every((entry, index) => {
            failure = check.diagnose(entry, `${path}[${index}]`);
            return failure === null;
        });
        return failure ?? diagnoseShape(value, path);
    };
    return result;
}

const member = (values: readonly string[]): Check => rule(`one of ${values.join(', ')}`, value =>
    typeof value === 'string' && values.includes(value));
const card = rule('card string (rank followed by C, D, H, or S)', value =>
    typeof value === 'string' && /^(?:[2-9TJQKA]|10)[CDHS]$/i.test(value));
const action = member(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN']);

function fields(value: unknown, schema: Record<string, Check>): boolean {
    return isObject(value) && Object.entries(schema).every(([key, check]) => check(value[key]));
}

function shape(schema: Record<string, Check>): Check {
    const result = rule('object', value => fields(value, schema));
    result.diagnose = (value, path) => {
        if (!isObject(value)) return { path, expected: 'object', receivedType: receivedType(value) };
        for (const [key, check] of Object.entries(schema)) {
            const failure = check.diagnose(value[key], `${path}.${key}`);
            if (failure) return failure;
        }
        return null;
    };
    return result;
}

const roomPlayer = shape({
    name: text, isHost: boolean, joinedAt: optional(text),
});

const player = shape({
    id: text, name: text, chips: nonnegative, currentBet: nonnegative,
    status: member(['ACTIVE', 'FOLDED', 'OUT', 'ALL_IN', 'DISCONNECTED']),
    hasFolded: boolean, disconnectDeadlineEpochMs: optional(nonnegative),
    isReadyForNextHand: optional(boolean), isSmallBlind: optional(boolean),
    isBigBlind: optional(boolean), isAllIn: optional(boolean),
    isCurrentPlayer: optional(boolean), holeCards: optional(list(card, 2)),
    handRank: optional(text), bestHand: optional(list(card, 5)),
    isWinner: optional(boolean), chipsWon: optional(nonnegative),
});

const gameState = shape({
    gameId: optional(text), maxPlayers: capacity, pot: nonnegative,
    pots: optional(nullable(list(nonnegative, 10))), uncalledAmount: optional(nullable(nonnegative)),
    phase: member(['PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN']),
    currentBet: nonnegative, communityCards: list(card, 5), players: list(player, 10),
    currentPlayerName: text, currentPlayerId: text,
    legalActions: optional(list(action, 6)), minimumBetAmount: optional(nullable(nonnegative)),
    minimumRaiseAmount: optional(nullable(nonnegative)), winners: optional(list(text, 10)),
    winningsPerPlayer: optional(nullable(nonnegative)), handSettled: optional(nullable(boolean)),
    carryOverAmount: optional(nullable(nonnegative)), isAutoAdvancing: optional(boolean),
    autoAdvanceMessage: optional(text), isReadyCountdownActive: optional(nullable(boolean)),
    readyCountdownDeadlineEpochMs: optional(nullable(nonnegative)),
    turnDeadlineEpochMs: optional(nullable(nonnegative)),
    handNumber: optional(nonnegative), stateRevision: optional(nullable(nonnegative)),
    serverTimeEpochMs: optional(nonnegative),
    readyGateState: optional(member(['CLOSED', 'COUNTING_DOWN', 'WAITING_FOR_PLAYERS'])),
    claimWinAvailable: optional(nullable(boolean)), claimWinPlayerName: optional(nullable(text)),
    inactivityDeadlineEpochMs: optional(nullable(nonnegative)),
});

function omitNulls(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const result = { ...value };
    for (const key of keys) if (result[key] === null) delete result[key];
    return result;
}

/** Decode nullable wire metadata into the optional fields used by the domain. */
export type GameSnapshotSource =
    | 'initial REST game snapshot'
    | 'REST recovery game snapshot'
    | 'WebSocket game state';

export function reportRejectedGameSnapshot(source: GameSnapshotSource, failure: ValidationFailure): void {
    logger.warn('Rejected public game snapshot:', { source, ...failure });
}

export function decodeGameStatePayload(value: unknown, source?: GameSnapshotSource): IncomingGameStatePayload | null {
    const reject = (failure: ValidationFailure) => {
        if (source) reportRejectedGameSnapshot(source, failure);
        return null;
    };
    if (!isObject(value) || !Array.isArray(value.players)) {
        return reject(gameState.diagnose(value, '$')!);
    }
    const decoded = omitNulls(value, [
        'legalActions', 'minimumBetAmount', 'minimumRaiseAmount', 'winners', 'winningsPerPlayer', 'handSettled', 'carryOverAmount', 'isAutoAdvancing',
        'autoAdvanceMessage',
    ]);
    if (!Array.isArray(value.communityCards)) {
        return reject(gameState.diagnose(value, '$')!);
    }
    const normalizeCard = (entry: unknown) => typeof entry === 'string' ? normalizeCardCode(entry) ?? entry : entry;
    decoded.communityCards = value.communityCards.map(normalizeCard);
    // The backend uses null when no player currently has the turn.
    if (decoded.currentPlayerName === null) decoded.currentPlayerName = '';
    if (decoded.currentPlayerId === null) decoded.currentPlayerId = '';
    decoded.players = value.players.map(p => isObject(p) ? {
        ...omitNulls(p, [
        'disconnectDeadlineEpochMs', 'isReadyForNextHand', 'isSmallBlind',
        'isBigBlind', 'isAllIn', 'isCurrentPlayer', 'holeCards', 'handRank',
        'bestHand', 'isWinner', 'chipsWon',
        ]),
        ...(Array.isArray(p.holeCards) ? { holeCards: p.holeCards.map(normalizeCard) } : {}),
        ...(Array.isArray(p.bestHand) ? { bestHand: p.bestHand.map(normalizeCard) } : {}),
    } : p);
    const failure = gameState.diagnose(decoded, '$');
    return failure ? reject(failure) : decoded as IncomingGameStatePayload;
}

export function decodePublicGameState(value: unknown, source?: GameSnapshotSource): PublicGameStateResponse | null {
    const decoded = decodeGameStatePayload(value, source);
    if (!decoded) return null;
    return decoded as PublicGameStateResponse;
}

export function isRoomDataPayload(value: unknown): value is RoomDataResponse {
    if (!isObject(value)) return false;
    return fields(value, {
        roomId: text, roomName: text, maxPlayers: optional(capacity),
        buyIn: optional(nonnegative), smallBlind: optional(nonnegative), bigBlind: optional(nonnegative),
        createdAt: optional(text), hostName: optional(text), currentPlayers: optional(nonnegative),
        canStartGame: optional(boolean), gameStarted: optional(boolean),
        players: list(roomPlayer, 10),
        inactivityDeadlineEpochMs: optional(nullable(nonnegative)),
        serverTimeEpochMs: optional(nullable(nonnegative)),
    });
}

export function decodeRoomDataResponse(value: unknown): RoomDataResponse | null {
    if (!isObject(value)) return null;
    if (isRoomDataPayload(value)) {
        return value;
    }
    return null;
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
        inactivityDeadlineEpochMs: roomData.inactivityDeadlineEpochMs,
        serverTimeEpochMs: roomData.serverTimeEpochMs,
    };
}

export function isGameStatePayload(value: unknown): value is IncomingGameStatePayload {
    return gameState(value);
}

export function isActionErrorPayload(value: unknown): value is ActionError {
    if (!isObject(value) || value.type !== 'ACTION_ERROR') return false;
    return Object.keys(value).length === 4 &&
        typeof value.code === 'string' && value.code.trim().length > 0 &&
        /^[A-Z][A-Z0-9_]*$/.test(value.code) &&
        (action(value.action) || value.action === 'READY' || value.action === 'UNREADY') &&
        typeof value.message === 'string' && value.message.trim().length > 0;
}

export function isGameEndPayload(value: unknown): value is {
    type: 'GAME_END';
    winner?: string | null;
    winnerChips?: number | null;
    isForfeit?: boolean | null;
    abandoned?: boolean | null;
    reason?: string | null;
    outcome?: string | null;
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
        (value.abandoned == null || typeof value.abandoned === 'boolean') &&
        (value.reason == null || typeof value.reason === 'string') &&
        (value.outcome == null || typeof value.outcome === 'string') &&
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

export function decodePrivatePlayerState(value: unknown): PrivatePlayerState | null {
    if (!isObject(value)) return null;

    if (typeof value.playerId !== 'string' || value.playerId.trim().length === 0) {
        return null;
    }
    const playerId = value.playerId.trim();

    if (
        typeof value.handNumber !== 'number' ||
        !Number.isSafeInteger(value.handNumber) ||
        value.handNumber < 0
    ) {
        return null;
    }
    const handNumber = value.handNumber;

    let holeCards: Card[];
    if (value.holeCards === null || (Array.isArray(value.holeCards) && value.holeCards.length === 0)) {
        holeCards = [];
    } else if (Array.isArray(value.holeCards) && value.holeCards.length === 2) {
        const normalized: Card[] = [];
        for (const c of value.holeCards) {
            if (!card(c)) return null;
            const norm = typeof c === 'string' ? normalizeCardCode(c) ?? c : null;
            if (!norm) return null;
            normalized.push(norm);
        }
        holeCards = normalized;
    } else {
        return null;
    }

    return {
        playerId,
        handNumber,
        holeCards,
    };
}

export function validatePrivatePlayerIdentity(
    privateState: PrivatePlayerState,
    publicState: PublicGameStateResponse,
    authPlayerName: string
): boolean {
    if (
        !privateState ||
        !publicState ||
        !Array.isArray(publicState.players) ||
        typeof authPlayerName !== 'string' ||
        authPlayerName.trim().length === 0
    ) {
        return false;
    }
    const matchingPlayer = publicState.players.find(p => p && p.name === authPlayerName);
    if (!matchingPlayer || typeof matchingPlayer.id !== 'string') {
        return false;
    }
    return matchingPlayer.id === privateState.playerId;
}

export function decodeGameEndResult(value: unknown, expectedGameId?: string): GameEndResult | null {
    if (!isObject(value)) return null;

    let gameId: string | undefined;
    if (typeof value.gameId === 'string' && value.gameId.trim().length > 0) {
        gameId = value.gameId.trim();
        if (expectedGameId !== undefined && gameId !== expectedGameId) {
            return null;
        }
    } else if (
        (value.gameId === undefined || value.gameId === null) &&
        expectedGameId !== undefined &&
        expectedGameId.trim().length > 0
    ) {
        gameId = expectedGameId.trim();
    } else {
        return null;
    }

    let abandoned: boolean | undefined;
    if (value.abandoned !== undefined && value.abandoned !== null) {
        if (typeof value.abandoned !== 'boolean') {
            return null;
        }
        abandoned = value.abandoned;
    } else if (value.outcome === 'ABANDONED' || value.reason === 'INACTIVITY') {
        abandoned = true;
    }

    let reason: string | null | undefined;
    if (value.reason !== undefined && value.reason !== null) {
        if (typeof value.reason !== 'string') {
            return null;
        }
        reason = value.reason;
    } else if (value.reason === null) {
        reason = null;
    } else if (abandoned) {
        reason = 'INACTIVITY';
    }

    const rawWinner = 'winnerName' in value ? value.winnerName : ('winner' in value ? value.winner : null);
    if (rawWinner !== null && typeof rawWinner !== 'string') {
        return null;
    }
    const winnerName = abandoned ? null : (typeof rawWinner === 'string' ? rawWinner : null);

    let winnerChips: number | undefined;
    if (value.winnerChips !== undefined && value.winnerChips !== null) {
        if (typeof value.winnerChips !== 'number' || !Number.isSafeInteger(value.winnerChips) || value.winnerChips < 0) {
            return null;
        }
        if (!abandoned) {
            winnerChips = value.winnerChips;
        }
    }

    let isForfeit = false;
    if (typeof value.isForfeit === 'boolean') {
        isForfeit = value.isForfeit;
    } else if (!abandoned) {
        return null;
    }

    let message: string;
    if (typeof value.message === 'string' && value.message.trim().length > 0) {
        message = value.message.trim();
    } else if (abandoned) {
        message = 'Game abandoned due to inactivity';
    } else {
        return null;
    }

    let finalState: PublicGameStateResponse | null | undefined = undefined;
    if (value.finalState !== undefined && value.finalState !== null) {
        const decodedFinal = decodePublicGameState(value.finalState);
        if (!decodedFinal) {
            return null;
        }
        if (decodedFinal.gameId && decodedFinal.gameId !== gameId) {
            return null;
        }
        if (!decodedFinal.gameId) {
            decodedFinal.gameId = gameId;
        }
        finalState = decodedFinal;
    } else if (value.finalState === null) {
        finalState = null;
    }

    return {
        gameId,
        winnerName,
        ...(winnerChips !== undefined ? { winnerChips } : {}),
        isForfeit,
        ...(abandoned !== undefined ? { abandoned } : {}),
        ...(reason !== undefined ? { reason } : {}),
        message,
        ...(finalState !== undefined ? { finalState } : {}),
    };
}

export function isRoomUpdatePayload(value: unknown): value is RoomUpdate {
    if (!isObject(value) || typeof value.message !== 'string') return false;
    if (value.message === 'ROOM_CLOSED') {
        return value.data == null || fields(value.data, { roomId: optional(text), reason: optional(text) });
    }
    if (value.message === 'GAME_STARTED') {
        if (!isObject(value.data)) return false;
        const data = value.data;
        if ('players' in data && Array.isArray(data.players)) {
            return fields(data, {
                roomId: optional(text),
                roomName: optional(text),
                players: list(roomPlayer, 10),
                maxPlayers: optional(capacity),
                buyIn: optional(nonnegative),
                smallBlind: optional(nonnegative),
                bigBlind: optional(nonnegative),
                canStartGame: optional(boolean),
                gameStarted: optional(boolean),
                inactivityDeadlineEpochMs: optional(nullable(nonnegative)),
                serverTimeEpochMs: optional(nullable(nonnegative)),
            });
        }
        return fields(data, {
            gameId: text,
            message: optional(text),
        });
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
            inactivityDeadlineEpochMs: optional(nullable(nonnegative)),
            serverTimeEpochMs: optional(nullable(nonnegative)),
        });
    }
    return false;
}

export function getErrorStatusCode(error: unknown): number | undefined {
    if (!isObject(error)) return undefined;
    return typeof error.status === 'number' ? error.status : undefined;
}

export function normalizeErrorMessage(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const msg = raw.trim();
    if (msg.length === 0) return null;

    if (
        /<!DOCTYPE/i.test(msg) ||
        /<!--/i.test(msg) ||
        /<(?:\/?[a-z][a-z0-9_-]*\b|!doctype)[^>]*>/i.test(msg) ||
        /<\/?(?:html|head|body|title|center|h[1-6]|div|span|p|style|script|meta|link|hr|br|table|tbody|thead|tr|td|th|pre|form|input|button|a)\b/i.test(msg)
    ) {
        return ERROR_TECHNICAL;
    }

    if (
        msg.startsWith('{') ||
        msg.startsWith('[') ||
        /\{[\s\S]*"[^"]+"\s*:[\s\S]*\}/.test(msg) ||
        /\[[\s\S]*\{[\s\S]*\}[\s\S]*\]/.test(msg)
    ) {
        return ERROR_INVALID_FORMAT;
    }
    if (msg.includes('Cannot deserialize') || msg.includes('JSON parse error') || msg.includes('HttpMessageNotReadable')) {
        return ERROR_INVALID_FORMAT;
    }
    if (
        /internal server error/i.test(msg) ||
        /\b(?:status(?:\s+code)?|http|error)\s*:?\s*(?:500|502|503|504)\b/i.test(msg) ||
        /\b(?:502\s+bad\s+gateway|503\s+service\s+unavailable|504\s+gateway\s+time-?out)\b/i.test(msg) ||
        /\b(?:bad\s+gateway|gateway\s+time-?out)\b/i.test(msg)
    ) {
        return ERROR_TECHNICAL;
    }
    if (
        msg.includes('java.lang') ||
        msg.includes('org.springframework') ||
        msg.includes('com.pokergame') ||
        msg.includes('NullPointerException') ||
        msg.includes('IllegalStateException') ||
        /\b[A-Za-z0-9_$]*Exception\b/i.test(msg) ||
        /\bat\s+[a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)+/.test(msg) ||
        /\tat\s+/i.test(msg) ||
        /\bCaused by:\s*/i.test(msg) ||
        /\.\.\.\s+\d+\s+(?:more|common frames omitted)/i.test(msg)
    ) {
        return ERROR_SYSTEM;
    }
    // eslint-disable-next-line no-control-regex
    const clean = msg.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    if (clean.length === 0) return null;
    const MAX_LENGTH = 80;
    return clean.length > MAX_LENGTH ? clean.substring(0, MAX_LENGTH - 3) + '...' : clean;
}
