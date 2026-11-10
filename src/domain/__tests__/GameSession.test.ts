// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, IncomingGameStatePayload, RoomDataResponse } from '../../types';
import { HOST_LEFT, SESSION_SEAT_GONE } from '../../constants/strings';
import { createValidGameState, createValidPlayer, createValidRoomData, createMockJwt } from '../../test/fixtures';
import { pokerApi } from '../../services/api';

describe('GameSession Domain Store', () => {
    const auth: AuthResponse = {
        roomId: 'room-123',
        playerName: 'Hero',
        token: 'token-hero',
        message: 'Success',
    };

    function createSession(clock = new TestClock(1000)) {
        const transport = new InMemoryTransportAdapter();
        const onLeave = vi.fn();
        const session = new GameSession({
            auth,
            transport,
            clock,
            onLeave,
        });
        return { session, transport, clock, onLeave };
    }

    describe('Initialization & Subscription (useSyncExternalStore compatibility)', () => {
        it('initializes with default snapshot and stable reference', () => {
            const { session } = createSession();
            const snapshot = session.getSnapshot();

            expect(snapshot.roomState?.roomId).toBe('room-123');
            expect(snapshot.roomState?.players?.[0].name).toBe('Hero');
            expect(snapshot.gameState).toBeNull();
            expect(snapshot.privateState).toBeNull();
            expect(snapshot.showdown).toBeNull();
            expect(snapshot.showdownResult).toBeNull();
            expect(snapshot.wsStatus).toBe('disconnected');
            expect(snapshot.isGameOver).toBe(false);
            expect(snapshot.pendingActions.size).toBe(0);

            // Same snapshot reference when unchanged
            expect(session.getSnapshot()).toBe(snapshot);
        });

        it('notifies subscribers and produces a new immutable snapshot on transition', () => {
            const { session, transport } = createSession();
            const listener = vi.fn();
            const unsubscribe = session.subscribe(listener);

            const initialSnapshot = session.getSnapshot();

            session.connect();
            transport.simulateStatus('connected');

            expect(listener).toHaveBeenCalled();
            const updatedSnapshot = session.getSnapshot();
            expect(updatedSnapshot).not.toBe(initialSnapshot);
            expect(updatedSnapshot.wsStatus).toBe('connected');

            unsubscribe();
            const listenerCount = listener.mock.calls.length;
            transport.simulateStatus('disconnected');
            expect(listener.mock.calls.length).toBe(listenerCount);
        });
    });

    describe('State Synchronization & Hand Progression', () => {
        it('diagnoses rejected live snapshots and preserves the table and pending action lock', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { session, transport } = createSession();
            try {
                session.connect();
                transport.simulateMessage('/game/room-123', createValidGameState({
                    pot: 50,
                    players: [{ id: 'hero-id', name: 'Hero', chips: 950 }],
                }));
                session.playAction('CHECK');
                const accepted = session.getSnapshot();
                const revision = session.getStateSyncRevision();

                transport.simulateMessage('/game/room-123', createValidGameState({
                    pot: 999,
                    players: [{ id: 'hero-id', name: 'Hero', chips: 'private-invalid-value' }],
                }));

                expect(warn.mock.calls).toEqual([['Rejected public game snapshot:', {
                    source: 'WebSocket game state',
                    path: '$.players[0].chips',
                    expected: 'nonnegative safe integer',
                    receivedType: 'string',
                }]]);
                expect(session.getSnapshot()).toBe(accepted);
                expect(session.getSnapshot().gameState?.pot).toBe(50);
                expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
                expect(session.getStateSyncRevision()).toBe(revision);
            } finally {
                session.disconnect();
                warn.mockRestore();
            }
        });

        it('subscribes to room, game, and private channels on connect', () => {
            const { session, transport } = createSession();
            session.connect();

            const subs = transport.getSubscriptions();
            expect(subs.has('/room/room-123')).toBe(true);
            expect(subs.has('/game/room-123')).toBe(true);
            expect(subs.has('/user/queue/private')).toBe(true);
        });

        it('progresses hand phases from PRE_FLOP through RIVER', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            // 1. PRE_FLOP
            const preFlopState: IncomingGameStatePayload = {
                phase: 'PRE_FLOP',
                pot: 15,
                currentBet: 10,
                communityCards: [],
                maxPlayers: 6,
                currentPlayerName: 'Hero',
                currentPlayerId: 'hero-id',
                players: [
                    { id: 'hero-id', name: 'Hero', chips: 1000, currentBet: 10, hasFolded: false, status: 'ACTIVE' },
                    { id: 'villain-id', name: 'Villain', chips: 1000, currentBet: 5, hasFolded: false, status: 'ACTIVE' },
                ],
            };
            transport.simulateMessage('/game/room-123', preFlopState);

            expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');
            expect(session.getSnapshot().gameState?.pot).toBe(15);
            expect(session.getSnapshot().myPlayerId).toBe('hero-id');

            // 2. FLOP
            const flopState: IncomingGameStatePayload = {
                ...preFlopState,
                phase: 'FLOP',
                pot: 50,
                communityCards: ['As', 'Kd', 'Qc'],
            };
            transport.simulateMessage('/game/room-123', flopState);

            expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
            expect(session.getSnapshot().gameState?.communityCards).toEqual(['AS', 'KD', 'QC']);
            expect(session.getSnapshot().gameState?.pot).toBe(50);
        });

        it('keeps private state hidden until a matching public hand identifies the hero', () => {
            const { session, transport } = createSession();
            session.connect();

            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1',
                handNumber: 0,
                holeCards: ['Ah', 'Kh'],
            });

            expect(session.getSnapshot().privateState).toBeNull();
            expect(session.getSnapshot().myPlayerId).toBeNull();

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 0,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
            expect(session.getSnapshot().myPlayerId).toBe('hero-p1');
        });

        it('syncs room updates and handles room closed redirect', () => {
            const { session, transport, clock, onLeave } = createSession();
            session.connect();

            // Player joined
            transport.simulateMessage('/room/room-123', {
                message: 'PLAYER_JOINED',
                data: {
                    roomId: 'room-123',
                    roomName: 'High Stakes',
                    players: [
                        { name: 'Hero', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                        { name: 'Villain', isHost: false, joinedAt: '2026-01-01T00:00:01Z' },
                    ],
                    gameStarted: false,
                },
            });

            expect(session.getSnapshot().roomState?.roomName).toBe('High Stakes');
            expect(session.getSnapshot().roomState?.players?.length).toBe(2);

            // Room closed
            transport.simulateMessage('/room/room-123', {
                message: 'ROOM_CLOSED',
                data: { roomId: 'room-123' },
            });

            expect(session.getSnapshot().notification).toBe(HOST_LEFT);
            expect(session.getSnapshot().roomState).toBeNull();
            expect(onLeave).not.toHaveBeenCalled();

            // Advancing clock past 3000ms executes redirect
            clock.tick(3000);
            expect(onLeave).toHaveBeenCalledTimes(1);
            expect(onLeave).toHaveBeenCalledWith('token-hero');
        });

        it('ignores malformed room update payloads without corrupting roomState', () => {
            const { session, transport } = createSession();
            session.connect();

            transport.simulateMessage('/room/room-123', {
                message: 'ROOM_CREATED',
                data: {
                    roomId: 'room-123',
                    roomName: 'Valid Room',
                    players: [{ name: 'Hero', isHost: true }],
                    gameStarted: false,
                },
            });

            const validRoomState = session.getSnapshot().roomState;
            expect(validRoomState?.roomName).toBe('Valid Room');
            expect(validRoomState?.players).toEqual([{ name: 'Hero', isHost: true }]);

            // Malformed frame 1: data is null
            transport.simulateMessage('/room/room-123', {
                message: 'PLAYER_JOINED',
                data: null,
            });
            expect(session.getSnapshot().roomState).toBe(validRoomState);

            // Malformed frame 2: players is not an array
            transport.simulateMessage('/room/room-123', {
                message: 'PLAYER_JOINED',
                data: { roomId: 'room-123', roomName: 'Bad', players: 'bad' },
            });
            expect(session.getSnapshot().roomState).toBe(validRoomState);
        });
    });

    describe('Showdown Countdowns & Controllable Clock Ticks', () => {
        it('does not resurrect an obsolete equal-share scalar after an authoritative unequal result', () => {
            const { session, transport } = createSession(new TestClock(10_000));
            session.connect();
            transport.simulateStatus('connected');
            transport.simulateMessage('/game/room-123', createValidGameState({
                phase: 'SHOWDOWN', winners: ['Hero'], winningsPerPlayer: 175,
                players: [createValidPlayer({ name: 'Hero', isWinner: true, chipsWon: 175 })],
            }));
            transport.simulateMessage('/game/room-123', createValidGameState({
                phase: 'SHOWDOWN', winners: ['Hero', 'Villain'], winningsPerPlayer: null, handSettled: true,
                players: [
                    createValidPlayer({ name: 'Hero', isWinner: true, chipsWon: 150 }),
                    createValidPlayer({ id: 'p2', name: 'Villain', isWinner: true, chipsWon: 200 }),
                ],
            }));
            expect(session.getSnapshot().showdownResult?.winningsPerPlayer).toBeUndefined();
            expect(session.getSnapshot().showdownResult?.players.map((player) => player.chipsWon)).toEqual([150, 200]);
            session.disconnect();
        });

        it('clears revealed winner metadata when the next authoritative settled result is a void hand', () => {
            const { session, transport } = createSession(new TestClock(10_000));
            session.connect();
            transport.simulateStatus('connected');
            transport.simulateMessage('/game/room-123', createValidGameState({
                phase: 'SHOWDOWN', winners: ['Hero'], winningsPerPlayer: 175,
                players: [createValidPlayer({
                    id: 'hero-id', name: 'Hero', isWinner: true, chipsWon: 175,
                    holeCards: ['Ah', 'Ad'], bestHand: ['Ah', 'Ad', 'As', 'Kc', 'Kh'], handRank: 'FULL_HOUSE',
                })],
            }));
            transport.simulateMessage('/game/room-123', createValidGameState({
                phase: 'SHOWDOWN', handSettled: true, winners: [], winningsPerPlayer: null,
                pot: 200, carryOverAmount: 200, isReadyCountdownActive: true,
                players: [createValidPlayer({ id: 'hero-id', name: 'Hero' })],
            }));

            const result = session.getSnapshot().showdownResult;
            expect(result?.handSettled).toBe(true);
            expect(result?.winners).toEqual([]);
            expect(result?.winningsPerPlayer).toBeUndefined();
            expect(result?.players[0]).toMatchObject({ name: 'Hero' });
            expect(result?.players[0].isWinner).toBeUndefined();
            expect(result?.players[0].chipsWon).toBeUndefined();
            expect(result?.players[0].holeCards).toBeUndefined();
            expect(result?.players[0].bestHand).toBeUndefined();
            expect(result?.players[0].handRank).toBeUndefined();
            expect(result?.carryOverAmount).toBe(200);
            session.disconnect();
        });

        it('preserves the showdown result after countdown expiry until the server advances the hand', () => {
            const { session, transport, clock } = createSession(new TestClock(10_000));
            session.connect();
            transport.simulateStatus('connected');

            // Set up active pot in RIVER
            transport.simulateMessage('/game/room-123', {
                phase: 'RIVER',
                pot: 500,
                currentBet: 50,
                communityCards: ['2c', '7d', 'Jh', 'Qs', 'Ad'],
                maxPlayers: 2,
                currentPlayerName: 'Hero',
                currentPlayerId: 'p1',
                players: [
                    { id: 'p1', name: 'Hero', chips: 750, currentBet: 50, hasFolded: false, status: 'ACTIVE' },
                    { id: 'p2', name: 'Villain', chips: 750, currentBet: 50, hasFolded: false, status: 'ACTIVE' },
                ],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().gameState?.pot).toBe(500);

            // Enter SHOWDOWN with winners; server reports pot as 0 after payout
            const showdownDeadline = 15_000; // 5000ms from now
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                pot: 0,
                currentBet: 0,
                communityCards: ['2c', '7d', 'Jh', 'Qs', 'Ad'],
                maxPlayers: 2,
                currentPlayerName: '',
                currentPlayerId: '',
                winners: ['Hero'],
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: showdownDeadline,
                players: [
                    { id: 'p1', name: 'Hero', chips: 1250, currentBet: 0, hasFolded: false, status: 'ACTIVE', isWinner: true },
                    { id: 'p2', name: 'Villain', chips: 750, currentBet: 0, hasFolded: false, status: 'ACTIVE' },
                ],
            } as IncomingGameStatePayload);

            // Snapshot preserves non-zero pot for showdown display
            expect(session.getSnapshot().gameState?.pot).toBe(500);
            expect(session.getSnapshot().showdown).not.toBeNull();
            expect(session.getSnapshot().showdownResult).not.toBeNull();

            // Before deadline expires
            clock.tick(4999);
            expect(session.getSnapshot().showdown).not.toBeNull();

            // Countdown time controls only the display; the result remains authoritative.
            clock.tick(1);
            expect(session.getSnapshot().showdown).not.toBeNull();
            expect(session.getSnapshot().showdownResult?.winners).toEqual(['Hero']);
        });

        it('cancels showdown timers immediately when next hand starts', () => {
            const { session, transport, clock } = createSession(new TestClock(10_000));
            session.connect();
            transport.simulateStatus('connected');

            // Enter SHOWDOWN with 60s fallback
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                pot: 200,
                currentBet: 0,
                communityCards: [],
                maxPlayers: 2,
                currentPlayerName: '',
                currentPlayerId: '',
                winners: ['Villain'],
                players: [],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().showdown).not.toBeNull();

            // Next hand starts after 2 seconds
            clock.tick(2000);
            transport.simulateMessage('/game/room-123', {
                phase: 'PRE_FLOP',
                handNumber: 2,
                pot: 15,
                currentBet: 10,
                communityCards: [],
                maxPlayers: 2,
                currentPlayerName: 'Villain',
                currentPlayerId: 'p2',
                players: [],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().showdown).toBeNull();
            expect(session.getSnapshot().showdownResult).toBeNull();

            // Even when original 60s expires, state stays clean
            clock.tick(60_000);
            expect(session.getSnapshot().showdown).toBeNull();
        });

        it('discards stale out-of-order SHOWDOWN packets that arrive after hand has transitioned', () => {
            const { session, transport } = createSession(new TestClock(20_000));
            session.connect();
            transport.simulateStatus('connected');

            // Currently in PRE_FLOP
            transport.simulateMessage('/game/room-123', {
                phase: 'PRE_FLOP',
                handNumber: 2,
                pot: 15,
                currentBet: 10,
                communityCards: [],
                maxPlayers: 2,
                currentPlayerName: 'Hero',
                currentPlayerId: 'p1',
                players: [],
            } as IncomingGameStatePayload);

            // Stale SHOWDOWN packet arrives with already expired deadline (19_000 <= 20_000)
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                handNumber: 1,
                pot: 300,
                currentBet: 0,
                communityCards: ['Ah', 'Kh'],
                maxPlayers: 2,
                currentPlayerName: '',
                currentPlayerId: '',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 19_000,
                players: [],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');
            expect(session.getSnapshot().showdown).toBeNull();
        });

        it('ignores an older hand before changing the clock or action lock', () => {
            const { session, transport } = createSession(new TestClock(20_000));
            session.connect();
            transport.simulateStatus('connected');
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 2,
                players: [createValidPlayer({ id: 'hero-id', name: 'Hero' })],
            }));
            session.playAction('CHECK');
            const revisionBefore = session.getStateSyncRevision();

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                phase: 'SHOWDOWN',
                handNumber: 1,
                serverTimeEpochMs: 999_000,
                currentPlayerName: '',
                currentPlayerId: '',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 19_000,
            }));

            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
            expect(session.getStateSyncRevision()).toBe(revisionBefore);
            expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');
            expect(session.displayNow()).toBe(20_000);
        });

        it('accepts initial hydration with stateRevision', () => {
            const { session } = createSession();
            expect(session.getSnapshot().gameState).toBeNull();

            const accepted = session.applyGameState(createValidGameState({
                handNumber: 1,
                stateRevision: 1,
                pot: 50,
            }) as unknown as IncomingGameStatePayload);

            expect(accepted).toBe(true);
            expect(session.getSnapshot().gameState?.handNumber).toBe(1);
            expect(session.getSnapshot().gameState?.stateRevision).toBe(1);
            expect(session.getSnapshot().gameState?.pot).toBe(50);
        });

        it('rejects stale snapshot with lower stateRevision on the same hand', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            // Newer WebSocket update applied first (hand 2, stateRevision 5)
            session.applyGameState(createValidGameState({
                handNumber: 2,
                stateRevision: 5,
                pot: 100,
            }) as unknown as IncomingGameStatePayload);

            // Stale REST snapshot arrives later with stateRevision 4 for same hand 2
            const accepted = session.applyGameState(createValidGameState({
                handNumber: 2,
                stateRevision: 4,
                pot: 50,
            }) as unknown as IncomingGameStatePayload);

            expect(accepted).toBe(false);
            expect(session.getSnapshot().gameState?.stateRevision).toBe(5);
            expect(session.getSnapshot().gameState?.pot).toBe(100);
        });

        it('accepts newer snapshot with higher stateRevision on the same hand', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.applyGameState(createValidGameState({
                handNumber: 2,
                stateRevision: 5,
                pot: 100,
            }) as unknown as IncomingGameStatePayload);

            const accepted = session.applyGameState(createValidGameState({
                handNumber: 2,
                stateRevision: 6,
                pot: 150,
            }) as unknown as IncomingGameStatePayload);

            expect(accepted).toBe(true);
            expect(session.getSnapshot().gameState?.stateRevision).toBe(6);
            expect(session.getSnapshot().gameState?.pot).toBe(150);
        });

        it('accepts the recovered same-hand revision that follows its pre-restart snapshot', () => {
            const { session } = createSession();
            session.applyGameState(createValidGameState({
                handNumber: 7,
                stateRevision: 18,
                pot: 100,
            }) as unknown as IncomingGameStatePayload);

            const accepted = session.applyGameState(createValidGameState({
                handNumber: 7,
                stateRevision: 19,
                pot: 125,
            }) as unknown as IncomingGameStatePayload);

            expect(accepted).toBe(true);
            expect(session.getSnapshot().gameState?.stateRevision).toBe(19);
            expect(session.getSnapshot().gameState?.pot).toBe(125);
        });

        it('accepts new hand even if stateRevision is lower than previous hand', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.applyGameState(createValidGameState({
                handNumber: 2,
                stateRevision: 10,
                pot: 200,
            }) as unknown as IncomingGameStatePayload);

            // New hand (handNumber 3) with a lower revision (e.g. 1) must be accepted
            const accepted = session.applyGameState(createValidGameState({
                handNumber: 3,
                stateRevision: 1,
                pot: 30,
            }) as unknown as IncomingGameStatePayload);

            expect(accepted).toBe(true);
            expect(session.getSnapshot().gameState?.handNumber).toBe(3);
            expect(session.getSnapshot().gameState?.stateRevision).toBe(1);
            expect(session.getSnapshot().gameState?.pot).toBe(30);
        });

        it('retains showdown when duplicate frames arrive after the displayed countdown reaches zero', () => {
            const { session, transport, clock } = createSession(new TestClock(1_000));
            session.connect();
            transport.simulateStatus('connected');
            const showdown = createValidGameState({
                gameId: 'room-123',
                phase: 'SHOWDOWN',
                currentPlayerName: '',
                currentPlayerId: '',
                winners: ['Hero'],
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 1_100,
            });

            transport.simulateMessage('/game/room-123', showdown);
            expect(session.getSnapshot().showdown).not.toBeNull();
            clock.tick(100);
            expect(session.getSnapshot().showdown).not.toBeNull();

            transport.simulateMessage('/game/room-123', showdown);
            expect(session.getSnapshot().showdown).not.toBeNull();
            clock.tick(250);
            expect(session.getSnapshot().showdown).not.toBeNull();
        });

        it('accepts an initial SHOWDOWN with a past client-clock deadline when server time shows it is current', () => {
            const { session, transport } = createSession(new TestClock(20_000));
            session.connect();
            transport.simulateStatus('connected');
            transport.simulateMessage('/game/room-123', createValidGameState({
                phase: 'SHOWDOWN',
                handNumber: 3,
                serverTimeEpochMs: 10_000,
                readyGateState: 'COUNTING_DOWN',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 15_000,
                winners: ['Hero'],
                players: [createValidPlayer({ id: 'hero-id', name: 'Hero', isWinner: true, chipsWon: 100 })],
            }));

            expect(session.getSnapshot().gameState?.phase).toBe('SHOWDOWN');
            expect(session.getSnapshot().showdownResult?.winners).toEqual(['Hero']);
            expect(session.displayNow()).toBe(10_000);
        });

        it('honors an explicit ready-gate closure instead of retaining the old deadline', () => {
            const { session } = createSession(new TestClock(10_000));
            session.applyGameState(createValidGameState({
                phase: 'SHOWDOWN', handNumber: 4, readyGateState: 'COUNTING_DOWN',
                isReadyCountdownActive: true, readyCountdownDeadlineEpochMs: 25_000,
            }));
            session.applyGameState(createValidGameState({
                phase: 'SHOWDOWN', handNumber: 4, readyGateState: 'CLOSED',
                isReadyCountdownActive: false, readyCountdownDeadlineEpochMs: null,
            }));
            expect(session.getSnapshot().gameState?.readyGateState).toBe('CLOSED');
            expect(session.getSnapshot().gameState?.isReadyCountdownActive).toBe(false);
            expect(session.getSnapshot().gameState?.readyCountdownDeadlineEpochMs).toBeUndefined();
        });

        it('preserves showdown winners, handRank, bestHand, and holeCards across multiple ready-up updates without winners', () => {
            const { session, transport } = createSession(new TestClock(10_000));
            session.connect();
            transport.simulateStatus('connected');

            // Initial SHOWDOWN with winners, handRank, bestHand, and revealed holeCards
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                pot: 600,
                pots: [600],
                currentBet: 0,
                communityCards: ['Ah', 'Ad', 'Kc', '2s', '7d'],
                maxPlayers: 3,
                currentPlayerName: '',
                currentPlayerId: '',
                winners: ['Alice'],
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 25_000,
                players: [
                    {
                        id: 'p1',
                        name: 'Alice',
                        chips: 1600,
                        currentBet: 0,
                        hasFolded: false,
                        status: 'ACTIVE',
                        isWinner: true,
                        holeCards: ['As', 'Kh'],
                        handRank: 'FULL_HOUSE',
                        bestHand: ['Ah', 'Ad', 'As', 'Kc', 'Kh'],
                        isReadyForNextHand: false,
                    },
                    {
                        id: 'p2',
                        name: 'Bob',
                        chips: 700,
                        currentBet: 0,
                        hasFolded: false,
                        status: 'ACTIVE',
                        isWinner: false,
                        holeCards: ['Qh', 'Qd'],
                        handRank: 'TWO_PAIR',
                        bestHand: ['Ah', 'Ad', 'Qh', 'Qd', 'Kc'],
                        isReadyForNextHand: false,
                    },
                ],
            } as IncomingGameStatePayload);

            // First ready-up update (Alice clicks Ready, winners omitted by backend)
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                pot: 0,
                currentBet: 0,
                communityCards: ['Ah', 'Ad', 'Kc', '2s', '7d'],
                maxPlayers: 3,
                currentPlayerName: '',
                currentPlayerId: '',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 25_000,
                players: [
                    { id: 'p1', name: 'Alice', chips: 1600, currentBet: 0, hasFolded: false, status: 'ACTIVE', isReadyForNextHand: true },
                    { id: 'p2', name: 'Bob', chips: 700, currentBet: 0, hasFolded: false, status: 'ACTIVE', isReadyForNextHand: false },
                ],
            } as IncomingGameStatePayload);

            // Second ready-up update (Bob clicks Ready, winners omitted by backend)
            transport.simulateMessage('/game/room-123', {
                phase: 'SHOWDOWN',
                pot: 0,
                currentBet: 0,
                communityCards: ['Ah', 'Ad', 'Kc', '2s', '7d'],
                maxPlayers: 3,
                currentPlayerName: '',
                currentPlayerId: '',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 25_000,
                players: [
                    { id: 'p1', name: 'Alice', chips: 1600, currentBet: 0, hasFolded: false, status: 'ACTIVE', isReadyForNextHand: true },
                    { id: 'p2', name: 'Bob', chips: 700, currentBet: 0, hasFolded: false, status: 'ACTIVE', isReadyForNextHand: true },
                ],
            } as IncomingGameStatePayload);

            const { showdownResult, showdown, gameState } = session.getSnapshot();
            expect(showdownResult?.winners).toEqual(['Alice']);
            expect(showdownResult?.pot).toBe(600);
            expect(showdownResult?.players[0].handRank).toBe('FULL_HOUSE');
            expect(showdownResult?.players[0].bestHand).toEqual(['AH', 'AD', 'AS', 'KC', 'KH']);
            expect(showdownResult?.players[0].holeCards).toEqual(['AS', 'KH']);
            expect(showdownResult?.players[0].isReadyForNextHand).toBe(true);
            expect(showdownResult?.players[1].holeCards).toEqual(['QH', 'QD']);
            expect(showdownResult?.players[1].isReadyForNextHand).toBe(true);
            expect(showdown?.winners).toEqual(['Alice']);
            expect(gameState?.winners).toEqual(['Alice']);
        });

        it('decodes and exposes turnDeadlineEpochMs and clears it during SHOWDOWN or auto-advancing', () => {
            const { session } = createSession(new TestClock(10_000));

            // Preflop state with turn deadline
            session.applyGameState(createValidGameState({
                phase: 'PRE_FLOP',
                handNumber: 1,
                turnDeadlineEpochMs: 70_000,
            }));
            expect(session.getSnapshot().gameState?.turnDeadlineEpochMs).toBe(70_000);

            // Phase changes to SHOWDOWN - deadline must be cleared
            session.applyGameState(createValidGameState({
                phase: 'SHOWDOWN',
                handNumber: 1,
                turnDeadlineEpochMs: 70_000,
            }));
            expect(session.getSnapshot().gameState?.turnDeadlineEpochMs).toBeUndefined();

            // Auto-advancing state - deadline must be cleared
            session.applyGameState(createValidGameState({
                phase: 'FLOP',
                handNumber: 2,
                isAutoAdvancing: true,
                turnDeadlineEpochMs: 80_000,
            }));
            expect(session.getSnapshot().gameState?.turnDeadlineEpochMs).toBeUndefined();
        });

        it('triggers SESSION_SEAT_GONE redirect when hero was seated but is removed from game players', () => {
            const { session, clock, onLeave } = createSession(new TestClock(10_000));
            session.attach();

            // Hand 1 starts: Hero is in players
            session.applyGameState(createValidGameState({
                handNumber: 1,
                players: [createValidPlayer({ name: 'Hero', id: 'hero-id' }), createValidPlayer({ name: 'Bob', id: 'bob-id' })],
            }));
            expect(session.getSnapshot().myPlayerId).toBe('hero-id');
            expect(session.getSnapshot().isRedirecting).toBe(false);

            // Hand 1 update: Hero timed out and was departed, only Bob remains
            session.applyGameState(createValidGameState({
                handNumber: 1,
                stateRevision: 2,
                players: [createValidPlayer({ name: 'Bob', id: 'bob-id' })],
            }));

            // Session must have scheduled redirect with SESSION_SEAT_GONE
            expect(session.getSnapshot().isRedirecting).toBe(true);
            expect(session.getSnapshot().notification).toBe(SESSION_SEAT_GONE);

            // Advancing clock triggers onLeave and clears auth
            clock.tick(3000);
            expect(onLeave).toHaveBeenCalledTimes(1);
        });
    });

    describe('Action Locks & Disconnection / Error Cancellation', () => {
        it('refuses to queue actions when transport is disconnected', () => {
            const { session, transport } = createSession();
            // Not connected yet

            session.playAction('CALL', 20);

            expect(transport.getPublishedMessages()).toHaveLength(0);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(false);
            expect(session.getSnapshot().notification).toBe('Waiting for connection...');
        });

        it('locks action and publishes frame when connected', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.playAction('RAISE', 100);

            const messages = transport.getPublishedMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].destination).toBe('/app/room-123/action');
            expect(JSON.parse(messages[0].body)).toEqual({ action: 'RAISE', amount: 100 });
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);

            // Duplicate call while locked is ignored
            session.playAction('FOLD');
            expect(transport.getPublishedMessages()).toHaveLength(1);
        });

        it('immediately cancels action locks upon transport disconnection', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.playAction('CALL', 20);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);

            // Transport disconnects
            transport.simulateStatus('reconnecting');
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(false);
        });

        it('immediately cancels action locks and publishes notification on STOMP error', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.playAction('BET', 50);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);

            // Transport STOMP error
            transport.simulateError('Broker action rejected');
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(false);
            expect(session.getSnapshot().notification).toBe('Broker action rejected');
        });

        it('routes a structured private action error without rewriting its message', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.playAction('RAISE', 500);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);

            // Private error frame with chip/amount error
            transport.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR',
                code: 'MIN_RAISE',
                action: 'RAISE',
                message: 'Min raise: 50; yours: 25',
            });

            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(false);
            expect(session.getSnapshot().error).toEqual({ type: 'ACTION_ERROR', code: 'MIN_RAISE', action: 'RAISE', message: 'Min raise: 50; yours: 25' });
            expect(session.getSnapshot().notification).toBeNull();
        });

        it('releases only the matching readiness lock for an explicit readiness rejection', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');
            session.ready();
            session.playAction('CHECK');
            transport.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR', code: 'READY_REJECTED', action: 'READY', message: 'No longer eligible',
            });
            expect(session.getSnapshot().pendingActions.has('READY')).toBe(false);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
            expect(session.getSnapshot().notification).toBe('No longer eligible');
            const firstSequence = session.getSnapshot().notificationSequence;
            session.ready();
            transport.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR', code: 'READY_REJECTED', action: 'READY', message: 'No longer eligible',
            });
            expect(session.getSnapshot().notificationSequence).toBeGreaterThan(firstSequence ?? 0);
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
        });

        it('keeps a readiness lock on a generic private notification', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');
            session.ready();
            transport.simulateMessage('/user/queue/private', {
                type: 'PLAYER_NOTIFICATION', message: 'Informational only',
            });
            expect(session.getSnapshot().pendingActions.has('READY')).toBe(true);
        });

        it('accepts an unfamiliar action-error code and replaces prior feedback', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateMessage('/user/queue/private', { type: 'ACTION_ERROR', code: 'MIN_RAISE', action: 'RAISE', message: 'First' });
            transport.simulateMessage('/user/queue/private', { type: 'ACTION_ERROR', code: 'FUTURE_RULE', action: 'CHECK', message: 'Future rule text' });
            expect(session.getSnapshot().error?.message).toBe('Future rule text');
            expect(session.getSnapshot().error?.action).toBe('CHECK');
            expect(session.getSnapshot().notification).toBeNull();
        });

        it('keeps non-action private notifications in the technical notification surface', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateMessage('/user/queue/private', {
                type: 'PLAYER_NOTIFICATION', message: 'Ready countdown is not active.',
            });
            expect(session.getSnapshot().notification).toBe('Ready countdown is not active.');
            expect(session.getSnapshot().error).toBeNull();
        });

        it.each([
            { type: 'ACTION_ERROR', action: 'RAISE', message: 'Rule' },
            { type: 'ACTION_ERROR', code: '', action: 'RAISE', message: 'Rule' },
            { type: 'ACTION_ERROR', code: 4, action: 'RAISE', message: 'Rule' },
            { type: 'ACTION_ERROR', code: 'RULE', message: 'Rule' },
            { type: 'ACTION_ERROR', code: 'RULE', action: 'PUSH', message: 'Rule' },
            { type: 'ACTION_ERROR', code: 'RULE', action: 2, message: 'Rule' },
            { type: 'ACTION_ERROR', code: 'RULE', action: 'RAISE' },
            { type: 'ACTION_ERROR', code: 'RULE', action: 'RAISE', message: '' },
            { type: 'ACTION_ERROR', code: 'RULE', action: 'RAISE', message: 2 },
            { type: 'ACTION_ERROR', code: 'RULE', action: 'RAISE', message: 'Rule', gameId: 'legacy' },
        ])('rejects malformed action-error frames: %j', payload => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateMessage('/user/queue/private', payload);
            expect(session.getSnapshot().error).toBeNull();
            expect(session.getSnapshot().notification).toBeNull();
        });

        it('unlocks action automatically when 3000ms timeout ticks on TestClock', () => {
            const { session, transport, clock } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.ready();
            expect(session.getSnapshot().pendingActions.has('READY')).toBe(true);

            clock.tick(2999);
            expect(session.getSnapshot().pendingActions.has('READY')).toBe(true);

            clock.tick(1);
            expect(session.getSnapshot().pendingActions.has('READY')).toBe(false);
        });

        it('clears action locks when new game state arrives', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            session.playAction('CHECK');
            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);

            transport.simulateMessage('/game/room-123', {
                phase: 'FLOP',
                pot: 100,
                currentBet: 0,
                communityCards: ['2s', '3s', '4s'],
                maxPlayers: 2,
                currentPlayerName: 'Villain',
                currentPlayerId: 'p2',
                players: [],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(false);
        });
    });

    describe('Notification Lifecycle & Auto-Dismiss', () => {
        it('auto-dismisses notification after specified duration using clock', () => {
            const { session, clock } = createSession(new TestClock(1000));

            session.setNotification('Player Villain has folded', 4000);
            expect(session.getSnapshot().notification).toBe('Player Villain has folded');

            clock.tick(3999);
            expect(session.getSnapshot().notification).toBe('Player Villain has folded');

            clock.tick(1);
            expect(session.getSnapshot().notification).toBeNull();
        });

        it('increments notification sequence when identical text is emitted again', () => {
            const { session } = createSession();
            session.setNotification('Same message');
            const firstSequence = session.getSnapshot().notificationSequence;
            session.setNotification('Same message');
            expect(session.getSnapshot().notificationSequence).toBe((firstSequence ?? 0) + 1);
        });

        it('does not allow an earlier notification timer to overwrite ROOM_CLOSED (HOST_LEFT) notification', () => {
            const { session, transport, clock } = createSession(new TestClock(1000));
            session.connect();
            transport.simulateStatus('connected');

            session.setNotification('Minor toast', 4000);
            expect(session.getSnapshot().notification).toBe('Minor toast');

            clock.tick(2000);

            transport.simulateMessage('/room/room-123', {
                message: 'ROOM_CLOSED',
                data: { roomId: 'room-123' },
            });
            expect(session.getSnapshot().notification).toBe(HOST_LEFT);

            // Advance another 2000ms (t=4000ms total, when 'Minor toast' timer would have fired, < 3000ms redirect)
            clock.tick(2000);
            expect(session.getSnapshot().notification).toBe(HOST_LEFT);
        });

        it('does not allow an earlier notification timer to prematurely clear a subsequent handleActionError notification', () => {
            const { session, clock } = createSession(new TestClock(1000));

            session.setNotification('Minor toast', 4000);
            clock.tick(2000);

            session.handleActionError('Action rejected by server');
            expect(session.getSnapshot().notification).toBe('Action rejected by server');

            // Advance 2000ms (when 'Minor toast' 4000ms timer would have expired)
            clock.tick(2000);
            expect(session.getSnapshot().notification).toBe('Action rejected by server');
        });
    });

    describe('Game End Lifecycle', () => {
        it('setGameEndResult clears action locks and a pending ROOM_CLOSED redirect', () => {
            const { session, transport, clock, onLeave } = createSession();
            session.connect();
            transport.simulateStatus('connected');
            session.playAction('CHECK');
            transport.simulateMessage('/room/room-123', { message: 'ROOM_CLOSED' });

            session.setGameEndResult({
                gameId: 'room-123',
                winnerName: 'Hero',
                isForfeit: false,
                message: 'Hero wins',
            });

            expect(session.getSnapshot().pendingActions).toHaveLength(0);
            clock.tick(3_000);
            expect(onLeave).not.toHaveBeenCalled();
        });

        it('transitions to isGameOver and freezes finalState upon GAME_END payload', () => {
            const { session, transport } = createSession();
            session.connect();
            transport.simulateStatus('connected');

            transport.simulateMessage('/game/room-123', {
                type: 'GAME_END',
                winner: 'Hero',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Hero wins tournament!',
                finalState: {
                    phase: 'SHOWDOWN',
                    pot: 2000,
                    currentBet: 0,
                    communityCards: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
                    maxPlayers: 2,
                    currentPlayerName: '',
                    currentPlayerId: '',
                    players: [],
                },
            });

            expect(session.getSnapshot().isGameOver).toBe(true);
            expect(session.getSnapshot().gameEndResult?.winnerName).toBe('Hero');
            expect(session.getSnapshot().gameEndResult?.message).toBe('Hero wins tournament!');
            expect(session.getSnapshot().showdown).toBeNull();

            // Subsequent game state packets are ignored after game end
            transport.simulateMessage('/game/room-123', {
                phase: 'PRE_FLOP',
                pot: 10,
                currentBet: 0,
                communityCards: [],
                maxPlayers: 2,
                currentPlayerName: '',
                currentPlayerId: '',
                players: [],
            } as IncomingGameStatePayload);

            expect(session.getSnapshot().gameState?.phase).toBe('SHOWDOWN');
        });
    });

    describe('Guarded Synchronization Workflow, Private-Card Ordering & Room Reconciliation (Ticket #46)', () => {
        const validToken = createMockJwt();
        const authedUser: AuthResponse = {
            roomId: 'room-123',
            playerName: 'Hero',
            token: validToken,
            message: 'Success',
        };

        function createAuthedSession(clock = new TestClock(1000)) {
            const transport = new InMemoryTransportAdapter();
            const onLeave = vi.fn();
            const session = new GameSession({
                auth: authedUser,
                transport,
                clock,
                onLeave,
            });
            return { session, transport, clock, onLeave };
        }

        it('Attempt A fails publicly; delayed private response arrives after successful B and changes nothing', async () => {
            const { session } = createAuthedSession();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            let resolveAttemptBPrivate!: (val: unknown) => void;
            let resolveAttemptAPrivate!: (val: unknown) => void;

            vi.spyOn(pokerApi, 'getPublicGameState')
                .mockRejectedValueOnce(new Error('Network error on A'))
                .mockResolvedValueOnce(createValidGameState({
                    gameId: 'room-123',
                    handNumber: 2,
                    players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
                }));

            vi.spyOn(pokerApi, 'getPrivatePlayerState')
                .mockImplementationOnce(() => new Promise((resolve) => { resolveAttemptAPrivate = resolve; }))
                .mockImplementationOnce(() => new Promise((resolve) => { resolveAttemptBPrivate = resolve; }));

            void session.synchronizeSession();
            await Promise.resolve();

            const promiseB = session.synchronizeSession({ resetBudget: true });
            await Promise.resolve();

            resolveAttemptBPrivate({
                playerId: 'hero-p1',
                handNumber: 2,
                holeCards: ['AH', 'KH'],
            });
            await promiseB;

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);

            resolveAttemptAPrivate({
                playerId: 'hero-p1',
                handNumber: 1,
                holeCards: ['2C', '3D'],
            });
            await Promise.resolve();

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
        });

        it('same-clock-time attempts cannot reorder state', async () => {
            const clock = new TestClock(5000);
            const { session } = createAuthedSession(clock);
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            let resolveAttempt1Public!: (val: unknown) => void;
            let resolveAttempt2Public!: (val: unknown) => void;

            vi.spyOn(pokerApi, 'getPublicGameState')
                .mockImplementationOnce(() => new Promise((res) => { resolveAttempt1Public = res; }))
                .mockImplementationOnce(() => new Promise((res) => { resolveAttempt2Public = res; }));
            vi.spyOn(pokerApi, 'getPrivatePlayerState')
                .mockResolvedValueOnce({ playerId: 'hero-p1', handNumber: 1, holeCards: ['2C', '3D'] })
                .mockResolvedValueOnce({ playerId: 'hero-p1', handNumber: 2, holeCards: ['AH', 'KH'] });

            const p1 = session.synchronizeSession();
            const p2 = session.synchronizeSession();

            resolveAttempt2Public(createValidGameState({
                gameId: 'room-123',
                handNumber: 2,
                pot: 200,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 800 }],
            }));
            await p2;

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().gameState?.pot).toBe(200);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);

            resolveAttempt1Public(createValidGameState({
                gameId: 'room-123',
                handNumber: 1,
                pot: 100,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 900 }],
            }));
            await p1;

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().gameState?.pot).toBe(200);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
        });

        it('public/private REST responses straddle a hand change without publishing a partial pair', async () => {
            const { session } = createAuthedSession();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            vi.spyOn(pokerApi, 'getPublicGameState').mockResolvedValueOnce(createValidGameState({
                gameId: 'room-123',
                handNumber: 1,
                pot: 50,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 950 }],
            }));
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({
                playerId: 'hero-p1',
                handNumber: 2,
                holeCards: ['AS', 'KS'],
            });

            await session.synchronizeSession();

            expect(session.getSnapshot().gameState).toBeNull();
            expect(session.getSnapshot().privateState).toBeNull();
            expect(session.hasPendingRecoveryTimer()).toBe(true);
        });

        it('commits hand-2 REST private state after an old-hand socket update advances its revision', async () => {
            const { session, transport } = createAuthedSession();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });
            session.applyGameState(createValidGameState({
                gameId: 'room-123', handNumber: 1,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            session.applyPrivateState({ playerId: 'hero-p1', handNumber: 1, holeCards: ['2C', '3D'] });

            let resolvePublic!: (value: unknown) => void;
            vi.spyOn(pokerApi, 'getPublicGameState').mockImplementationOnce(
                () => new Promise((resolve) => { resolvePublic = resolve; })
            );
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({
                playerId: 'hero-p1', handNumber: 2, holeCards: ['AH', 'KH'],
            });
            const sync = session.synchronizeSession();
            await Promise.resolve();
            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1', handNumber: 1, holeCards: ['2C', '3D'],
            });
            resolvePublic(createValidGameState({
                gameId: 'room-123', handNumber: 2,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 900 }],
            }));
            await sync;

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
            expect(session.getSnapshot().isHydrated).toBe(true);
            expect(session.hasPendingRecoveryTimer()).toBe(false);
        });

        it('both STOMP delivery orders work: private-before-public and public-before-private', () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            // Order A: public-before-private for hand 1
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 1,
                phase: 'PRE_FLOP',
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().gameState?.handNumber).toBe(1);
            expect(session.getSnapshot().privateState).toBeNull();

            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1',
                handNumber: 1,
                holeCards: ['QH', 'QD'],
            });
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['QH', 'QD']);

            // Order B: private-before-public for hand 2
            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1',
                handNumber: 2,
                holeCards: ['AH', 'KH'],
            });
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['QH', 'QD']);

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 2,
                phase: 'PRE_FLOP',
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
        });

        it('keeps the newest future private hand buffered and rejects malformed or wrong-hero data', () => {
            const { session, transport } = createAuthedSession();
            session.connect();
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123', handNumber: 1,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            transport.simulateMessage('/user/queue/private', { playerId: 'hero-p1', handNumber: 3, holeCards: ['AH', 'KH'] });
            transport.simulateMessage('/user/queue/private', { playerId: 'hero-p1', handNumber: 2, holeCards: ['QH', 'QD'] });
            transport.simulateMessage('/user/queue/private', { playerId: 'other', handNumber: 4, holeCards: ['AH', 'KH'] });
            transport.simulateMessage('/user/queue/private', { playerId: 'hero-p1', handNumber: 4, holeCards: ['not-a-card', 'QD'] });
            expect(session.getSnapshot().privateState).toBeNull();

            transport.simulateMessage('/user/queue/private', { playerId: 'hero-p1', handNumber: 1, holeCards: ['QH', 'QD'] });
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['QH', 'QD']);
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123', handNumber: 2,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().privateState).toBeNull();
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123', handNumber: 3,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
        });

        it('newer live data supersedes REST, with and without matching private state', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            // Case A: With matching private state -> succeeds without rollback
            let resolveRestPublic!: (val: unknown) => void;
            vi.spyOn(pokerApi, 'getPublicGameState').mockImplementationOnce(
                () => new Promise((res) => { resolveRestPublic = res; })
            );
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({
                playerId: 'hero-p1',
                handNumber: 1,
                holeCards: ['2C', '3D'],
            });

            const syncA = session.synchronizeSession();

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 2,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1',
                handNumber: 2,
                holeCards: ['AH', 'KH'],
            });
            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);

            resolveRestPublic(createValidGameState({
                gameId: 'room-123',
                handNumber: 1,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            await syncA;

            expect(session.getSnapshot().gameState?.handNumber).toBe(2);
            expect(session.getSnapshot().privateState?.holeCards).toEqual(['AH', 'KH']);
            expect(session.hasPendingRecoveryTimer()).toBe(false);

            // Case B: Without matching private state -> retries
            let resolveRestPublicB!: (val: unknown) => void;
            vi.spyOn(pokerApi, 'getPublicGameState').mockImplementationOnce(
                () => new Promise((res) => { resolveRestPublicB = res; })
            );
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({
                playerId: 'hero-p1',
                handNumber: 2,
                holeCards: ['AH', 'KH'],
            });

            const syncB = session.synchronizeSession();

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                handNumber: 3,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            expect(session.getSnapshot().privateState).toBeNull();

            resolveRestPublicB(createValidGameState({
                gameId: 'room-123',
                handNumber: 2,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            await syncB;

            expect(session.hasPendingRecoveryTimer()).toBe(true);
        });

        it('malformed room/public/private/review responses follow the failure table and retain auth', async () => {
            const { session } = createAuthedSession();

            vi.spyOn(pokerApi, 'getRoomData').mockResolvedValueOnce({ invalid: 'room-data' } as any);
            await session.synchronizeSession();
            expect(session.hasPendingRecoveryTimer()).toBe(true);
            expect(session.getSnapshot().recoveryFailed).toBe(false);

            session.clearRecoveryTimer();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            vi.spyOn(pokerApi, 'getPublicGameState').mockResolvedValueOnce({ not: 'a-game-state' });
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({ playerId: 'hero-p1', handNumber: 1, holeCards: [] });
            await session.synchronizeSession({ resetBudget: true });
            expect(session.hasPendingRecoveryTimer()).toBe(true);

            session.clearRecoveryTimer();

            vi.spyOn(pokerApi, 'getPublicGameState').mockResolvedValueOnce(createValidGameState({
                gameId: 'room-123',
                handNumber: 1,
                players: [{ id: 'hero-p1', name: 'Hero', chips: 1000 }],
            }));
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockResolvedValueOnce({ invalid: 'private-state' });
            await session.synchronizeSession({ resetBudget: true });
            expect(session.hasPendingRecoveryTimer()).toBe(true);

            session.clearRecoveryTimer();

            vi.spyOn(pokerApi, 'getPublicGameState').mockRejectedValueOnce({ status: 404 });
            vi.spyOn(pokerApi, 'getReview').mockResolvedValueOnce({ invalid: 'review' } as any);
            await session.synchronizeSession({ resetBudget: true });
            expect(session.hasPendingRecoveryTimer()).toBe(true);
        });

        it('private 403/404 reaches terminal fallback; private timeout/503 retries', async () => {
            const { session } = createAuthedSession();
            session.setRoomState({ roomId: 'room-123', gameStarted: true });

            vi.spyOn(pokerApi, 'getPublicGameState').mockResolvedValueOnce(createValidGameState({ gameId: 'room-123' }));
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockRejectedValueOnce({ status: 404 });
            vi.spyOn(pokerApi, 'getReview').mockResolvedValueOnce({
                gameId: 'room-123',
                winnerName: 'Hero',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Game over review',
            });

            await session.synchronizeSession();

            expect(session.getSnapshot().isGameOver).toBe(true);
            expect(session.getSnapshot().gameEndResult?.winnerName).toBe('Hero');
            expect(session.getSnapshot().loadingStatus).toBe('Connected.');

            const { session: session2 } = createAuthedSession();
            session2.setRoomState({ roomId: 'room-123', gameStarted: true });

            const getReviewSpy = vi.spyOn(pokerApi, 'getReview').mockClear();
            vi.spyOn(pokerApi, 'getPublicGameState').mockResolvedValueOnce(createValidGameState({ gameId: 'room-123' }));
            vi.spyOn(pokerApi, 'getPrivatePlayerState').mockRejectedValueOnce({ status: 503 });

            await session2.synchronizeSession();

            expect(getReviewSpy).not.toHaveBeenCalled();
            expect(session2.hasPendingRecoveryTimer()).toBe(true);
            expect(session2.getSnapshot().isGameOver).toBe(false);
        });

        it('canonical GAME_STARTED installs room data into snapshot, marks started, and synchronizes', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            const syncSpy = vi.spyOn(session, 'synchronizeSession');

            transport.simulateMessage('/room/room-123', {
                message: 'GAME_STARTED',
                data: {
                    roomId: 'room-123',
                    roomName: 'Main Room',
                    players: [
                        { name: 'Hero', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                        { name: 'Player2', isHost: false, joinedAt: '2026-01-01T00:01:00Z' },
                    ],
                    maxPlayers: 6,
                    buyIn: 1000,
                    smallBlind: 10,
                    bigBlind: 20,
                    currentPlayers: 2,
                    canStartGame: false,
                    gameStarted: true,
                },
            });

            expect(session.isStarted()).toBe(true);
            const roomState = session.getSnapshot().roomState;
            expect(roomState).toBeDefined();
            expect(roomState?.gameStarted).toBe(true);
            expect(roomState?.players).toHaveLength(2);
            expect(roomState?.players?.[0].name).toBe('Hero');
            expect(roomState?.players?.[1].name).toBe('Player2');
            expect(roomState?.canStartGame).toBe(false);
            expect(syncSpy).toHaveBeenCalledWith({ resetBudget: true });
        });

        it('canonical GAME_STARTED schedules redirect if hero is not in room players', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            transport.simulateMessage('/room/room-123', {
                message: 'GAME_STARTED',
                data: {
                    roomId: 'room-123',
                    roomName: 'Main Room',
                    players: [
                        { name: 'Other1', isHost: true },
                        { name: 'Other2', isHost: false },
                    ],
                    gameStarted: true,
                },
            });

            expect(session.getSnapshot().notification).toBe('Your seat is no longer active. Returning to lobby...');
            expect(session.hasLifecyclePermission()).toBe(false);
        });

        it('canonical GAME_STARTED for wrong room changes nothing', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            const syncSpy = vi.spyOn(session, 'synchronizeSession');
            const revisionBefore = (session as unknown as { roomRevision: number }).roomRevision;

            transport.simulateMessage('/room/room-123', {
                message: 'GAME_STARTED',
                data: {
                    roomId: 'wrong-room-999',
                    players: [{ name: 'Hero', isHost: true }],
                    gameStarted: true,
                },
            });

            expect(session.isStarted()).toBe(false);
            expect((session as unknown as { roomRevision: number }).roomRevision).toBe(revisionBefore);
            expect(syncSpy).not.toHaveBeenCalled();
        });

        it('legacy GAME_STARTED for wrong gameId changes nothing', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            const syncSpy = vi.spyOn(session, 'synchronizeSession');
            const revisionBefore = (session as unknown as { roomRevision: number }).roomRevision;

            transport.simulateMessage('/room/room-123', {
                message: 'GAME_STARTED',
                data: {
                    gameId: 'wrong-room-999',
                    message: 'Game started',
                },
            });

            expect(session.isStarted()).toBe(false);
            expect((session as unknown as { roomRevision: number }).roomRevision).toBe(revisionBefore);
            expect(syncSpy).not.toHaveBeenCalled();
        });

        it('concurrent room updates preserve membership and started evidence', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            let resolveRoomData!: (val: RoomDataResponse) => void;
            vi.spyOn(pokerApi, 'getRoomData').mockImplementationOnce(
                () => new Promise((res) => { resolveRoomData = res; })
            );

            const syncPromise = session.synchronizeSession();

            transport.simulateMessage('/room/room-123', {
                message: 'PLAYER_JOINED',
                data: {
                    roomId: 'room-123',
                    players: [
                        { name: 'Hero', isHost: true },
                        { name: 'Player2', isHost: false },
                        { name: 'Player3', isHost: false },
                    ],
                },
            });
            transport.simulateMessage('/room/room-123', {
                message: 'GAME_STARTED',
                data: {
                    gameId: 'room-123',
                    message: 'Game has started',
                },
            });

            expect(session.getSnapshot().roomState?.players).toHaveLength(3);
            expect(session.isStarted()).toBe(true);

            resolveRoomData(createValidRoomData({
                roomId: 'room-123',
                gameStarted: false,
                players: [
                    { name: 'Hero', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                    { name: 'Player2', isHost: false, joinedAt: '2026-01-01T00:00:00Z' },
                ],
            }));
            await syncPromise;

            expect(session.getSnapshot().roomState?.players).toHaveLength(3);
            expect(session.getSnapshot().roomState?.gameStarted).toBe(true);
            expect(session.isStarted()).toBe(true);
        });

        it('GAME_END during pending leave retains established success/failure behavior', async () => {
            const { session, transport } = createAuthedSession();
            session.connect();

            session.setPendingLeave(true);
            expect(session.hasLifecyclePermission()).toBe(false);

            transport.simulateMessage('/game/room-123', {
                type: 'GAME_END',
                winner: 'Hero',
                winnerChips: 2000,
                isForfeit: false,
                message: 'Hero won during leave',
            });

            expect(session.getSnapshot().isGameOver).toBe(true);
            expect(session.getSnapshot().gameEndResult?.winnerName).toBe('Hero');

            session.setPendingLeave(false);
            expect(session.getSnapshot().isGameOver).toBe(true);
            expect(session.getSnapshot().gameEndResult?.winnerName).toBe('Hero');

            session.disconnect();
            expect(session.getSnapshot().wsStatus).toBe('disconnected');
        });
    });
});

