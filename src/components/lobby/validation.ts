export const VALIDATION = {
    roomName: { min: 1, max: 50 },
    playerName: { min: 1, max: 30 },
    maxPlayers: { min: 2, max: 10 },
    smallBlind: { min: 1, max: 10_000 },
    bigBlind: { min: 2, max: 20_000 },
    buyIn: { min: 20, max: 1_000_000 },
};

export function validateCreate(data: {
    roomName: string;
    playerName: string;
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    buyIn: number;
}): string | null {
    if (!data.roomName.trim()) return 'Room name is required.';
    if (data.roomName.trim().length > VALIDATION.roomName.max) return `Room name must be at most ${VALIDATION.roomName.max} characters.`;
    if (!data.playerName.trim()) return 'Player alias is required.';
    if (data.playerName.trim().length > VALIDATION.playerName.max) return `Alias must be at most ${VALIDATION.playerName.max} characters.`;
    if (Number.isNaN(data.smallBlind) || data.smallBlind < VALIDATION.smallBlind.min || data.smallBlind > VALIDATION.smallBlind.max)
        return `Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`;
    if (Number.isNaN(data.bigBlind) || data.bigBlind < VALIDATION.bigBlind.min || data.bigBlind > VALIDATION.bigBlind.max)
        return `Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`;
    if (data.bigBlind < data.smallBlind * 2) return 'Big blind must be at least 2× the small blind.';
    if (Number.isNaN(data.buyIn) || data.buyIn < VALIDATION.buyIn.min || data.buyIn > VALIDATION.buyIn.max)
        return `Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`;
    if (data.buyIn < data.bigBlind) return 'Buy-in must be at least the big blind amount.';
    return null;
}
