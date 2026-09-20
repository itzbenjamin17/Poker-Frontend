import { describe, expect, it } from 'vitest';
import {
    isGameStatePayload,
    isGameEndPayload,
    isPrivateStatePayload,
    getErrorStatusCode,
    normalizeErrorMessage,
} from '../payloads';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../../constants/strings';

describe('lib/payloads - Type Guards and Normalizers', () => {
    describe('isGameStatePayload', () => {
        it('returns true for a valid complete game state payload', () => {
            const valid = {
                gameId: 'game-1',
                phase: 'PRE_FLOP',
                players: [{ name: 'Alice', chips: 1000 }],
                communityCards: [],
                pot: 30,
                claimWinAvailable: false,
                claimWinPlayerName: null,
                uncalledAmount: 0,
                isReadyCountdownActive: false,
                readyCountdownDeadlineEpochMs: null,
                pots: [30],
            };
            expect(isGameStatePayload(valid)).toBe(true);
        });

        it('returns true for minimal valid game state payload', () => {
            const minimal = {
                phase: 'FLOP',
                players: [],
                communityCards: ['Ah', 'Kh', 'Qh'],
                pot: 100,
            };
            expect(isGameStatePayload(minimal)).toBe(true);
        });

        it('returns false for primitives, null, or undefined', () => {
            expect(isGameStatePayload(null)).toBe(false);
            expect(isGameStatePayload(undefined)).toBe(false);
            expect(isGameStatePayload('not-an-object')).toBe(false);
            expect(isGameStatePayload(12345)).toBe(false);
        });

        it('returns false when required fields are missing or wrong types', () => {
            // Missing phase
            expect(isGameStatePayload({ players: [], communityCards: [], pot: 50 })).toBe(false);
            // Players is not an array
            expect(isGameStatePayload({ phase: 'FLOP', players: 'not-array', communityCards: [], pot: 50 })).toBe(false);
            // Community cards is not an array
            expect(isGameStatePayload({ phase: 'FLOP', players: [], communityCards: null, pot: 50 })).toBe(false);
            // Pot is not a number
            expect(isGameStatePayload({ phase: 'FLOP', players: [], communityCards: [], pot: '50' })).toBe(false);
            // Pots array contains non-numbers
            expect(
                isGameStatePayload({
                    phase: 'FLOP',
                    players: [],
                    communityCards: [],
                    pot: 50,
                    pots: ['invalid'],
                })
            ).toBe(false);
        });
    });

    describe('isGameEndPayload', () => {
        it('returns true for valid GAME_END payloads', () => {
            const payload = {
                type: 'GAME_END',
                winner: 'Alice',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Alice won with Royal Flush',
                gameId: 'game-1',
            };
            expect(isGameEndPayload(payload)).toBe(true);
        });

        it('returns false for non-matching type or non-objects', () => {
            expect(isGameEndPayload({ type: 'ROUND_END' })).toBe(false);
            expect(isGameEndPayload(null)).toBe(false);
            expect(isGameEndPayload('GAME_END')).toBe(false);
        });

        it('returns false when property types are invalid', () => {
            expect(
                isGameEndPayload({
                    type: 'GAME_END',
                    winnerChips: 'not-a-number',
                })
            ).toBe(false);
            expect(
                isGameEndPayload({
                    type: 'GAME_END',
                    isForfeit: 'not-a-boolean',
                })
            ).toBe(false);
        });
    });

    describe('isPrivateStatePayload', () => {
        it('returns true for valid private state with hole cards', () => {
            const valid = {
                playerId: 'player-1',
                holeCards: ['As', 'Kd'],
            };
            expect(isPrivateStatePayload(valid)).toBe(true);
        });

        it('returns true when holeCards is null or undefined', () => {
            expect(isPrivateStatePayload({ playerId: 'player-1', holeCards: null })).toBe(true);
            expect(isPrivateStatePayload({ playerId: 'player-1' })).toBe(true);
        });

        it('returns false for non-objects or invalid hole cards', () => {
            expect(isPrivateStatePayload(null)).toBe(false);
            expect(isPrivateStatePayload({ playerId: 123 })).toBe(false);
            expect(isPrivateStatePayload({ holeCards: [123, 456] })).toBe(false);
        });
    });

    describe('getErrorStatusCode', () => {
        it('extracts number status code from error object', () => {
            expect(getErrorStatusCode({ status: 404 })).toBe(404);
            expect(getErrorStatusCode({ status: 500, message: 'Server error' })).toBe(500);
        });

        it('returns undefined for non-objects or missing status', () => {
            expect(getErrorStatusCode(null)).toBeUndefined();
            expect(getErrorStatusCode('error')).toBeUndefined();
            expect(getErrorStatusCode({ error: 'not found' })).toBeUndefined();
            expect(getErrorStatusCode({ status: '404' })).toBeUndefined();
        });
    });

    describe('normalizeErrorMessage', () => {
        it('returns null for falsy messages', () => {
            expect(normalizeErrorMessage(null)).toBeNull();
            expect(normalizeErrorMessage('')).toBeNull();
        });

        it('normalizes deserialization and JSON parsing errors', () => {
            expect(normalizeErrorMessage('Cannot deserialize instance of java.lang.String')).toBe(ERROR_INVALID_FORMAT);
            expect(normalizeErrorMessage('JSON parse error: Unexpected character')).toBe(ERROR_INVALID_FORMAT);
            expect(normalizeErrorMessage('HttpMessageNotReadableException: Could not read document')).toBe(ERROR_INVALID_FORMAT);
        });

        it('normalizes 500 and internal server errors', () => {
            expect(normalizeErrorMessage('Internal Server Error')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('Request failed with status code 500')).toBe(ERROR_TECHNICAL);
        });

        it('normalizes internal java / spring stack traces', () => {
            expect(normalizeErrorMessage('org.springframework.web.bind.MethodArgumentNotValidException')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('java.lang.NullPointerException at com.pokergame')).toBe(ERROR_SYSTEM);
        });

        it('truncates messages exceeding 80 characters', () => {
            const longMessage = 'A'.repeat(90);
            const result = normalizeErrorMessage(longMessage);
            expect(result).toHaveLength(80);
            expect(result?.endsWith('...')).toBe(true);
        });

        it('returns regular short error messages untruncated and trimmed', () => {
            expect(normalizeErrorMessage('  Player name already taken  ')).toBe('Player name already taken');
        });
    });
});
