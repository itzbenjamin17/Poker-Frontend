// Must be imported before modules that load @stomp/stompjs.
import { MockStompClient, activeSubscriptions } from '../../test/mocks/stomp';
import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { useGameWebSocket } from '../useGameWebSocket';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { StompTransportAdapter, InMemoryTransportAdapter } from '../../services/transport';
import type { PrivatePlayerState, RoomDataResponse } from '../../types';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';
import { HOST_LEFT } from '../../constants/strings';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

async function advanceRecoveryRetries(
    clock: TestClock,
    targetSession: GameSession,
    getCallCount: () => number,
    maxSteps = 3
) {
    for (let step = 0; step < maxSteps && targetSession.hasPendingRecoveryTimer(); step += 1) {
        const previousCalls = getCallCount();
        act(() => {
            clock.tick(10_000);
        });
        await waitFor(() => {
            expect(getCallCount()).toBeGreaterThan(previousCalls);
        });
        await waitFor(() => {
            expect(targetSession.hasPendingRecoveryTimer() || targetSession.getSnapshot().recoveryFailed).toBe(true);
        });
    }
}

describe('useGameWebSocket', () => {
    const token = createMockJwt({ sub: 'TestPlayer' });
    const mockAuth = {
        token,
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
    };
    const onLeave = vi.fn();
    const onSocketError = vi.fn();
    let clock: TestClock;
    let session: GameSession;

    function createWrapper(customSession = session) {
        return function Wrapper({ children }: { children: ReactNode }) {
            return createElement(GameProvider, {
                auth: mockAuth,
                onLeave,
                session: customSession,
                children,
            });
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
        clock = new TestClock(1000);

        server.use(
            http.get('*/api/room/ROOM123', () =>
                HttpResponse.json(createValidRoomData({
                    roomId: 'ROOM123',
                    players: [{ name: 'TestPlayer', isHost: true }],
                }))
            ),
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE', hasFolded: false }],
                }))
            ),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({
                    playerId: 'p-1',
                    handNumber: 0,
                    holeCards: [],
                })
            )
        );

        session = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
            clock,
            onLeave,
        });
        session.setHydrated(true);
    });

    it('subscribes to channels on connection', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        expect(result.current).toBeDefined();

        await MockStompClient.waitForSubscription('/game/ROOM123');

        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
        expect(activeSubscriptions.has('/room/ROOM123')).toBe(true);
        expect(activeSubscriptions.has('/game/ROOM123')).toBe(true);
    });

    it('handles ROOM_CLOSED updates by updating session state and scheduling redirect', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await MockStompClient.waitForSubscription('/room/ROOM123');

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', createValidRoomData({
                roomId: 'ROOM123',
                closedReason: 'HOST_LEFT',
            }));
        });

        expect(session.getSnapshot().notification).toBe(HOST_LEFT);
        expect(session.getSnapshot().loadingStatus).toBe(HOST_LEFT);
        expect(session.getSnapshot().roomState).toBeNull();

        act(() => {
            clock.tick(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('handles incoming private state and action errors', async () => {
        session.applyGameState(createValidGameState({
            gameId: 'ROOM123',
            handNumber: 0,
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
        }));
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await MockStompClient.waitForSubscription('/user/queue/private');

        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR',
                code: 'RAISE_AMOUNT_REQUIRED',
                action: 'RAISE',
                message: 'Invalid Raise Amount',
            });
        });
        expect(onSocketError).not.toHaveBeenCalled();
        expect(session.getSnapshot().error?.message).toBe('Invalid Raise Amount');

        const privatePayload: PrivatePlayerState = {
            playerId: 'p-1',
            handNumber: 0,
            holeCards: ['AS', 'KS'],
        };
        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', privatePayload);
        });
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'KS'] });
        expect(session.getSnapshot().myPlayerId).toBe('p-1');
    });

    it('resubscribes to private channel after STOMP reconnect', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await MockStompClient.waitForSubscription('/user/queue/private');
        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);

        // Simulate socket drop via MockStompClient helper
        act(() => {
            activeSubscriptions.clear();
            MockStompClient.simulateDisconnect();
        });

        expect(activeSubscriptions.has('/user/queue/private')).toBe(false);

        // Simulate STOMP reconnect via MockStompClient helper
        act(() => {
            MockStompClient.simulateConnect();
        });

        // Should be resubscribed to private channel without stale guards blocking it
        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
    });

    it('updates gameEndResult with snapshot on completed game state frame', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        const gameEndPayload = createValidGameState({
            gameId: 'ROOM123',
            phase: 'SHOWDOWN',
            pot: 1000,
            currentPlayerName: '',
            currentPlayerId: '',
            players: [createValidGameState().players[0]],
            communityCards: ['AS', 'KS', 'QS', 'JS', 'TS'],
            gameEnd: {
                winner: 'Player1',
                winnerChips: 500,
                isForfeit: false,
                message: 'Player1 wins!',
            },
        });

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', gameEndPayload);
        });

        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult).toMatchObject({
            gameId: 'ROOM123',
            phase: 'SHOWDOWN',
            pot: 1000,
            gameEnd: {
                winner: 'Player1',
                winnerChips: 500,
                isForfeit: false,
                message: 'Player1 wins!',
            },
        });
    });

    it('ignores subsequent game updates after game end', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        act(() => {
            session.setGameEndResult(createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                players: [{ id: 'p-1', name: 'Player1', chips: 1000 }],
                gameEnd: { winner: 'Player1', isForfeit: false, message: 'Done' },
            }));
        });

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 50,
                players: [{ id: 'p-1', name: 'Player1', chips: 950 }],
            }));
        });

        expect(session.getSnapshot().gameState?.phase).toBe('SHOWDOWN');
    });

    it('does not schedule redirect on 403 after game end', async () => {
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return HttpResponse.json({ detail: 'Forbidden' }, { status: 403 });
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        act(() => {
            session.setGameEndResult(createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                players: [{ id: 'p-1', name: 'Player1', chips: 1000 }],
                gameEnd: { winner: 'Player1', isForfeit: false, message: 'Done' },
            }));
        });

        act(() => {
            MockStompClient.simulateConnect();
            window.dispatchEvent(new Event('online'));
        });

        expect(publicCalls).toBe(0);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('ignores ROOM_CLOSED after game end', async () => {
        session.setRoomState(createValidRoomData({
            roomId: 'ROOM123',
            players: [{ name: 'TestPlayer', isHost: true }],
        }));

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/room/ROOM123');

        act(() => {
            session.setGameEndResult(createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                players: [{ id: 'p-1', name: 'Player1', chips: 1000 }],
                gameEnd: { winner: 'Player1', isForfeit: false, message: 'Done' },
            }));
        });

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', createValidRoomData({
                roomId: 'ROOM123',
                closedReason: 'HOST_LEFT',
            }));
        });

        expect(session.getSnapshot().roomState).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('does not fetch game state or private state on connect when room has not started', async () => {
        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return HttpResponse.json(createValidGameState({ gameId: 'ROOM123' }));
            }),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                return HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: [] });
            })
        );
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'LobbyRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: false,
        });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/room/ROOM123');
        await waitFor(() => expect(session.getSnapshot().roomState).not.toBeNull());

        expect(publicCalls).toBe(0);
        expect(privateCalls).toBe(0);
    });

    it('fetches getRoomInfo and updates roomState when WebSocket connects/reconnects while roomState.gameStarted is false', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'LobbyRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: false,
        });

        let capturedAuthHeader: string | null = null;
        let roomCalls = 0;
        server.use(
            http.get('*/api/room/ROOM123', ({ request }) => {
                roomCalls += 1;
                capturedAuthHeader = request.headers.get('Authorization');
                return HttpResponse.json({
                    roomId: 'ROOM123',
                    roomName: 'LobbyRoom',
                    players: [
                        { name: 'TestPlayer', isHost: true },
                        { name: 'NewOpponent', isHost: false },
                    ],
                    maxPlayers: 6,
                    buyIn: 1000,
                    smallBlind: 10,
                    bigBlind: 20,
                    canStartGame: true,
                    gameStarted: false,
                });
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(roomCalls).toBe(1));
        await waitFor(() => expect(session.getSnapshot().roomState?.players).toHaveLength(2));
        expect(capturedAuthHeader).toBe(`Bearer ${token}`);
        expect(session.getSnapshot().roomState?.canStartGame).toBe(true);
    });

    it('fetches game state and private state on connect when game has started', async () => {
        let publicCalls = 0;
        let privateCalls = 0;
        let publicAuth: string | null = null;
        let privateAuth: string | null = null;
        server.use(
            http.get('*/api/game/ROOM123/state', ({ request }) => {
                publicCalls += 1;
                publicAuth = request.headers.get('Authorization');
                return HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000 }],
                }));
            }),
            http.get('*/api/game/ROOM123/private-state', ({ request }) => {
                privateCalls += 1;
                privateAuth = request.headers.get('Authorization');
                return HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: [] });
            })
        );

        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(privateCalls).toBe(1));
        expect(publicAuth).toBe(`Bearer ${token}`);
        expect(privateAuth).toBe(`Bearer ${token}`);
    });

    it('handles STOMP error frame by updating ws status and calling onSocketError', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        act(() => {
            MockStompClient.simulateStompError({
                headers: { message: 'Subscription rejected by broker' },
                body: 'Detailed error trace',
            });
        });

        expect(session.getSnapshot().wsStatus).toBe('reconnecting');
        expect(session.getSnapshot().notification).toBe('Subscription rejected by broker');
        expect(onSocketError).toHaveBeenCalledWith('Subscription rejected by broker');
    });

    it('ignores STOMP error after game end when connected', async () => {
        const { rerender } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        // Simulate game end while connected
        act(() => {
            session.setGameEndResult(createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                players: [{ id: 'p-1', name: 'Player1', chips: 1000 }],
                gameEnd: { winner: 'Player1', isForfeit: false, message: 'Done' },
            }));
        });
        rerender();

        onSocketError.mockClear();

        act(() => {
            MockStompClient.simulateStompError({
                headers: { message: 'Room destroyed' },
            });
        });

        expect(session.getSnapshot().wsStatus).toBe('connected');
        expect(onSocketError).not.toHaveBeenCalled();
    });

    it('handles STOMP error frame with body fallback when message header is missing', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        act(() => {
            MockStompClient.simulateStompError({
                body: 'Internal broker connection failure',
            });
        });

        expect(session.getSnapshot().wsStatus).toBe('reconnecting');
        expect(onSocketError).toHaveBeenCalledWith('Internal broker connection failure');
    });

    it('handles STOMP error frame with default fallback when both header and body are missing', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await MockStompClient.waitForSubscription('/game/ROOM123');

        act(() => {
            MockStompClient.simulateStompError({});
        });

        expect(session.getSnapshot().wsStatus).toBe('reconnecting');
        expect(onSocketError).toHaveBeenCalledWith('STOMP transport error');
    });

    it('works seamlessly with InMemoryTransportAdapter', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        expect(session.getSnapshot().wsStatus).toBe('connected');

        // Verify zero duplicate subscriptions
        const subscriptions = inMemoryTransport.getSubscriptions();
        expect(subscriptions.get('/room/ROOM123')?.size).toBe(1);
        expect(subscriptions.get('/game/ROOM123')?.size).toBe(1);
        expect(subscriptions.get('/user/queue/private')?.size).toBe(1);

        // Test error injection
        act(() => {
            inMemoryTransport.simulateError('In-memory simulated error');
        });

        expect(onSocketError).toHaveBeenCalledWith('In-memory simulated error');

        // Test packet injection
        act(() => {
            inMemoryTransport.simulateMessage('/room/ROOM123', JSON.stringify(createValidRoomData({
                roomId: 'ROOM123',
                closedReason: 'HOST_LEFT',
            })));
        });

        expect(session.getSnapshot().roomState).toBeNull();
    });

    it('retries onConnect recovery after transient getGameState or getPrivateState failures and applies both snapshots once responses succeed', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        const validGameState = createValidGameState({
            gameId: 'ROOM123',
            phase: 'FLOP',
            pot: 300,
            currentBet: 50,
            communityCards: ['AH', 'KD', '2C'],
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 950, currentBet: 50, status: 'ACTIVE', hasFolded: false }],
        });
        const validPrivateState: PrivatePlayerState = {
            playerId: 'p-1',
            handNumber: 0,
            holeCards: ['AS', 'AD'],
        };

        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                if (publicCalls === 1) {
                    return HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 });
                }
                return HttpResponse.json(validGameState);
            }),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                if (privateCalls === 2) {
                    return HttpResponse.json({ detail: 'Bad gateway' }, { status: 502 });
                }
                return HttpResponse.json(validPrivateState);
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        // Connect triggers attempt 1 (fails getGameState 503)
        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));
        expect(session.getSnapshot().isRecovering).toBe(true);
        expect(session.getSnapshot().loadingStatus).toBe('Reconnecting / restoring table…');

        // Advance past backoff 1 -> attempt 2 (getGameState succeeds, getPrivateState fails 502)
        act(() => {
            clock.tick(1500);
        });
        await waitFor(() => expect(publicCalls).toBe(2));
        await waitFor(() => expect(privateCalls).toBe(2));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));
        expect(session.getSnapshot().isRecovering).toBe(true);

        // Advance past backoff 2 -> attempt 3 (both succeed)
        act(() => {
            clock.tick(2500);
        });
        await waitFor(() => expect(publicCalls).toBe(3));
        await waitFor(() => expect(privateCalls).toBe(3));
        await waitFor(() => expect(session.getSnapshot().isRecovering).toBe(false));
        expect(session.getSnapshot().recoveryFailed).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'AD'] });
    });

    it('runs state recovery on visibilitychange (visible) and online even when transport.isConnected() is true without tearing down the socket', async () => {
        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000 }],
                }));
            }),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                return HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: [] });
            })
        );
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(privateCalls).toBe(1));
        expect(inMemoryTransport.isConnected()).toBe(true);

        const connectSpy = vi.spyOn(inMemoryTransport, 'connect');
        const disconnectSpy = vi.spyOn(inMemoryTransport, 'disconnect');

        // Trigger visibilitychange -> visible while connected
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await waitFor(() => expect(publicCalls).toBe(2));
        await waitFor(() => expect(privateCalls).toBe(2));
        expect(connectSpy).not.toHaveBeenCalled();
        expect(disconnectSpy).not.toHaveBeenCalled();

        // Trigger online while connected
        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        await waitFor(() => expect(publicCalls).toBe(3));
        await waitFor(() => expect(privateCalls).toBe(3));
        expect(connectSpy).not.toHaveBeenCalled();
        expect(disconnectSpy).not.toHaveBeenCalled();
    });

    it('drops a still-open socket as soon as the browser reports it is offline', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        const forceReconnect = vi.fn(() => inMemoryTransport.simulateStatus('reconnecting'));
        Object.assign(inMemoryTransport, { forceReconnect });

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(inMemoryTransport.isConnected()).toBe(true));

        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        expect(forceReconnect).toHaveBeenCalledTimes(1);
        expect(inMemoryTransport.isConnected()).toBe(false);

        // A second offline event while already disconnected does not churn the socket.
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });
        expect(forceReconnect).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent connected, online, and visibilitychange events into one in-flight recovery transaction', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        const pendingGameState = deferred<Response>();
        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return pendingGameState.promise;
            }),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                return HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: [] });
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        // Initial connect started 1 recovery transaction which is still in flight; initial attempt-0 sync is silent (isRecovering: false)
        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(privateCalls).toBe(1));
        expect(session.getSnapshot().isRecovering).toBe(false);

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        // Fire online, visibilitychange, and another connected status while the first is in flight
        act(() => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
            inMemoryTransport.connect();
        });

        expect(publicCalls).toBe(1);
        expect(privateCalls).toBe(1);

        await act(async () => {
            pendingGameState.resolve(HttpResponse.json(createValidGameState({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                handNumber: 0,
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
            })));
        });

        await waitFor(() => expect(session.getSnapshot().isRecovering).toBe(false));
    });

    it('redirects with SESSION_SEAT_GONE on 403 and SESSION_EXPIRED on 404 for room or started-game state, and cancels pending retry timers on unmount or gameEnd', async () => {
        // 1. 403 on getGameState -> SESSION_SEAT_GONE
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });
        server.use(
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
            )
        );

        const { unmount } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(session.isRedirectingActive()).toBe(true));

        expect(session.getSnapshot().notification).toContain('Your seat is no longer active');
        expect(session.hasPendingRecoveryTimer()).toBe(false);
        unmount();

        // 2. 404 on getGameState when gameStarted is true -> SESSION_EXPIRED
        const session2 = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
            clock,
            onLeave,
        });
        session2.setHydrated(true);
        session2.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });
        server.use(
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json({ detail: 'Not found' }, { status: 404 })
            )
        );

        const { unmount: unmount2 } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(session2),
        });

        await waitFor(() => expect(session2.isRedirectingActive()).toBe(true));

        expect(session2.getSnapshot().notification).toContain('Session expired');
        expect(session2.hasPendingRecoveryTimer()).toBe(false);
        unmount2();

        // 3. Pending retry timer cancelled on gameEnd and unmount
        const session3 = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
            clock,
            onLeave,
        });
        session3.setHydrated(true);
        session3.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });
        let publicCalls3 = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls3 += 1;
                return HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 });
            })
        );

        const { unmount: unmount3 } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(session3),
        });

        await waitFor(() => expect(publicCalls3).toBe(1));
        await waitFor(() => expect(session3.hasPendingRecoveryTimer()).toBe(true));
        const callsBeforeEnd = publicCalls3;

        act(() => {
            session3.setGameEndResult(createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000 }],
                gameEnd: { winner: 'TestPlayer', isForfeit: false, message: 'Game over' },
            }));
        });

        expect(session3.hasPendingRecoveryTimer()).toBe(false);

        act(() => {
            clock.tick(10_000);
        });

        expect(publicCalls3).toBe(callsBeforeEnd);
        unmount3();
    });

    it('marks recoveryFailed after retry exhaustion and restarts a fresh recovery attempt when retryConnection is invoked', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        let publicCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                if (publicCalls <= 4) {
                    return HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 });
                }
                return HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'TURN',
                    pot: 500,
                    currentBet: 100,
                    communityCards: ['AH', 'KD', '2C', '7S'],
                    currentPlayerName: 'TestPlayer',
                    currentPlayerId: 'p-1',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 100, status: 'ACTIVE', hasFolded: false }],
                }));
            }),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({
                    playerId: 'p-1',
                    handNumber: 0,
                    holeCards: ['KH', 'KD'],
                } satisfies PrivatePlayerState)
            )
        );

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));

        // 3 automatic retries across bounded exponential backoff
        await advanceRecoveryRetries(clock, session, () => publicCalls);

        expect(publicCalls).toBe(4);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(session.getSnapshot().loadingStatus).toBe('Reconnecting / restoring table…');

        // Manual retry restarts the workflow and clears recoveryFailed on success
        act(() => {
            session.retryConnection();
        });

        await waitFor(() => expect(publicCalls).toBe(5));
        await waitFor(() => expect(session.getSnapshot().recoveryFailed).toBe(false));
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('TURN');
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['KH', 'KD'] });
    });

    it('treats a private-state 404 on a started game as a terminal SESSION_EXPIRED redirect rather than a successful recovery', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        server.use(
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'PRE_FLOP',
                    pot: 30,
                    currentBet: 20,
                    communityCards: [],
                    currentPlayerName: 'TestPlayer',
                    currentPlayerId: 'p-1',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
                }))
            ),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ detail: 'Not found' }, { status: 404 })
            )
        );

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(session.isRedirectingActive()).toBe(true));

        expect(session.getSnapshot().notification).toContain('Session expired');
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.hasPendingRecoveryTimer()).toBe(false);

        act(() => {
            clock.tick(3000);
        });
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a newer STOMP game state arriving in the same millisecond as an in-flight REST getGameState call', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        session.applyGameState(createValidGameState({
            gameId: 'ROOM123',
            handNumber: 0,
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
        }));

        const pendingRestGameState = deferred<Response>();
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return pendingRestGameState.promise;
            }),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({
                    playerId: 'p-1',
                    handNumber: 0,
                    holeCards: ['AS', 'KS'],
                } satisfies PrivatePlayerState)
            )
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(publicCalls).toBe(1));

        // Simulate a newer STOMP game frame arriving in the exact same TestClock millisecond
        act(() => {
            inMemoryTransport.simulateMessage(
                '/game/ROOM123',
                JSON.stringify(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'FLOP',
                    handNumber: 0,
                    pot: 120,
                    currentBet: 40,
                    communityCards: ['AH', 'KD', '2C'],
                    currentPlayerName: 'TestPlayer',
                    currentPlayerId: 'p-1',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 940, currentBet: 40, status: 'ACTIVE', hasFolded: false }],
                })),
            );
        });

        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
        expect(session.getSnapshot().gameState?.pot).toBe(120);

        // Now resolve the older in-flight REST snapshot in the same millisecond
        await act(async () => {
            pendingRestGameState.resolve(HttpResponse.json(createValidGameState({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                handNumber: 0,
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
            })));
        });

        await waitFor(() => expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'KS'] }));

        // The older REST snapshot must NOT overwrite the newer STOMP state
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
        expect(session.getSnapshot().gameState?.pot).toBe(120);
    });

    it('does not let a stale REST private snapshot overwrite newer WebSocket hole cards', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({ roomId: 'ROOM123', gameStarted: true });
        session.applyGameState(createValidGameState({
            gameId: 'ROOM123',
            handNumber: 0,
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
        }));

        const pendingPrivateState = deferred<Response>();
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    handNumber: 0,
                    players: [{ id: 'p-1', name: 'TestPlayer' }],
                }))
            ),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                return pendingPrivateState.promise;
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(privateCalls).toBe(1));
        const revisionBeforePrivateFrame = session.getPrivateSyncRevision();

        act(() => {
            inMemoryTransport.simulateMessage('/user/queue/private', {
                playerId: 'p-1',
                handNumber: 0,
                holeCards: ['AH', 'KH'],
            });
        });
        expect(session.getPrivateSyncRevision()).toBe(revisionBeforePrivateFrame + 1);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AH', 'KH'] });

        await act(async () => {
            pendingPrivateState.resolve(HttpResponse.json({
                playerId: 'p-1',
                handNumber: 0,
                holeCards: ['2C', '3C'],
            } satisfies PrivatePlayerState));
        });

        await waitFor(() => expect(session.getSnapshot().isRecovering).toBe(false));
        expect(session.getSnapshot().recoveryFailed).toBe(false);
        expect(session.hasPendingRecoveryTimer()).toBe(false);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AH', 'KH'] });
    });

    it('discards delayed REST private responses from an older hand when newer hand cards arrive via WebSocket during recovery', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({ roomId: 'ROOM123', gameStarted: true });
        session.applyGameState(createValidGameState({
            gameId: 'ROOM123',
            handNumber: 0,
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
        }));

        const pendingGameState = deferred<Response>();
        const pendingPrivateState = deferred<Response>();
        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return pendingGameState.promise;
            }),
            http.get('*/api/game/ROOM123/private-state', () => {
                privateCalls += 1;
                return pendingPrivateState.promise;
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(privateCalls).toBe(1));

        // While REST recovery is in flight, hand 1 begins and arrives via WebSocket
        act(() => {
            inMemoryTransport.simulateMessage('/game/ROOM123', createValidGameState({
                gameId: 'ROOM123',
                handNumber: 1,
                stateRevision: 1,
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
            }));
            inMemoryTransport.simulateMessage('/user/queue/private', {
                playerId: 'p-1',
                handNumber: 1,
                holeCards: ['TS', 'JS'],
            });
        });

        expect(session.getSnapshot().gameState?.handNumber).toBe(1);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['TS', 'JS'] });

        // Now delayed REST recovery from hand 0 resolves
        await act(async () => {
            pendingGameState.resolve(HttpResponse.json(createValidGameState({
                gameId: 'ROOM123',
                handNumber: 0,
                stateRevision: 1,
                players: [{ id: 'p-1', name: 'TestPlayer' }],
            })));
            pendingPrivateState.resolve(HttpResponse.json({
                playerId: 'p-1',
                handNumber: 0,
                holeCards: ['2C', '3C'],
            } satisfies PrivatePlayerState));
        });

        await waitFor(() => expect(session.getSnapshot().isRecovering).toBe(false));

        // The delayed hand 0 cards MUST NOT overwrite hand 1's cards
        expect(session.getSnapshot().gameState?.handNumber).toBe(1);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['TS', 'JS'] });
        expect(session.getSnapshot().recoveryFailed).toBe(false);
    });

    it('protects private state during hand transition and rejects delayed REST response with mismatched hand sequence', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({ roomId: 'ROOM123', gameStarted: true });
        session.applyGameState(createValidGameState({
            gameId: 'ROOM123',
            handNumber: 0,
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
        }));
        session.applyPrivateState({
            playerId: 'p-1',
            handNumber: 0,
            holeCards: ['AH', 'KH'],
        });

        const pendingGameState = deferred<Response>();
        const pendingPrivateState = deferred<Response>();
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                if (publicCalls === 1) {
                    return pendingGameState.promise;
                }
                return HttpResponse.json(createValidGameState({ gameId: 'ROOM123', handNumber: 1 }));
            }),
            http.get('*/api/game/ROOM123/private-state', () => pendingPrivateState.promise)
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(publicCalls).toBe(1));

        // Hand transitions to Hand 1 via WebSocket before private cards arrive
        act(() => {
            inMemoryTransport.simulateMessage('/game/ROOM123', createValidGameState({
                gameId: 'ROOM123',
                handNumber: 1,
                stateRevision: 1,
                phase: 'PRE_FLOP',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
            }));
        });

        // Private state is reset on hand transition
        expect(session.getSnapshot().gameState?.handNumber).toBe(1);
        expect(session.getSnapshot().privateState).toBeNull();

        // Delayed REST response for Hand 0 resolves
        await act(async () => {
            pendingGameState.resolve(HttpResponse.json(createValidGameState({
                gameId: 'ROOM123',
                handNumber: 0,
                stateRevision: 1,
                players: [{ id: 'p-1', name: 'TestPlayer' }],
            })));
            pendingPrivateState.resolve(HttpResponse.json({
                playerId: 'p-1',
                handNumber: 0,
                holeCards: ['2C', '3C'],
            } satisfies PrivatePlayerState));
        });

        // Stale Hand 0 private cards must NOT be applied to Hand 1
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));
        expect(session.getSnapshot().gameState?.handNumber).toBe(1);
        expect(session.getSnapshot().privateState).toBeNull();
    });

    it('does not let stale room recovery roll back an intervening room update frame', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            gameStarted: false,
        });

        const pendingRoomInfo = deferred<Response>();
        let roomCalls = 0;
        server.use(
            http.get('*/api/room/ROOM123', () => {
                roomCalls += 1;
                return pendingRoomInfo.promise;
            })
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        await waitFor(() => expect(roomCalls).toBe(1));

        act(() => {
            inMemoryTransport.simulateMessage('/room/ROOM123', createValidRoomData({
                roomId: 'ROOM123',
                players: [
                    { name: 'TestPlayer', isHost: true },
                    { name: 'Opponent', isHost: false },
                ],
            }));
        });
        expect(session.getSnapshot().roomState?.players).toHaveLength(2);

        await act(async () => {
            pendingRoomInfo.resolve(HttpResponse.json({
                ...createValidRoomData({
                    roomId: 'ROOM123',
                    players: [{ name: 'TestPlayer', isHost: true }],
                }),
            } satisfies RoomDataResponse));
        });

        await waitFor(() => {
            expect(session.getSnapshot().isRecovering).toBe(false);
            expect(session.getSnapshot().loadingStatus).toBe('Connected.');
        });
        expect(session.getSnapshot().roomState?.players).toHaveLength(2);
        expect(session.getSnapshot().roomState?.players?.[1].name).toBe('Opponent');
    });

    it('preserves the bounded retry budget while backoff timers are pending, then allows online/visibilitychange to start a fresh recovery after exhaustion', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true }],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: false,
            gameStarted: true,
        });

        let publicCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                if (publicCalls <= 4) {
                    return HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 });
                }
                return HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'RIVER',
                    pot: 600,
                    currentBet: 0,
                    communityCards: ['AH', 'KD', '2C', '7S', '9H'],
                    currentPlayerName: 'TestPlayer',
                    currentPlayerId: 'p-1',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 0, status: 'ACTIVE', hasFolded: false }],
                }));
            }),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({
                    playerId: 'p-1',
                    handNumber: 0,
                    holeCards: ['AS', 'KS'],
                } satisfies PrivatePlayerState)
            )
        );

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        // Initial attempt 1 fails and schedules retry #1
        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));

        // Fire passive online and visibilitychange events while each backoff timer is pending
        for (let step = 0; step < 3; step += 1) {
            expect(session.hasPendingRecoveryTimer()).toBe(true);
            const prevCalls = publicCalls;
            act(() => {
                window.dispatchEvent(new Event('online'));
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(publicCalls).toBe(prevCalls);

            act(() => {
                clock.tick(10_000);
            });
            await waitFor(() => expect(publicCalls).toBeGreaterThan(prevCalls));
            await waitFor(() => expect(session.hasPendingRecoveryTimer() || session.getSnapshot().recoveryFailed).toBe(true));
        }

        // Total calls remain bounded at 4 (1 initial + 3 retries) and transition to recoveryFailed
        expect(publicCalls).toBe(4);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);

        // Coming back online after retry exhaustion starts a fresh recovery workflow and restores the table
        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        await waitFor(() => expect(publicCalls).toBe(5));
        await waitFor(() => expect(session.getSnapshot().gameState?.phase).toBe('RIVER'));
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(false);
    });

    it('wakeup/online cannot restart recovery during redirect or successful leave; failed leave resumes it', () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({ roomId: 'ROOM123', gameStarted: true });
        const syncSpy = vi.spyOn(session, 'synchronizeSession').mockResolvedValue();

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        syncSpy.mockClear();

        act(() => {
            session.scheduleRedirect('Host left');
        });
        expect(session.hasLifecyclePermission()).toBe(false);

        act(() => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(syncSpy).not.toHaveBeenCalled();

        const session2 = new GameSession({
            auth: mockAuth,
            transport: inMemoryTransport,
            clock: new TestClock(1000),
            onLeave,
        });
        try {
            session2.setRoomState({ roomId: 'ROOM123', gameStarted: true });
            const syncSpy2 = vi.spyOn(session2, 'synchronizeSession').mockResolvedValue();

            renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
                wrapper: createWrapper(session2),
            });
            syncSpy2.mockClear();

            act(() => {
                session2.disconnect();
            });
            expect(session2.hasLifecyclePermission()).toBe(false);

            act(() => {
                window.dispatchEvent(new Event('online'));
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(syncSpy2).not.toHaveBeenCalled();
        } finally {
            session2.detach();
        }

        const session3 = new GameSession({
            auth: mockAuth,
            transport: inMemoryTransport,
            clock: new TestClock(1000),
            onLeave,
        });
        try {
            session3.setRoomState({ roomId: 'ROOM123', gameStarted: true });
            const syncSpy3 = vi.spyOn(session3, 'synchronizeSession').mockResolvedValue();

            session3.setPendingLeave(true);
            expect(session3.hasLifecyclePermission()).toBe(false);

            session3.setPendingLeave(false);
            expect(syncSpy3).toHaveBeenCalledWith({ resetBudget: true });
        } finally {
            session3.detach();
        }
    });
});
