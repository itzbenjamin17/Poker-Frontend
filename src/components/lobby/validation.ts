import {
    VALIDATION_ROOM_NAME_REQUIRED,
    VALIDATION_PLAYER_ALIAS_REQUIRED,
    VALIDATION_MAX_PLAYERS,
    VALIDATION_ROOM_NAME_CONTROL,
    VALIDATION_PLAYER_ALIAS_CONTROL,
    VALIDATION_BIG_BLIND_MIN_RATIO,
    VALIDATION_BUY_IN_MIN_BIG_BLIND,
    formatRoomNameMaxError,
    formatPlayerAliasMaxError,
    formatSmallBlindRangeError,
    formatBigBlindRangeError,
    formatBuyInRangeError,
} from '../../constants/strings';

export const VALIDATION = {
    roomName: { min: 1, max: 50 },
    playerName: { min: 1, max: 30 },
    maxPlayers: { min: 2, max: 10 },
    smallBlind: { min: 1, max: 10_000 },
    bigBlind: { min: 2, max: 20_000 },
    buyIn: { min: 20, max: 1_000_000 },
};

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

export function validateJoin(data: {
    roomName: string;
    playerName: string;
}): string | null {
    if (!data.roomName.trim()) return VALIDATION_ROOM_NAME_REQUIRED;
    if (data.roomName.trim().length > VALIDATION.roomName.max) return formatRoomNameMaxError(VALIDATION.roomName.max);
    if (/\p{Cc}/u.test(data.roomName.trim()))
        return VALIDATION_ROOM_NAME_CONTROL;
    if (!data.playerName.trim()) return VALIDATION_PLAYER_ALIAS_REQUIRED;
    if (data.playerName.trim().length > VALIDATION.playerName.max) return formatPlayerAliasMaxError(VALIDATION.playerName.max);
    if (/\p{Cc}/u.test(data.playerName.trim()))
        return VALIDATION_PLAYER_ALIAS_CONTROL;
    return null;
}

export function validateCreate(data: {
    roomName: string;
    playerName: string;
    maxPlayers: number | string;
    smallBlind: number | string;
    bigBlind: number | string;
    buyIn: number | string;
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
}) {
    return {
        roomName: data.roomName.trim(),
        playerName: data.playerName.trim(),
        maxPlayers: data.maxPlayers,
        smallBlind: parseInteger(data.smallBlind),
        bigBlind: parseInteger(data.bigBlind),
        buyIn: parseInteger(data.buyIn),
    };
}

