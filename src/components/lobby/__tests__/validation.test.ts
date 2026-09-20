import { describe, test, expect } from 'vitest';
import { validateCreate, VALIDATION } from '../validation';

describe('validateCreate', () => {
    const validConfig = {
        roomName: 'High Rollers Club',
        playerName: 'Maverick',
        maxPlayers: 6,
        smallBlind: 25,
        bigBlind: 50,
        buyIn: 1000,
    };

    test('returns null for a valid configuration', () => {
        expect(validateCreate(validConfig)).toBeNull();
    });

    test('rejects empty or whitespace-only room name', () => {
        expect(validateCreate({ ...validConfig, roomName: '' })).toBe('Room name is required.');
        expect(validateCreate({ ...validConfig, roomName: '   ' })).toBe('Room name is required.');
    });

    test('rejects room name exceeding maximum character length', () => {
        const longRoomName = 'A'.repeat(VALIDATION.roomName.max + 1);
        expect(validateCreate({ ...validConfig, roomName: longRoomName }))
            .toBe(`Room name must be at most ${VALIDATION.roomName.max} characters.`);
    });

    test('rejects empty or whitespace-only player alias', () => {
        expect(validateCreate({ ...validConfig, playerName: '' })).toBe('Player alias is required.');
        expect(validateCreate({ ...validConfig, playerName: '   ' })).toBe('Player alias is required.');
    });

    test('rejects player alias exceeding maximum character length', () => {
        const longPlayerName = 'P'.repeat(VALIDATION.playerName.max + 1);
        expect(validateCreate({ ...validConfig, playerName: longPlayerName }))
            .toBe(`Alias must be at most ${VALIDATION.playerName.max} characters.`);
    });

    test('rejects big blind less than 2x small blind (including big blind <= small blind)', () => {
        // big blind <= small blind
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 50 }))
            .toBe('Big blind must be at least 2× the small blind.');
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 25 }))
            .toBe('Big blind must be at least 2× the small blind.');
        // big blind > small blind but < 2x small blind
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 90 }))
            .toBe('Big blind must be at least 2× the small blind.');
    });

    test('rejects buy-in less than big blind', () => {
        expect(validateCreate({ ...validConfig, bigBlind: 100, buyIn: 50 }))
            .toBe('Buy-in must be at least the big blind amount.');
    });

    test('rejects small blind below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, smallBlind: 0 }))
            .toBe(`Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, smallBlind: 15_000 }))
            .toBe(`Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`);
    });

    test('rejects big blind below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, bigBlind: 1 }))
            .toBe(`Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, bigBlind: 25_000 }))
            .toBe(`Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`);
    });

    test('rejects buy-in below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, buyIn: 10 }))
            .toBe(`Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, buyIn: 2_000_000 }))
            .toBe(`Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`);
    });
});
