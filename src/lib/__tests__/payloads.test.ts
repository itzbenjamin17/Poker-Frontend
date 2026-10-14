// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    decodeGameStatePayload,
    isGameStatePayload,
    isGameEndPayload,
    isPrivateStatePayload,
    isRoomUpdatePayload,
    getErrorStatusCode,
    normalizeErrorMessage,
} from '../payloads';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../../constants/strings';
import { createValidGameState, createValidPlayer } from '../../test/fixtures';

describe('lib/payloads - Type Guards and Normalizers', () => {
    describe('isGameStatePayload', () => {
        it('returns true for a valid complete game state payload', () => {
            const valid = createValidGameState({
                pot: 30,
                claimWinAvailable: false,
                claimWinPlayerName: null,
                uncalledAmount: 0,
                isReadyCountdownActive: false,
                readyCountdownDeadlineEpochMs: null,
                pots: [30],
            });
            expect(isGameStatePayload(valid)).toBe(true);
        });

        it('returns true for minimal valid game state payload', () => {
            const minimal = createValidGameState({
                gameId: undefined,
                phase: 'FLOP',
                players: [],
                communityCards: ['Ah', 'Kh', 'Qh'],
                pot: 100,
            });
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

    describe('decodeGameStatePayload', () => {
        it('diagnoses the first nested player failure without exposing payload values', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const payload = createValidGameState({
                    players: [createValidPlayer({ chips: 'secret-chip-value', currentBet: -1 })],
                    token: 'secret-token',
                });

                expect(decodeGameStatePayload(payload, 'initial REST game snapshot')).toBeNull();
                expect(warn.mock.calls).toEqual([[
                    'Rejected public game snapshot:',
                    {
                        source: 'initial REST game snapshot',
                        path: '$.players[0].chips',
                        expected: 'nonnegative safe integer',
                        receivedType: 'string',
                    },
                ]]);
            } finally {
                warn.mockRestore();
            }
        });

        it('normalizes a null current player name to an empty string', () => {
            const decoded = decodeGameStatePayload(createValidGameState({ currentPlayerName: null }));

            expect(decoded?.currentPlayerName).toBe('');
        });

        it.each([
            [null, '$', 'object', 'null'],
            [[], '$', 'object', 'array'],
            ['private-root-value', '$', 'object', 'string'],
            [{ ...createValidGameState(), players: {} }, '$.players', 'array with at most 10 entries', 'object'],
            [createValidGameState({ players: [null] }), '$.players[0]', 'object', 'null'],
            [createValidGameState({ communityCards: ['AS', 7] }), '$.communityCards[1]', 'card string (rank followed by C, D, H, or S)', 'number'],
            [createValidGameState({ players: [{ bestHand: ['AS', false] }] }), '$.players[0].bestHand[1]', 'card string (rank followed by C, D, H, or S)', 'boolean'],
            [createValidGameState({ players: Array.from({ length: 11 }, () => createValidPlayer()) }), '$.players', 'array with at most 10 entries', 'array'],
        ])('diagnoses malformed root and array shapes at %s', (payload, path, expected, receivedType) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                expect(decodeGameStatePayload(payload, 'WebSocket game state')).toBeNull();
                expect(warn.mock.calls).toEqual([['Rejected public game snapshot:', {
                    source: 'WebSocket game state', path, expected, receivedType,
                }]]);
            } finally {
                warn.mockRestore();
            }
        });

        it('retains all accepted nullable wire metadata and its normalization without diagnostics', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const decoded = decodeGameStatePayload(createValidGameState({
                    currentPlayerName: null, currentPlayerId: null,
                    legalActions: null, winners: null, winningsPerPlayer: null,
                    isAutoAdvancing: null, autoAdvanceMessage: null,
                    pots: null, uncalledAmount: null, isReadyCountdownActive: null,
                    readyCountdownDeadlineEpochMs: null, claimWinAvailable: null,
                    claimWinPlayerName: null,
                    players: [{
                        disconnectDeadlineEpochMs: null, isReadyForNextHand: null,
                        isSmallBlind: null, isBigBlind: null, isAllIn: null,
                        isCurrentPlayer: null, holeCards: null, handRank: null,
                        bestHand: null, isWinner: null, chipsWon: null,
                    }],
                }), 'initial REST game snapshot');

                expect(decoded).toEqual({
                    gameId: 'game-123', maxPlayers: 6, pot: 0, phase: 'PRE_FLOP', currentBet: 0,
                    communityCards: [], currentPlayerName: '', currentPlayerId: '',
                    pots: null, uncalledAmount: null, isReadyCountdownActive: null,
                    readyCountdownDeadlineEpochMs: null, claimWinAvailable: null, claimWinPlayerName: null,
                    players: [{
                        id: 'player-1', name: 'Player 1', chips: 1000, currentBet: 0,
                        status: 'ACTIVE', hasFolded: false,
                    }],
                });
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        it.each([
            { pot: '50' }, { pot: null }, { pot: -1 }, { pot: 1.5 },
            { currentBet: Infinity }, { pots: [NaN] },
            { uncalledAmount: Number.MAX_SAFE_INTEGER + 1 },
            { players: [{ chips: null }] }, { players: [{ chips: -1 }] },
            { players: [{ currentBet: '20' }] }, { players: [{ currentBet: 0.5 }] },
        ])('continues to reject corrupt authoritative money values: %j', overrides => {
            expect(decodeGameStatePayload(createValidGameState(overrides))).toBeNull();
        });

        it('keeps development diagnostics silent in production', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.stubEnv('DEV', false);
            try {
                expect(decodeGameStatePayload(null, 'initial REST game snapshot')).toBeNull();
                expect(warn).not.toHaveBeenCalled();
            } finally {
                vi.unstubAllEnvs();
                warn.mockRestore();
            }
        });

        it('rejects null player entries', () => {
            expect(decodeGameStatePayload(createValidGameState({ players: [null] }))).toBeNull();
        });

        it('accepts validator-complete shared player fixtures', () => {
            expect(isGameStatePayload(createValidGameState({ players: [createValidPlayer()] }))).toBe(true);
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
            expect(isPrivateStatePayload({})).toBe(false);
            expect(isPrivateStatePayload({ type: 'UNKNOWN' })).toBe(false);
            expect(isPrivateStatePayload({ playerId: 123 })).toBe(false);
            expect(isPrivateStatePayload({ holeCards: [123, 456] })).toBe(false);
        });
    });

    describe('isRoomUpdatePayload', () => {
        it('returns true for valid ROOM_CLOSED and PLAYER_JOINED payloads', () => {
            expect(isRoomUpdatePayload({ message: 'ROOM_CLOSED' })).toBe(true);
            expect(isRoomUpdatePayload({ message: 'ROOM_CLOSED', data: { roomId: 'room-1' } })).toBe(true);
            expect(
                isRoomUpdatePayload({
                    message: 'PLAYER_JOINED',
                    data: {
                        roomId: 'room-1',
                        roomName: 'Table 1',
                        players: [{ name: 'Alice', isHost: true }],
                    },
                })
            ).toBe(true);
        });

        it('returns false for malformed room update payloads', () => {
            expect(isRoomUpdatePayload(null)).toBe(false);
            expect(isRoomUpdatePayload({ message: 'UNKNOWN_EVENT', data: {} })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'PLAYER_JOINED', data: null })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'PLAYER_JOINED', data: { players: 'bad' } })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'PLAYER_JOINED', data: { roomName: 123, players: [] } })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'PLAYER_JOINED', data: { players: [{ name: 123 }] } })).toBe(false);
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
            expect(normalizeErrorMessage('HTTP 500 Internal Server Error')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('Request failed with status code 500')).toBe(ERROR_TECHNICAL);
        });

        it('does not treat chip amounts containing 500 as server 500 errors', () => {
            expect(normalizeErrorMessage('Minimum raise is 500 chips')).toBe('Minimum raise is 500 chips');
            expect(normalizeErrorMessage('Buy-in must be at least 500')).toBe('Buy-in must be at least 500');
            expect(normalizeErrorMessage('Insufficient chips to call 1500')).toBe('Insufficient chips to call 1500');
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
