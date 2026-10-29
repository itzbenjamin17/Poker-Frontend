import {
    VALIDATION_ROOM_NAME_REQUIRED,
    VALIDATION_PLAYER_ALIAS_REQUIRED,
    VALIDATION_MAX_PLAYERS,
    VALIDATION_ROOM_NAME_CONTROL,
    VALIDATION_PLAYER_ALIAS_CONTROL,
    VALIDATION_ROOM_NAME_FORMAT,
    VALIDATION_PLAYER_ALIAS_FORMAT,
    VALIDATION_ROOM_NAME_HTML,
    VALIDATION_PLAYER_ALIAS_HTML,
    VALIDATION_PASSWORD_CONTROL,
    VALIDATION_BIG_BLIND_MIN_RATIO,
    VALIDATION_BUY_IN_MIN_BIG_BLIND,
    formatRoomNameMaxError,
    formatPlayerAliasMaxError,
    formatPasswordMaxError,
    formatSmallBlindRangeError,
    formatBigBlindRangeError,
    formatBuyInRangeError,
} from '../../constants/strings';

export const VALIDATION = {
    roomName: { min: 1, max: 50 },
    playerName: { min: 1, max: 30 },
    password: { max: 50 },
    maxPlayers: { min: 2, max: 10 },
    smallBlind: { min: 1, max: 10_000 },
    bigBlind: { min: 2, max: 20_000 },
    buyIn: { min: 20, max: 1_000_000 },
};

const FORMAT_CHARS_REGEX = /\p{Cf}/u;
const HTML_TAGS_REGEX = /<[^>]*>/;
// eslint-disable-next-line no-control-regex
const PASSWORD_CONTROL_REGEX = /[\u0000-\u001F\u007F-\u009F]/;

function parseInteger(value: number | string): number {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : Number.NaN;
    }
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
        return Number.NaN;
    }
    return Number.parseInt(trimmed, 10);
}

/**
 * Validates a room password against length and control character constraints.
 * Passwords are optional (undefined, null, or empty string return null).
 * Passwords exceeding 50 characters or containing Unicode control characters
 * ([\u0000-\u001F\u007F-\u009F]) are rejected with user-facing validation errors.
 *
 * @param password optional password to validate
 * @returns error message if invalid, or null if valid
 */
export function validatePassword(password?: string): string | null {
    if (password === undefined || password === null || password === '') {
        return null;
    }
    if (password.length > VALIDATION.password.max) {
        return formatPasswordMaxError(VALIDATION.password.max);
    }
    if (PASSWORD_CONTROL_REGEX.test(password)) {
        return VALIDATION_PASSWORD_CONTROL;
    }
    return null;
}

/**
 * Normalizes an optional password input for API submission.
 * Maps undefined, null, empty strings, and whitespace-only strings to undefined
 * so public rooms do not receive empty string password payloads.
 * Preserves intentional non-empty passwords as entered.
 *
 * @param password optional user input password
 * @returns normalized password string, or undefined if absent/blank
 */
export function normalizePassword(password?: string): string | undefined {
    if (password === undefined || password === null) {
        return undefined;
    }
    if (password.trim().length === 0) {
        return undefined;
    }
    return password;
}

export function validateJoin(data: {
    roomName: string;
    playerName: string;
    password?: string;
}): string | null {
    if (FORMAT_CHARS_REGEX.test(data.roomName))
        return VALIDATION_ROOM_NAME_FORMAT;
    if (HTML_TAGS_REGEX.test(data.roomName))
        return VALIDATION_ROOM_NAME_HTML;
    if (!data.roomName.trim())
        return VALIDATION_ROOM_NAME_REQUIRED;
    if (data.roomName.trim().length > VALIDATION.roomName.max)
        return formatRoomNameMaxError(VALIDATION.roomName.max);
    if (/\p{Cc}/u.test(data.roomName.trim()))
        return VALIDATION_ROOM_NAME_CONTROL;

    if (FORMAT_CHARS_REGEX.test(data.playerName))
        return VALIDATION_PLAYER_ALIAS_FORMAT;
    if (HTML_TAGS_REGEX.test(data.playerName))
        return VALIDATION_PLAYER_ALIAS_HTML;
    if (!data.playerName.trim())
        return VALIDATION_PLAYER_ALIAS_REQUIRED;
    if (data.playerName.trim().length > VALIDATION.playerName.max)
        return formatPlayerAliasMaxError(VALIDATION.playerName.max);
    if (/\p{Cc}/u.test(data.playerName.trim()))
        return VALIDATION_PLAYER_ALIAS_CONTROL;

    if (data.password !== undefined) {
        const passwordError = validatePassword(data.password);
        if (passwordError) return passwordError;
    }

    return null;
}

export function validateCreate(data: {
    roomName: string;
    playerName: string;
    maxPlayers: number | string;
    smallBlind: number | string;
    bigBlind: number | string;
    buyIn: number | string;
    password?: string;
}): string | null {
    const joinError = validateJoin(data);
    if (joinError) return joinError;

    const maxPlayers = parseInteger(data.maxPlayers);
    if (
        Number.isNaN(maxPlayers) ||
        maxPlayers < VALIDATION.maxPlayers.min ||
        maxPlayers > VALIDATION.maxPlayers.max
    ) return VALIDATION_MAX_PLAYERS;

    const smallBlind = parseInteger(data.smallBlind);
    const bigBlind = parseInteger(data.bigBlind);
    const buyIn = parseInteger(data.buyIn);

    if (Number.isNaN(smallBlind) || smallBlind < VALIDATION.smallBlind.min || smallBlind > VALIDATION.smallBlind.max)
        return formatSmallBlindRangeError(VALIDATION.smallBlind.min, VALIDATION.smallBlind.max);
    if (Number.isNaN(bigBlind) || bigBlind < VALIDATION.bigBlind.min || bigBlind > VALIDATION.bigBlind.max)
        return formatBigBlindRangeError(VALIDATION.bigBlind.min, VALIDATION.bigBlind.max);
    if (bigBlind < smallBlind * 2) return VALIDATION_BIG_BLIND_MIN_RATIO;
    if (Number.isNaN(buyIn) || buyIn < VALIDATION.buyIn.min || buyIn > VALIDATION.buyIn.max)
        return formatBuyInRangeError(VALIDATION.buyIn.min, VALIDATION.buyIn.max);
    if (buyIn < bigBlind) return VALIDATION_BUY_IN_MIN_BIG_BLIND;
    return null;
}

export function parseCreateRoomSubmission(data: {
    roomName: string;
    playerName: string;
    maxPlayers: number;
    smallBlind: number | string;
    bigBlind: number | string;
    buyIn: number | string;
    password?: string;
}) {
    const password = normalizePassword(data.password);
    return {
        roomName: data.roomName.trim(),
        playerName: data.playerName.trim(),
        maxPlayers: data.maxPlayers,
        smallBlind: parseInteger(data.smallBlind),
        bigBlind: parseInteger(data.bigBlind),
        buyIn: parseInteger(data.buyIn),
        ...(password !== undefined ? { password } : {}),
    };
}

export function parseJoinRoomSubmission(data: {
    roomName: string;
    playerName: string;
    password?: string;
}) {
    const password = normalizePassword(data.password);
    return {
        roomName: data.roomName.trim(),
        playerName: data.playerName.trim(),
        ...(password !== undefined ? { password } : {}),
    };
}
