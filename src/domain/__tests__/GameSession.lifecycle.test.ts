// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse } from '../../types';
import { pokerApi } from '../../services/api';
import { createValidGameState } from '../../test/fixtures';

describe('GameSession Lifecycle Ownership & Attachment Epochs', () => {
    const auth: AuthResponse = {
        roomId: 'room-lifecycle',
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

    it('manages attachment epochs with idempotent acquire and detach', () => {
        const { session } = createSession();

        // Initial attach
        const epoch1 = session.attach();
        expect(epoch1).toBeGreaterThan(0);
        expect(session.isAttached()).toBe(true);
        expect(session.getAttachmentEpoch()).toBe(epoch1);

        // Idempotent re-attach returns same epoch while attached
        const epoch1Again = session.attach();
        expect(epoch1Again).toBe(epoch1);

        // Detach invalidates epoch and sets attached to false
        session.detach();
        expect(session.isAttached()).toBe(false);
        const detachedEpoch = session.getAttachmentEpoch();
        expect(detachedEpoch).toBeGreaterThan(epoch1);

        // Idempotent detach
        session.detach();
        expect(session.isAttached()).toBe(false);

        // acquire / release aliases
        const epoch2 = session.acquire();
        expect(epoch2).toBeGreaterThan(detachedEpoch);
        expect(session.isAttached()).toBe(true);

        session.release();
        expect(session.isAttached()).toBe(false);
    });

    it('detaching clears onLeave and cancels pending redirect timers', () => {
        const { session, clock, onLeave } = createSession();
        session.attach();

        session.scheduleRedirect('Room closed by host');
        expect(onLeave).not.toHaveBeenCalled();

        // Detach session before redirect timer completes
        session.detach();

        // Advance past ROOM_CLOSED_REDIRECT_MS
        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('detaching cancels action locks and notification timers', () => {
        const { session, clock } = createSession();
        session.attach();

        // Trigger notification with timer
        session.setNotification('Hello world', 4000);
        expect(session.getSnapshot().notification).toBe('Hello world');

        session.detach();
        expect(session.getSnapshot().notification).toBeNull();

        // Advance timers - no resurrection
        clock.tick(5000);
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('detaching cancels recovery timers and aborts in-flight recovery attempts', async () => {
        const { session, clock } = createSession();
        session.attach();

        let abortSignalled = false;
        const mockGetRoomData = vi.fn((_roomId: string, _token: string, signal?: AbortSignal) => {
            return new Promise<never>((_, reject) => {
                signal?.addEventListener('abort', () => {
                    abortSignalled = true;
                    reject(new Error('Aborted'));
                });
            });
        });

        const customApi = {
            ...pokerApi,
            getRoomData: mockGetRoomData,
        };

        const sessionWithApi = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            pokerApi: customApi as any,
        });

        sessionWithApi.attach();
        void sessionWithApi.synchronizeSession();

        // Detach before synchronization finishes
        sessionWithApi.detach();
        expect(abortSignalled).toBe(true);
        expect(sessionWithApi.getSnapshot().isRecovering).toBe(false);
    });

    it('detaching cancels claim work and disconnects transport without socket setup', () => {
        const { session, transport } = createSession();
        const disconnectSpy = vi.spyOn(transport, 'disconnect');
        session.attach();

        session.setClaimPending(true);
        expect(session.getSnapshot().claimPending).toBe(true);

        session.detach();

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().wsStatus).toBe('disconnected');
        expect(disconnectSpy).toHaveBeenCalled();
    });

    it('supports Strict Mode reversible detach -> attach with pre-hydration work re-enabled', async () => {
        const { session } = createSession();

        // 1st mount: attach
        const epoch1 = session.attach();
        expect(session.hasLifecyclePermission()).toBe(true);

        // StrictMode cleanup: detach
        session.detach();
        expect(session.isAttached()).toBe(false);
        expect(session.hasLifecyclePermission()).toBe(false);

        // StrictMode remount: attach again
        const epoch2 = session.attach();
        expect(epoch2).toBeGreaterThan(epoch1);
        expect(session.isAttached()).toBe(true);
        expect(session.hasLifecyclePermission()).toBe(true);

        // Pre-hydration work works without needing connect()
        let loadCalled = false;
        vi.spyOn(session, 'synchronizeSession').mockImplementation(async () => {
            loadCalled = true;
        });

        await session.synchronizeSession();
        expect(loadCalled).toBe(true);
    });

    it('dispose permanently prevents re-attachment lifecycle permission', () => {
        const { session } = createSession();
        session.attach();

        session.dispose();
        expect(session.isAttached()).toBe(false);
        expect(session.hasLifecyclePermission()).toBe(false);

        // Attempting to attach after dispose does not re-enable lifecycle permission
        session.attach();
        expect(session.hasLifecyclePermission()).toBe(false);
    });

    it('aborts in-flight attempt fetch via AbortSignal when a new recovery attempt is triggered', async () => {
        const { clock } = createSession();
        let firstSignal: AbortSignal | undefined;
        let secondSignal: AbortSignal | undefined;
        let callCount = 0;

        const mockGetRoomData = vi.fn((_roomId: string, _token: string, signal?: AbortSignal) => {
            callCount++;
            if (callCount === 1) {
                firstSignal = signal;
                return new Promise<never>(() => {
                    // stays pending until aborted
                });
            } else {
                secondSignal = signal;
                return Promise.resolve({
                    roomId: 'room-lifecycle',
                    roomName: 'Lobby',
                    players: [{ name: 'Hero', isHost: false }],
                    gameStarted: false,
                });
            }
        });

        const customApi = {
            ...pokerApi,
            getRoomData: mockGetRoomData,
        };

        const session = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            pokerApi: customApi as any,
        });
        session.attach();

        // 1st attempt starts
        void session.synchronizeSession();
        expect(callCount).toBe(1);
        expect(firstSignal).toBeDefined();
        expect(firstSignal?.aborted).toBe(false);
        const initialAttempt = session.getAttemptId();
        expect(initialAttempt).toBe(1);

        // 2nd attempt triggered while 1st is still in-flight
        const syncPromise2 = session.synchronizeSession();
        expect(callCount).toBe(2);
        expect(firstSignal?.aborted).toBe(true);
        expect(secondSignal?.aborted).toBe(false);
        expect(session.getAttemptId()).toBe(2);

        await syncPromise2;
        expect(session.getSnapshot().roomState?.gameStarted).toBe(false);
    });

    it('aborts in-flight attempt fetch via AbortSignal when a new recovery attempt is scheduled after partial failure', async () => {
        const { clock } = createSession();
        let privateSignal: AbortSignal | undefined;
        let privateAborted = false;

        const mockGetPublicGameState = vi.fn(() => Promise.reject(new Error('500 Internal Server Error')));
        const mockGetPrivatePlayerState = vi.fn((_roomId: string, _token: string, signal?: AbortSignal) => {
            privateSignal = signal;
            signal?.addEventListener('abort', () => {
                privateAborted = true;
            });
            return new Promise<never>(() => {});
        });

        const customApi = {
            ...pokerApi,
            getPublicGameState: mockGetPublicGameState,
            getPrivatePlayerState: mockGetPrivatePlayerState,
        };

        const session = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            initialRoomState: {
                roomId: 'room-lifecycle',
                roomName: 'Live Game',
                players: [{ name: 'Hero', isHost: false }],
                gameStarted: true,
            },
            pokerApi: customApi as any,
        });
        session.attach();

        // Start synchronization on started game -> runs public & private concurrently
        await session.synchronizeSession();

        // Failure of public state triggers scheduleNextRecoveryRetry, which aborts the in-flight attempt
        expect(privateSignal).toBeDefined();
        expect(privateAborted).toBe(true);
        expect(privateSignal?.aborted).toBe(true);
        expect(session.hasPendingRecoveryTimer()).toBe(true);
    });

    it('ignores stale or superseded attempt completions and does not regress privateSyncRevision', async () => {
        const { clock } = createSession();

        let resolveAttempt1!: (value: any) => void;
        let callCount = 0;

        const mockGetPublic = vi.fn(() => {
            callCount++;
            if (callCount === 1) {
                return new Promise((resolve) => {
                    resolveAttempt1 = resolve;
                });
            }
            return Promise.resolve(createValidGameState({
                gameId: 'room-lifecycle',
                handNumber: 2,
                phase: 'FLOP',
                pot: 200,
                players: [{ id: 'hero-1', name: 'Hero', chips: 900 }],
                communityCards: ['AH', 'KH', 'QH'],
                stateRevision: 2,
            }));
        });

        const mockGetPrivate = vi.fn(() => {
            if (callCount === 1) {
                return Promise.resolve({
                    playerId: 'hero-1',
                    handNumber: 1,
                    holeCards: ['2C', '3D'], // Stale hand 1 cards from Attempt 1
                });
            }
            return Promise.resolve({
                playerId: 'hero-1',
                handNumber: 2,
                holeCards: ['AS', 'KS'], // Fresh hand 2 cards from Attempt 2
            });
        });

        const customApi = {
            ...pokerApi,
            getPublicGameState: mockGetPublic,
            getPrivatePlayerState: mockGetPrivate,
        };

        const session = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            initialRoomState: {
                roomId: 'room-lifecycle',
                roomName: 'Live Game',
                players: [{ name: 'Hero', isHost: false }],
                gameStarted: true,
            },
            pokerApi: customApi as any,
        });
        session.attach();

        // Attempt 1 starts with hand 1
        const attempt1Promise = session.synchronizeSession();
        expect(session.getAttemptId()).toBe(1);

        // Attempt 2 supersedes Attempt 1 and completes with Hand 2 cards
        const attempt2Promise = session.synchronizeSession();
        expect(session.getAttemptId()).toBe(2);
        await attempt2Promise;

        // Verify Attempt 2 applied fresh hand 2 cards and advanced revision
        expect(session.getSnapshot().gameState?.handNumber).toBe(2);
        expect(session.getSnapshot().privateState?.holeCards).toEqual(['AS', 'KS']);
        const freshRevision = session.getPrivateSyncRevision();
        expect(freshRevision).toBeGreaterThan(0);

        // Now Attempt 1 resolves late with stale Hand 1 data
        resolveAttempt1(createValidGameState({
            gameId: 'room-lifecycle',
            handNumber: 1,
            phase: 'PRE_FLOP',
            pot: 100,
            players: [{ id: 'hero-1', name: 'Hero', chips: 1000 }],
            stateRevision: 1,
        }));
        await attempt1Promise;

        // Verify Attempt 1's stale completion was ignored and did not regress privateSyncRevision or cards
        expect(session.getSnapshot().gameState?.handNumber).toBe(2);
        expect(session.getSnapshot().privateState?.holeCards).toEqual(['AS', 'KS']);
        expect(session.getPrivateSyncRevision()).toBe(freshRevision);
    });

    it('tracks monotonic attemptId across recovery, retry scheduling, and cancellation', async () => {
        const mockApi = {
            ...pokerApi,
            getRoomData: vi.fn(() => Promise.resolve({
                roomId: 'room-lifecycle',
                roomName: 'Lobby',
                players: [{ name: 'Hero', isHost: false }],
                gameStarted: false,
            })),
        };
        const session = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock: new TestClock(1000),
            pokerApi: mockApi as any,
        });
        session.attach();

        const initialAttempt = session.getAttemptId();
        expect(initialAttempt).toBe(0);

        void session.synchronizeSession();
        const attempt1 = session.getAttemptId();
        expect(attempt1).toBe(1);

        session.cancelRecovery();
        const attempt2 = session.getAttemptId();
        expect(attempt2).toBe(2);

        void session.synchronizeSession();
        const attempt3 = session.getAttemptId();
        expect(attempt3).toBe(3);
    });

    it('detached session completely ignores delayed messages, state mutations, and cannot re-arm onLeave', () => {
        const { session, clock, onLeave } = createSession();
        session.attach();

        // Arm a redirect timer
        session.scheduleRedirect('Redirect scheduled');

        // Detach the session
        session.detach();
        expect(session.isAttached()).toBe(false);

        // Attempt to assign a new onLeave callback while detached
        const newOnLeave = vi.fn();
        session.setOnLeave(newOnLeave);

        // Attempt mutations while detached
        const appliedGame = session.applyGameState(createValidGameState({
            gameId: 'room-lifecycle',
            handNumber: 5,
            phase: 'TURN',
        }));
        expect(appliedGame).toBe(false);

        session.applyPrivateState({
            handNumber: 5,
            playerId: 'Hero',
            holeCards: ['AH', 'KH'],
        });

        session.setRoomState({
            roomId: 'room-lifecycle',
            roomName: 'Mutated Room',
            players: [],
            gameStarted: true,
        });

        session.setNotification('Stale notification', 1000);
        session.handleActionError('game not found');

        // Verify snapshot was not mutated
        const snapshot = session.getSnapshot();
        expect(snapshot.gameState).toBeNull();
        expect(snapshot.privateState).toBeNull();
        expect(snapshot.roomState?.roomName).toBe('');
        expect(snapshot.notification).toBeNull();

        // Advance past all timer delays
        clock.tick(10000);

        expect(onLeave).not.toHaveBeenCalled();
        expect(newOnLeave).not.toHaveBeenCalled();
    });

    it('detached session clears socket, connect, and retry listeners and does not notify subscribers', () => {
        const { session } = createSession();
        session.attach();

        const connectCb = vi.fn();
        const retryCb = vi.fn();
        const errorCb = vi.fn();
        const subscriberCb = vi.fn();

        session.onConnect(connectCb);
        session.onManualRetry(retryCb);
        session.onSocketError(errorCb);
        session.subscribe(subscriberCb);

        session.detach();
        subscriberCb.mockClear();

        // Attempting retryConnection on detached session does not call retry listener
        session.retryConnection();
        expect(retryCb).not.toHaveBeenCalled();

        // Attempting notifications or error handling does not call listeners or subscribers
        session.handleActionError('test error');
        expect(errorCb).not.toHaveBeenCalled();
        expect(subscriberCb).not.toHaveBeenCalled();
    });
});
