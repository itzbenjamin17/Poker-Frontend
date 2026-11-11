// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    decodeGameStatePayload,
    decodePublicGameState,
    decodePrivatePlayerState,
    validatePrivatePlayerIdentity,
    decodeGameEndResult,
    isGameStatePayload,
    isGameEndPayload,
    isPrivateStatePayload,
    isRoomUpdatePayload,
    getErrorStatusCode,
    normalizeErrorMessage,
    isAuthResponse,
} from '../payloads';
import {
    ERROR_INVALID_FORMAT,
    ERROR_SYSTEM,
    ERROR_TECHNICAL,
} from '../../constants/strings';
import { createValidGameState, createValidPlayer } from '../../test/fixtures';

describe('lib/payloads - Type Guards and Normalizers', () => {
    describe('isGameStatePayload', () => {
        it('accepts nullable awards and empty legal actions, but rejects unsafe minima', () => {
            expect(isGameStatePayload(createValidGameState({
                legalActions: [], minimumBetAmount: null, minimumRaiseAmount: 60,
                winningsPerPlayer: null, handSettled: true, carryOverAmount: 10,
            }))).toBe(true);
            expect(isGameStatePayload(createValidGameState({ minimumRaiseAmount: Number.MAX_SAFE_INTEGER + 1 }))).toBe(false);
        });
        it('returns true for a valid complete game state payload', () => {
            const valid = createValidGameState({
                pot: 30,
                claimWinAvailable: false,
                claimWinPlayerName: null,
                uncalledAmount: 0,
                isReadyCountdownActive: false,
                readyCountdownDeadlineEpochMs: null,
                turnDeadlineEpochMs: 60000,
                pots: [30],
            });
            expect(isGameStatePayload(valid)).toBe(true);
        });

        it('decodes turnDeadlineEpochMs when valid number or null', () => {
            const validWithDeadline = decodeGameStatePayload(createValidGameState({
                turnDeadlineEpochMs: 123456789,
            }));
            expect(validWithDeadline?.turnDeadlineEpochMs).toBe(123456789);

            const validWithNullDeadline = decodeGameStatePayload(createValidGameState({
                turnDeadlineEpochMs: null,
            }));
            expect(validWithNullDeadline?.turnDeadlineEpochMs).toBeNull();
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

        it('decodes stateRevision when provided and rejects negative stateRevision', () => {
            const valid = decodeGameStatePayload(createValidGameState({ stateRevision: 42 }));
            expect(valid?.stateRevision).toBe(42);

            expect(decodeGameStatePayload(createValidGameState({ stateRevision: -1 }))).toBeNull();
            expect(decodeGameStatePayload(createValidGameState({ stateRevision: 1.5 }))).toBeNull();
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
            expect(isRoomUpdatePayload({ message: 'ROOM_CLOSED', data: { roomId: 'room-1', reason: 'INACTIVITY' } })).toBe(true);
            expect(
                isRoomUpdatePayload({
                    message: 'PLAYER_JOINED',
                    data: {
                        roomId: 'room-1',
                        roomName: 'Table 1',
                        players: [{ name: 'Alice', isHost: true }],
                        inactivityDeadlineEpochMs: 1700000000000,
                        serverTimeEpochMs: 1699998200000,
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
            expect(isRoomUpdatePayload({ message: 'GAME_STARTED', data: null })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'GAME_STARTED', data: { gameId: 123 } })).toBe(false);
            expect(isRoomUpdatePayload({ message: 'GAME_STARTED', data: { players: 'not-an-array' } })).toBe(false);
        });

        it('validates canonical GAME_STARTED payload with RoomDataResponse shape', () => {
            expect(
                isRoomUpdatePayload({
                    message: 'GAME_STARTED',
                    data: {
                        roomId: 'room-1',
                        roomName: 'High Stakes',
                        players: [
                            { name: 'Alice', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                            { name: 'Bob', isHost: false, joinedAt: '2026-01-01T00:01:00Z' },
                        ],
                        maxPlayers: 6,
                        buyIn: 1000,
                        smallBlind: 10,
                        bigBlind: 20,
                        canStartGame: false,
                        gameStarted: true,
                    },
                })
            ).toBe(true);
        });

        it('validates legacy GAME_STARTED payload with { gameId, message? } shape', () => {
            expect(
                isRoomUpdatePayload({
                    message: 'GAME_STARTED',
                    data: {
                        gameId: 'room-1',
                        message: 'Game started! Redirecting to game...',
                    },
                })
            ).toBe(true);
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
        it('returns null for falsy, empty, whitespace-only, non-string, or stripped-to-empty messages', () => {
            expect(normalizeErrorMessage(null)).toBeNull();
            expect(normalizeErrorMessage(undefined)).toBeNull();
            expect(normalizeErrorMessage('')).toBeNull();
            expect(normalizeErrorMessage('   \t\n\r   ')).toBeNull();
            expect(normalizeErrorMessage(12345)).toBeNull();
            expect(normalizeErrorMessage({})).toBeNull();
            expect(normalizeErrorMessage([])).toBeNull();
            expect(normalizeErrorMessage('\x00\x01\x1f\x7f')).toBeNull();
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

        it('cleanly truncates plaintext messages exceeding 80 characters with ... suffix', () => {
            const longMessage = 'A'.repeat(90);
            const result = normalizeErrorMessage(longMessage);
            expect(result).toHaveLength(80);
            expect(result?.endsWith('...')).toBe(true);

            const msg85 = 'A'.repeat(85);
            expect(normalizeErrorMessage(msg85)).toBe('A'.repeat(77) + '...');
            expect(normalizeErrorMessage(msg85)).toHaveLength(80);

            const msg80 = 'B'.repeat(80);
            expect(normalizeErrorMessage(msg80)).toBe('B'.repeat(80));
            expect(normalizeErrorMessage(msg80)).toHaveLength(80);

            const msg81 = 'C'.repeat(81);
            expect(normalizeErrorMessage(msg81)).toBe('C'.repeat(77) + '...');
            expect(normalizeErrorMessage(msg81)).toHaveLength(80);
        });

        it('normalizes HTML documents, error pages, tags, and fragments to technical copy', () => {
            const html502 = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.25.3</center></body></html>';
            expect(normalizeErrorMessage(html502)).toBe(ERROR_TECHNICAL);

            const html503 = '<!DOCTYPE html><html><head><title>503 Service Unavailable</title></head><body><center><h1>503 Service Unavailable</h1></center></body></html>';
            expect(normalizeErrorMessage(html503)).toBe(ERROR_TECHNICAL);

            const html504 = '<html><body><h1>504 Gateway Time-out</h1></body></html>';
            expect(normalizeErrorMessage(html504)).toBe(ERROR_TECHNICAL);

            // Plaintext proxy status lines
            expect(normalizeErrorMessage('502 Bad Gateway')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('503 Service Unavailable')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('504 Gateway Time-out')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('HTTP 502 Bad Gateway')).toBe(ERROR_TECHNICAL);

            // Embedded HTML tags and fragments
            expect(normalizeErrorMessage('<div>An unexpected error occurred</div>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<p>Server down</p>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<tag>some technical error</tag>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<h3>Whitelabel Error Page</h3>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<center>nginx</center>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<span class="err">Action rejected</span>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('Failed: <span>Action forbidden</span>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<style>.err { color: red; }</style>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<script>alert("xss")</script>')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<!-- backend timeout -->')).toBe(ERROR_TECHNICAL);
            expect(normalizeErrorMessage('<title>502 Bad Gateway</title>')).toBe(ERROR_TECHNICAL);
        });

        it('normalizes serialized JSON bodies and embedded JSON objects to format or technical copy', () => {
            expect(normalizeErrorMessage('{"status": 500, "error": "Internal Server Error"}')).toBe(ERROR_INVALID_FORMAT);
            expect(normalizeErrorMessage('[{"message": "Validation failed"}]')).toBe(ERROR_INVALID_FORMAT);
            expect(normalizeErrorMessage('Server error: {"code": 500, "reason": "Failed"}')).toBe(ERROR_INVALID_FORMAT);
            expect(normalizeErrorMessage('{"timestamp":"2026-10-21T12:00:00Z","status":502}')).toBe(ERROR_INVALID_FORMAT);
        });

        it('normalizes multi-line Java/Spring stack traces and server exception strings to system copy', () => {
            expect(normalizeErrorMessage('NullPointerException: player session is missing')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('java.lang.NullPointerException: Cannot invoke "String.length()"')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('IllegalStateException: Room is not open for joining')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('java.lang.IllegalStateException: Game not in betting round')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('Exception: unexpected state transition')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('GameException: Table not found in active registry')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('IllegalArgumentException: Invalid seat index')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('at com.pokergame.service.RoomService.joinRoom(RoomService.java:102)')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('\tat com.pokergame.service.RoomService.joinRoom(RoomService.java:102)')).toBe(ERROR_SYSTEM);
            expect(normalizeErrorMessage('Caused by: com.pokergame.exception.GameException: Table not found')).toBe(ERROR_SYSTEM);

            const multiLineTrace = [
                'java.lang.IllegalStateException: Seat already taken',
                '\tat com.pokergame.model.Room.sitPlayer(Room.java:154)',
                '\tat com.pokergame.service.RoomService.joinRoom(RoomService.java:102)',
                '\tat com.pokergame.controller.RoomController.joinRoom(RoomController.java:45)',
                'Caused by: java.lang.IllegalArgumentException: duplicate seat index',
                '\t... 32 common frames omitted',
            ].join('\n');
            expect(normalizeErrorMessage(multiLineTrace)).toBe(ERROR_SYSTEM);

            const springTrace = [
                'org.springframework.web.bind.MethodArgumentNotValidException: Validation failed',
                '\tat org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor.resolveArgument(RequestResponseBodyMethodProcessor.java:144)',
                '\tat org.springframework.web.method.support.HandlerMethodArgumentResolverComposite.resolveArgument(HandlerMethodArgumentResolverComposite.java:122)',
            ].join('\n');
            expect(normalizeErrorMessage(springTrace)).toBe(ERROR_SYSTEM);
        });

        it('strips non-printable and control characters from plaintext messages', () => {
            expect(normalizeErrorMessage('Room not found\x00\x07\x1b')).toBe('Room not found');
            expect(normalizeErrorMessage('Game\x08 has \x00already started')).toBe('Game has already started');
            expect(normalizeErrorMessage('  Player \x1fleft \x7fthe table  ')).toBe('Player left the table');
        });

        it('preserves clean, user-facing error strings intact and trimmed', () => {
            expect(normalizeErrorMessage('Room not found')).toBe('Room not found');
            expect(normalizeErrorMessage('Game has already started')).toBe('Game has already started');
            expect(normalizeErrorMessage('  Player name already taken  ')).toBe('Player name already taken');
            expect(normalizeErrorMessage('Room not found in registry')).toBe('Room not found in registry');
            expect(normalizeErrorMessage('Room is full.')).toBe('Room is full.');
            expect(normalizeErrorMessage('Too many requests. Please try again later.')).toBe('Too many requests. Please try again later.');
            expect(normalizeErrorMessage('Minimum raise is 500 chips')).toBe('Minimum raise is 500 chips');
            expect(normalizeErrorMessage('Buy-in must be at least 500')).toBe('Buy-in must be at least 500');
            expect(normalizeErrorMessage('Insufficient chips to call 1500')).toBe('Insufficient chips to call 1500');
        });
    });

    describe('isAuthResponse', () => {
        it('returns true for a valid AuthResponse object with all non-blank string fields', () => {
            const valid = {
                token: 'mock.jwt.token',
                roomId: 'room-123',
                playerName: 'Alice',
                message: 'Room created successfully',
            };
            expect(isAuthResponse(valid)).toBe(true);
        });

        it('returns false for null, undefined, primitives, and arrays', () => {
            expect(isAuthResponse(null)).toBe(false);
            expect(isAuthResponse(undefined)).toBe(false);
            expect(isAuthResponse('string')).toBe(false);
            expect(isAuthResponse(123)).toBe(false);
            expect(isAuthResponse(true)).toBe(false);
            expect(isAuthResponse([])).toBe(false);
            expect(isAuthResponse([
                { token: 't', roomId: 'r', playerName: 'p', message: 'm' },
            ])).toBe(false);
        });

        it('returns false if any required field is missing or not a string', () => {
            expect(isAuthResponse({ roomId: 'r', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 123, roomId: 'r', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: null, playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: undefined, message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: 'p' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: 'p', message: 42 })).toBe(false);
        });

        it('returns false if any field is empty or whitespace-only', () => {
            expect(isAuthResponse({ token: '', roomId: 'r', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: '   ', roomId: 'r', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: '', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: '  \t  ', playerName: 'p', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: '', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: '   ', message: 'm' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: 'p', message: '' })).toBe(false);
            expect(isAuthResponse({ token: 't', roomId: 'r', playerName: 'p', message: ' \n ' })).toBe(false);
        });

        it('does not mutate or trim the original input object fields', () => {
            const raw = {
                token: '  token-with-spaces  ',
                roomId: '  room-456  ',
                playerName: '  Bob  ',
                message: '  Welcome!  ',
            };
            expect(isAuthResponse(raw)).toBe(true);
            expect(raw.token).toBe('  token-with-spaces  ');
            expect(raw.roomId).toBe('  room-456  ');
            expect(raw.playerName).toBe('  Bob  ');
            expect(raw.message).toBe('  Welcome!  ');
        });
    });

    describe('decodePrivatePlayerState', () => {
        it('decodes valid private state with exactly 2 hole cards and normalizes card codes', () => {
            const result = decodePrivatePlayerState({
                playerId: 'player-1',
                handNumber: 3,
                holeCards: ['As', '10d'],
            });
            expect(result).toEqual({
                playerId: 'player-1',
                handNumber: 3,
                holeCards: ['AS', 'TD'],
            });
        });

        it('decodes valid private state with 0 hole cards (empty array)', () => {
            const result = decodePrivatePlayerState({
                playerId: 'player-1',
                handNumber: 0,
                holeCards: [],
            });
            expect(result).toEqual({
                playerId: 'player-1',
                handNumber: 0,
                holeCards: [],
            });
        });

        it('normalizes null holeCards to empty array', () => {
            const result = decodePrivatePlayerState({
                playerId: 'player-1',
                handNumber: 2,
                holeCards: null,
            });
            expect(result).toEqual({
                playerId: 'player-1',
                handNumber: 2,
                holeCards: [],
            });
        });

        it.each([
            ['1 card', { playerId: 'p1', handNumber: 1, holeCards: ['AS'] }],
            ['3 cards', { playerId: 'p1', handNumber: 1, holeCards: ['AS', 'KD', 'QH'] }],
            ['invalid card code', { playerId: 'p1', handNumber: 1, holeCards: ['AS', 'INVALID'] }],
            ['negative handNumber', { playerId: 'p1', handNumber: -1, holeCards: ['AS', 'KD'] }],
            ['float handNumber', { playerId: 'p1', handNumber: 1.5, holeCards: ['AS', 'KD'] }],
            ['string handNumber', { playerId: 'p1', handNumber: '1', holeCards: ['AS', 'KD'] }],
            ['missing handNumber', { playerId: 'p1', holeCards: ['AS', 'KD'] }],
            ['empty playerId', { playerId: '', handNumber: 1, holeCards: ['AS', 'KD'] }],
            ['whitespace-only playerId', { playerId: '   ', handNumber: 1, holeCards: ['AS', 'KD'] }],
            ['missing playerId', { handNumber: 1, holeCards: ['AS', 'KD'] }],
            ['missing holeCards', { playerId: 'p1', handNumber: 1 }],
            ['holeCards is not array or null', { playerId: 'p1', handNumber: 1, holeCards: 'AS' }],
            ['null input', null],
            ['primitive input', 'string-payload'],
        ])('fails decoding (returns null) for %s', (_desc, payload) => {
            expect(decodePrivatePlayerState(payload)).toBeNull();
        });
    });

    describe('validatePrivatePlayerIdentity', () => {
        const publicState = createValidGameState({
            players: [
                createValidPlayer({ id: 'p-alice', name: 'Alice' }),
                createValidPlayer({ id: 'p-bob', name: 'Bob' }),
            ],
        });

        it('returns true when private playerId matches the public player whose name equals authPlayerName', () => {
            const privateState = { playerId: 'p-alice', handNumber: 1, holeCards: ['AS', 'KD'] };
            expect(validatePrivatePlayerIdentity(privateState, publicState, 'Alice')).toBe(true);
        });

        it('returns false when private playerId does not match the public player whose name equals authPlayerName', () => {
            const privateState = { playerId: 'p-bob', handNumber: 1, holeCards: ['AS', 'KD'] };
            expect(validatePrivatePlayerIdentity(privateState, publicState, 'Alice')).toBe(false);
        });

        it('returns false when authPlayerName is not found in public roster', () => {
            const privateState = { playerId: 'p-alice', handNumber: 1, holeCards: ['AS', 'KD'] };
            expect(validatePrivatePlayerIdentity(privateState, publicState, 'Charlie')).toBe(false);
        });

        it('returns false for null, undefined, or empty inputs', () => {
            const privateState = { playerId: 'p-alice', handNumber: 1, holeCards: ['AS', 'KD'] };
            expect(validatePrivatePlayerIdentity(null as any, publicState, 'Alice')).toBe(false);
            expect(validatePrivatePlayerIdentity(privateState, null as any, 'Alice')).toBe(false);
            expect(validatePrivatePlayerIdentity(privateState, publicState, '')).toBe(false);
        });
    });

    describe('decodeGameEndResult and decodePublicGameState', () => {
        it('decodes public game state via decodePublicGameState', () => {
            const valid = createValidGameState({ pot: 100 });
            const decoded = decodePublicGameState(valid);
            expect(decoded).not.toBeNull();
            expect(decoded?.pot).toBe(100);
        });

        it('decodes valid terminal result with full fields', () => {
            const payload = {
                gameId: 'game-123',
                winnerName: 'Alice',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Alice won with a flush',
            };
            const result = decodeGameEndResult(payload);
            expect(result).toEqual({
                gameId: 'game-123',
                winnerName: 'Alice',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Alice won with a flush',
            });
        });

        it('accepts backend wire property "winner" as fallback for "winnerName"', () => {
            const payload = {
                gameId: 'game-123',
                winner: 'Alice',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Alice won',
            };
            const result = decodeGameEndResult(payload);
            expect(result?.winnerName).toBe('Alice');
        });

        it('accepts null winnerName', () => {
            const payload = {
                gameId: 'game-123',
                winnerName: null,
                isForfeit: true,
                message: 'Game abandoned',
            };
            const result = decodeGameEndResult(payload);
            expect(result).not.toBeNull();
            expect(result?.winnerName).toBeNull();
        });

        it('accepts omitted optional winnerChips', () => {
            const payload = {
                gameId: 'game-123',
                winnerName: 'Bob',
                isForfeit: false,
                message: 'Bob won',
            };
            const result = decodeGameEndResult(payload);
            expect(result).not.toBeNull();
            expect(result?.winnerChips).toBeUndefined();
        });

        it('decodes and validates matching finalState when present', () => {
            const finalState = createValidGameState({ gameId: 'game-123', pot: 500 });
            const payload = {
                gameId: 'game-123',
                winnerName: 'Alice',
                winnerChips: 1500,
                isForfeit: false,
                message: 'Alice won',
                finalState,
            };
            const result = decodeGameEndResult(payload);
            expect(result).not.toBeNull();
            expect(result?.finalState?.gameId).toBe('game-123');
            expect(result?.finalState?.pot).toBe(500);
        });

        it('rejects terminal payload when finalState gameId does not match terminal gameId', () => {
            const finalState = createValidGameState({ gameId: 'different-game-id' });
            const payload = {
                gameId: 'game-123',
                winnerName: 'Alice',
                isForfeit: false,
                message: 'Alice won',
                finalState,
            };
            expect(decodeGameEndResult(payload)).toBeNull();
        });

        it('rejects terminal payload when finalState fails decoding', () => {
            const payload = {
                gameId: 'game-123',
                winnerName: 'Alice',
                isForfeit: false,
                message: 'Alice won',
                finalState: { pot: -100 }, // Corrupted money
            };
            expect(decodeGameEndResult(payload)).toBeNull();
        });

        it.each<[string, unknown, string | undefined]>([
            ['negative winnerChips', { gameId: 'g1', winnerName: 'A', winnerChips: -1, isForfeit: false, message: 'm' }, undefined],
            ['float winnerChips', { gameId: 'g1', winnerName: 'A', winnerChips: 1.5, isForfeit: false, message: 'm' }, undefined],
            ['string winnerChips', { gameId: 'g1', winnerName: 'A', winnerChips: '500', isForfeit: false, message: 'm' }, undefined],
            ['empty gameId', { gameId: '', winnerName: 'A', isForfeit: false, message: 'm' }, undefined],
            ['missing gameId without fallback', { winnerName: 'A', isForfeit: false, message: 'm' }, undefined],
            ['mismatched expectedGameId', { gameId: 'g1', winnerName: 'A', isForfeit: false, message: 'm' }, 'g2'],
            ['non-boolean isForfeit', { gameId: 'g1', winnerName: 'A', isForfeit: 'true', message: 'm' }, undefined],
            ['empty message', { gameId: 'g1', winnerName: 'A', isForfeit: false, message: '   ' }, undefined],
            ['non-string message', { gameId: 'g1', winnerName: 'A', isForfeit: false, message: 123 }, undefined],
            ['invalid winnerName type', { gameId: 'g1', winnerName: 123, isForfeit: false, message: 'm' }, undefined],
            ['null input', null, undefined],
        ])('rejects malformed terminal data: %s', (_desc, payload, expectedGameId) => {
            expect(decodeGameEndResult(payload, expectedGameId)).toBeNull();
        });

        it('uses fallbackGameId when gameId is omitted from payload', () => {
            const payload = {
                winnerName: 'Alice',
                winnerChips: 500,
                isForfeit: false,
                message: 'Alice won',
            };
            const result = decodeGameEndResult(payload, 'fallback-room');
            expect(result).not.toBeNull();
            expect(result?.gameId).toBe('fallback-room');
        });
    });
});

