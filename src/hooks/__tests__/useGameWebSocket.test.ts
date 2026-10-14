import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameWebSocket } from '../useGameWebSocket';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { pokerApi } from '../../services/api';
import { StompTransportAdapter, InMemoryTransportAdapter } from '../../services/transport';
import { MockStompClient, activeSubscriptions } from '../../test/mocks/stomp';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';
import { HOST_LEFT } from '../../constants/strings';

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/api')>();
    return {
        ...actual,
        pokerApi: {
            getRoomInfo: vi.fn(),
            getGameState: vi.fn(),
            getPrivateState: vi.fn(),
            leaveRoom: vi.fn(),
            leaveGame: vi.fn(),
        },
    };
});

describe('useGameWebSocket', () => {
    const token = createMockJwt();
    const mockAuth = {
        token,
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
        message: 'Success',
    };
    const onLeave = vi.fn();
    const onSocketError = vi.fn();
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
        vi.useFakeTimers();

        vi.mocked(pokerApi.getRoomInfo).mockResolvedValue(createValidRoomData());
        vi.mocked(pokerApi.getGameState).mockResolvedValue(createValidGameState());
        vi.mocked(pokerApi.getPrivateState).mockResolvedValue({});

        session = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
            onLeave,
        });
        session.setHydrated(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('subscribes to channels on connection', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        expect(result.current).toBeDefined();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
        expect(activeSubscriptions.has('/room/ROOM123')).toBe(true);
        expect(activeSubscriptions.has('/game/ROOM123')).toBe(true);
    });

    it('handles ROOM_CLOSED updates by updating session state and scheduling redirect', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', {
                message: 'ROOM_CLOSED',
            });
        });

        expect(session.getSnapshot().notification).toBe(HOST_LEFT);
        expect(session.getSnapshot().loadingStatus).toBe(HOST_LEFT);
        expect(session.getSnapshot().roomState).toBeNull();

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('handles incoming private state and action errors', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

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

        const privatePayload = {
            playerId: 'p-1',
            holeCards: ['AS', 'KS'],
        };
        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', privatePayload);
        });
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'KS'] });
        expect(session.getSnapshot().myPlayerId).toBe('p-1');
    });

    it('resubscribes to private channel after STOMP reconnect', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        // initial connection should subscribe
        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);

        // simulate disconnect
        act(() => {
            activeSubscriptions.clear();
            const client = result.current.stompClientRef.current;
            if (client && client.onWebSocketClose) {
                client.onWebSocketClose(new CloseEvent('close'));
            }
        });

        expect(activeSubscriptions.has('/user/queue/private')).toBe(false);

        // simulate reconnect
        act(() => {
            const client = result.current.stompClientRef.current;
            if (client && client.onConnect) {
                // @ts-expect-error MockStompClient expects 0 args but typing in tests might require frame
                client.onConnect({});
            }
        });

        // Should be resubscribed to private channel without the old let flag blocking it
        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
    });

    it('updates gameEndResult with snapshot on GAME_END frame', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        const gameEndPayload = {
            type: 'GAME_END',
            winner: 'Player1',
            winnerChips: 500,
            isForfeit: false,
            message: 'Player1 wins!',
            finalState: createValidGameState({
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1000,
                currentPlayerName: '',
                currentPlayerId: '',
                players: [createValidGameState().players[0]],
                communityCards: ['AS', 'KS', 'QS', 'JS', 'TS'],
            }),
        };

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', gameEndPayload);
        });

        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult).toEqual({
            winnerName: 'Player1',
            winnerChips: 500,
            isForfeit: false,
            message: 'Player1 wins!',
            finalState: expect.objectContaining({ phase: 'SHOWDOWN' }),
        });
    });

    it('ignores subsequent game updates after game end', async () => {
        session.setGameEndResult({ winnerName: 'Player1', isForfeit: false, message: 'Done' });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                phase: 'PRE_FLOP',
                pot: 0,
                players: [],
                communityCards: [],
            });
        });

        expect(session.getSnapshot().gameState).toBeNull();
    });

    it('does not schedule redirect on 403 after game end', async () => {
        session.setGameEndResult({ winnerName: 'Player1', isForfeit: false, message: 'Done' });

        // Mock pokerApi.getGameState to reject with 403
        vi.mocked(pokerApi.getGameState).mockRejectedValue({ status: 403 });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        // Advance timers to trigger onConnect
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        // getGameState should not be called because gameEndedRef is true
        expect(pokerApi.getGameState).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('ignores ROOM_CLOSED after game end', async () => {
        session.setGameEndResult({ winnerName: 'Player1', isForfeit: false, message: 'Done' });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', {
                message: 'ROOM_CLOSED',
            });
        });

        expect(session.getSnapshot().roomState).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('does not fetch game state or private state on connect when room has not started', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'LobbyRoom',
            players: [],
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
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        expect(pokerApi.getGameState).not.toHaveBeenCalled();
        expect(pokerApi.getPrivateState).not.toHaveBeenCalled();
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

        vi.mocked(pokerApi.getRoomInfo).mockResolvedValue({
            roomId: 'ROOM123',
            roomName: 'LobbyRoom',
            players: [
                { name: 'TestPlayer', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                { name: 'NewOpponent', isHost: false, joinedAt: '2026-01-01T00:00:05Z' },
            ],
            currentPlayers: 2,
            hostName: 'TestPlayer',
            createdAt: '2026-01-01T00:00:00Z',
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: true,
            gameStarted: false,
        });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        expect(pokerApi.getRoomInfo).toHaveBeenCalledWith('ROOM123', token);
        expect(session.getSnapshot().roomState?.players).toHaveLength(2);
        expect(session.getSnapshot().roomState?.canStartGame).toBe(true);
    });

    it('fetches game state and private state on connect when game has started', async () => {
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [],
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
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        expect(pokerApi.getGameState).toHaveBeenCalledWith('ROOM123', token);
        expect(pokerApi.getPrivateState).toHaveBeenCalledWith('ROOM123', token);
    });

    it('handles STOMP error frame by updating ws status and calling onSocketError', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

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
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        // Simulate game end while connected
        act(() => {
            session.setGameEndResult({ winnerName: 'Player1', isForfeit: false, message: 'Done' });
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
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

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
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

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

        // Test packet injection
        act(() => {
            inMemoryTransport.simulateMessage('/room/ROOM123', JSON.stringify({
                message: 'ROOM_CLOSED',
            }));
        });

        expect(session.getSnapshot().roomState).toBeNull();

        // Test error injection
        act(() => {
            inMemoryTransport.simulateError('In-memory simulated error');
        });

        expect(onSocketError).toHaveBeenCalledWith('In-memory simulated error');
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
        const validPrivateState = {
            playerId: 'p-1',
            holeCards: ['AS', 'AD'],
        };

        // Attempt 1: getGameState fails with 503
        // Attempt 2: getGameState succeeds, getPrivateState fails with 502
        // Attempt 3: both succeed
        vi.mocked(pokerApi.getGameState)
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue(validGameState as never);

        vi.mocked(pokerApi.getPrivateState)
            .mockResolvedValueOnce(validPrivateState as never)
            .mockRejectedValueOnce({ status: 502 })
            .mockResolvedValue(validPrivateState as never);

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        // Connect triggers attempt 1 (fails getGameState 503)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().isRecovering).toBe(true);
        expect(session.getSnapshot().loadingStatus).toBe('Reconnecting / restoring table…');

        // Advance past backoff 1 (~1000ms + jitter) -> attempt 2 (getGameState succeeds, getPrivateState fails 502)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(2);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(2);
        expect(session.getSnapshot().isRecovering).toBe(true);

        // Advance past backoff 2 (~2000ms + jitter) -> attempt 3 (both succeed)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(3);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(3);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'AD'] });
    });

    it('runs state recovery on visibilitychange (visible) and online even when transport.isConnected() is true without tearing down the socket', async () => {
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

        await act(async () => {
            await Promise.resolve();
        });

        expect(inMemoryTransport.isConnected()).toBe(true);
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(1);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(1);

        const connectSpy = vi.spyOn(inMemoryTransport, 'connect');
        const disconnectSpy = vi.spyOn(inMemoryTransport, 'disconnect');

        // Trigger visibilitychange -> visible while connected
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });

        expect(connectSpy).not.toHaveBeenCalled();
        expect(disconnectSpy).not.toHaveBeenCalled();
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(2);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(2);

        // Trigger online while connected
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();
        });

        expect(connectSpy).not.toHaveBeenCalled();
        expect(disconnectSpy).not.toHaveBeenCalled();
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(3);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(3);
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

        let resolveGameState!: (val: unknown) => void;
        vi.mocked(pokerApi.getGameState).mockImplementation(
            () => new Promise((resolve) => { resolveGameState = resolve; }) as never
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        // Initial connect started 1 recovery transaction which is still in flight; initial attempt-0 sync is silent (isRecovering: false)
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(1);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().isRecovering).toBe(false);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });

        // Fire online, visibilitychange, and another connected status while the first is in flight
        act(() => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
            inMemoryTransport.connect();
        });

        expect(pokerApi.getGameState).toHaveBeenCalledTimes(1);
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveGameState(createValidGameState({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
            }));
            await Promise.resolve();
        });

        expect(session.getSnapshot().isRecovering).toBe(false);
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
        vi.mocked(pokerApi.getGameState).mockRejectedValueOnce({ status: 403 });

        const { unmount } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });

        expect(session.getSnapshot().notification).toContain('Your seat is no longer active');
        expect(session.hasPendingRecoveryTimer()).toBe(false);
        unmount();

        // 2. 404 on getGameState when gameStarted is true -> SESSION_EXPIRED
        const session2 = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
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
        vi.mocked(pokerApi.getGameState).mockRejectedValueOnce({ status: 404 });

        const { unmount: unmount2 } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(session2),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });

        expect(session2.getSnapshot().notification).toContain('Session expired');
        expect(session2.hasPendingRecoveryTimer()).toBe(false);
        unmount2();

        // 3. Pending retry timer cancelled on gameEnd and unmount
        const session3 = new GameSession({
            auth: mockAuth,
            transport: new StompTransportAdapter(mockAuth.token),
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
        vi.mocked(pokerApi.getGameState).mockRejectedValue({ status: 503 });

        const { unmount: unmount3 } = renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(session3),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });

        expect(session3.hasPendingRecoveryTimer()).toBe(true);
        const callsBeforeEnd = vi.mocked(pokerApi.getGameState).mock.calls.length;

        act(() => {
            session3.setGameEndResult({ winnerName: 'TestPlayer', isForfeit: false, message: 'Game over' });
        });

        expect(session3.hasPendingRecoveryTimer()).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10000);
        });

        expect(vi.mocked(pokerApi.getGameState).mock.calls.length).toBe(callsBeforeEnd);
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

        // Initial attempt + 3 retries = 4 failures -> exhausts automatic retries
        vi.mocked(pokerApi.getGameState)
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue(createValidGameState({
                gameId: 'ROOM123',
                phase: 'TURN',
                pot: 500,
                currentBet: 100,
                communityCards: ['AH', 'KD', '2C', '7S'],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 100, status: 'ACTIVE', hasFolded: false }],
            }));
        vi.mocked(pokerApi.getPrivateState).mockResolvedValue({
            playerId: 'p-1',
            holeCards: ['KH', 'KD'],
        } as never);

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        // Attempt 1 + 3 retries across bounded exponential backoff
        for (let i = 0; i < 4; i++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(9000);
            });
        }

        expect(pokerApi.getGameState).toHaveBeenCalledTimes(4);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(session.getSnapshot().loadingStatus).toBe('Reconnecting / restoring table…');

        // Manual retry restarts the workflow and clears recoveryFailed on success
        await act(async () => {
            session.retryConnection();
            await Promise.resolve();
        });

        expect(pokerApi.getGameState).toHaveBeenCalledTimes(5);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(false);
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

        vi.mocked(pokerApi.getGameState).mockResolvedValueOnce(createValidGameState({
            gameId: 'ROOM123',
            phase: 'PRE_FLOP',
            pot: 30,
            currentBet: 20,
            communityCards: [],
            currentPlayerName: 'TestPlayer',
            currentPlayerId: 'p-1',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
        }));
        vi.mocked(pokerApi.getPrivateState).mockRejectedValueOnce({ status: 404 });

        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });

        expect(session.getSnapshot().notification).toContain('Session expired');
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.hasPendingRecoveryTimer()).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
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

        let resolveRestGameState!: (val: unknown) => void;
        vi.mocked(pokerApi.getGameState).mockImplementationOnce(
            () => new Promise((resolve) => { resolveRestGameState = resolve; }) as never
        );
        vi.mocked(pokerApi.getPrivateState).mockResolvedValueOnce({
            playerId: 'p-1',
            holeCards: ['AS', 'KS'],
        } as never);

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        // REST request is now in flight at time T (0ms elapsed).
        // Simulate a newer STOMP game frame arriving in the exact same millisecond (0ms elapsed).
        act(() => {
            inMemoryTransport.simulateMessage(
                '/game/ROOM123',
                JSON.stringify(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'FLOP',
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
            resolveRestGameState(createValidGameState({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', hasFolded: false }],
            }));
            await Promise.resolve();
        });

        // The older REST snapshot must NOT overwrite the newer STOMP state
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
        expect(session.getSnapshot().gameState?.pot).toBe(120);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'KS'] });
    });

    it('does not let a stale REST private snapshot overwrite newer WebSocket hole cards', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({ roomId: 'ROOM123', gameStarted: true });
        let resolvePrivateState!: (value: { playerId: string; holeCards: string[] }) => void;
        vi.mocked(pokerApi.getGameState).mockResolvedValue(createValidGameState({ gameId: 'ROOM123' }));
        vi.mocked(pokerApi.getPrivateState).mockImplementationOnce(
            () => new Promise((resolve) => { resolvePrivateState = resolve; }) as never,
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        expect(pokerApi.getPrivateState).toHaveBeenCalledTimes(1);
        const revisionBeforePrivateFrame = session.getPrivateSyncRevision();

        act(() => {
            inMemoryTransport.simulateMessage('/user/queue/private', {
                playerId: 'p-1',
                holeCards: ['AH', 'KH'],
            });
        });
        expect(session.getPrivateSyncRevision()).toBe(revisionBeforePrivateFrame + 1);
        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AH', 'KH'] });

        await act(async () => {
            resolvePrivateState({ playerId: 'p-1', holeCards: ['2C', '3C'] });
            await Promise.resolve();
        });

        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AH', 'KH'] });
    });

    it('does not let stale room recovery roll back an intervening PLAYER_JOINED frame', async () => {
        const inMemoryTransport = new InMemoryTransportAdapter();
        session.setRoomState({
            roomId: 'ROOM123',
            roomName: 'ActiveRoom',
            players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-01-01T00:00:00Z' }],
            gameStarted: false,
        });
        let resolveRoomInfo!: (value: ReturnType<typeof createValidRoomData>) => void;
        vi.mocked(pokerApi.getRoomInfo).mockImplementationOnce(
            () => new Promise((resolve) => { resolveRoomInfo = resolve; }),
        );

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });
        expect(pokerApi.getRoomInfo).toHaveBeenCalledTimes(1);

        act(() => {
            inMemoryTransport.simulateMessage('/room/ROOM123', {
                message: 'PLAYER_JOINED',
                data: {
                    roomId: 'ROOM123',
                    players: [
                        { name: 'TestPlayer', isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
                        { name: 'Opponent', isHost: false, joinedAt: '2026-01-01T00:00:01Z' },
                    ],
                },
            });
        });
        expect(session.getSnapshot().roomState?.players).toHaveLength(2);

        await act(async () => {
            resolveRoomInfo(createValidRoomData({
                roomId: 'ROOM123',
                players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-01-01T00:00:00Z' }],
            }));
            await Promise.resolve();
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

        vi.mocked(pokerApi.getGameState)
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue(createValidGameState({
                gameId: 'ROOM123',
                phase: 'RIVER',
                pot: 600,
                currentBet: 0,
                communityCards: ['AH', 'KD', '2C', '7S', '9H'],
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 0, status: 'ACTIVE', hasFolded: false }],
            }));
        vi.mocked(pokerApi.getPrivateState).mockResolvedValue({
            playerId: 'p-1',
            holeCards: ['AS', 'KS'],
        } as never);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });

        renderHook(() => useGameWebSocket({ onSocketError, transport: inMemoryTransport }), {
            wrapper: createWrapper(),
        });

        // Initial attempt 1 fails and schedules retry #1
        await act(async () => {
            await Promise.resolve();
        });
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(1);
        expect(session.hasPendingRecoveryTimer()).toBe(true);

        // Fire passive online and visibilitychange events while each backoff timer is pending
        for (let step = 0; step < 3; step++) {
            expect(session.hasPendingRecoveryTimer()).toBe(true);
            await act(async () => {
                window.dispatchEvent(new Event('online'));
                document.dispatchEvent(new Event('visibilitychange'));
                await Promise.resolve();
            });

            await act(async () => {
                await vi.runOnlyPendingTimersAsync();
            });
        }

        // Total calls remain bounded at 4 (1 initial + 3 retries) and transition to recoveryFailed
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(4);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);

        // Coming back online after retry exhaustion starts a fresh recovery workflow and restores the table
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();
        });
        expect(pokerApi.getGameState).toHaveBeenCalledTimes(5);
        expect(session.getSnapshot().isRecovering).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('RIVER');
    });
});


