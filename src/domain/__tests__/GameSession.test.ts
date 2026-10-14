// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, IncomingGameStatePayload } from '../../types';
import { HOST_LEFT } from '../../constants/strings';
import { createValidGameState, createValidPlayer } from '../../test/fixtures';

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
            expect(session.getSnapshot().gameState?.communityCards).toEqual(['As', 'Kd', 'Qc']);
            expect(session.getSnapshot().gameState?.pot).toBe(50);
        });

        it('syncs private state and sets hero player ID', () => {
            const { session, transport } = createSession();
            session.connect();

            transport.simulateMessage('/user/queue/private', {
                playerId: 'hero-p1',
                holeCards: ['Ah', 'Kh'],
            });

            expect(session.getSnapshot().privateState?.holeCards).toEqual(['Ah', 'Kh']);
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
        it('preserves pot during showdown and clears showdown after countdown ticks', () => {
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

            // Reaching deadline clears showdown
            clock.tick(1);
            expect(session.getSnapshot().showdown).toBeNull();
            expect(session.getSnapshot().showdownResult).toBeNull();
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

        it('does not clear a PLAY_ACTION lock or advance the revision for an expired SHOWDOWN frame', () => {
            const { session, transport } = createSession(new TestClock(20_000));
            session.connect();
            transport.simulateStatus('connected');
            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                players: [createValidPlayer({ id: 'hero-id', name: 'Hero' })],
            }));
            session.playAction('CHECK');
            const revisionBefore = session.getStateSyncRevision();

            transport.simulateMessage('/game/room-123', createValidGameState({
                gameId: 'room-123',
                phase: 'SHOWDOWN',
                currentPlayerName: '',
                currentPlayerId: '',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 19_000,
            }));

            expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
            expect(session.getStateSyncRevision()).toBe(revisionBefore);
            expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');
        });

        it('does not resurrect showdown when a duplicate frame arrives at the exact deadline', () => {
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
            expect(session.getSnapshot().showdown).toBeNull();

            transport.simulateMessage('/game/room-123', showdown);
            expect(session.getSnapshot().showdown).toBeNull();
            clock.tick(250);
            expect(session.getSnapshot().showdown).toBeNull();
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
            expect(showdownResult?.players[0].bestHand).toEqual(['Ah', 'Ad', 'As', 'Kc', 'Kh']);
            expect(showdownResult?.players[0].holeCards).toEqual(['As', 'Kh']);
            expect(showdownResult?.players[0].isReadyForNextHand).toBe(true);
            expect(showdownResult?.players[1].holeCards).toEqual(['Qh', 'Qd']);
            expect(showdownResult?.players[1].isReadyForNextHand).toBe(true);
            expect(showdown?.winners).toEqual(['Alice']);
            expect(gameState?.winners).toEqual(['Alice']);
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
});
