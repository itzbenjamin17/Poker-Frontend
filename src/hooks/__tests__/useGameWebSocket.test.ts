import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameWebSocket } from '../useGameWebSocket';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { pokerApi } from '../../services/api';
import { StompTransportAdapter, InMemoryTransportAdapter } from '../../services/transport';
import { MockStompClient, activeSubscriptions } from '../../test/mocks/stomp';
import { HOST_LEFT } from '../../constants/strings';

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/api')>();
    return {
        ...actual,
        pokerApi: {
            getGameState: vi.fn(),
            getPrivateState: vi.fn(),
            leaveRoom: vi.fn(),
            leaveGame: vi.fn(),
        },
    };
});

describe('useGameWebSocket', () => {
    const mockAuth = {
        token: 'test-token',
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

        vi.mocked(pokerApi.getGameState).mockResolvedValue({});
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
            vi.advanceTimersByTime(10);
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
            vi.advanceTimersByTime(10);
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
            vi.advanceTimersByTime(10);
        });

        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR',
                message: 'Invalid Raise Amount',
            });
        });
        expect(onSocketError).toHaveBeenCalledWith('Invalid Raise Amount');
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
            vi.advanceTimersByTime(10);
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
        await act(async () => { vi.advanceTimersByTime(10); });

        const gameEndPayload = {
            type: 'GAME_END',
            winner: 'Player1',
            winnerChips: 500,
            isForfeit: false,
            message: 'Player1 wins!',
            finalState: {
                phase: 'SHOWDOWN',
                pot: 1000,
                players: [{ id: 'p-1', name: 'Player1', chips: 500 }],
                communityCards: ['AS', 'KS', 'QS', 'JS', 'TS'],
            },
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
        await act(async () => { vi.advanceTimersByTime(10); });

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
            vi.advanceTimersByTime(10);
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
        await act(async () => { vi.advanceTimersByTime(10); });

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
        await act(async () => { vi.advanceTimersByTime(10); });

        expect(pokerApi.getGameState).not.toHaveBeenCalled();
        expect(pokerApi.getPrivateState).not.toHaveBeenCalled();
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
        await act(async () => { vi.advanceTimersByTime(10); });

        expect(pokerApi.getGameState).toHaveBeenCalledWith('ROOM123', 'test-token');
        expect(pokerApi.getPrivateState).toHaveBeenCalledWith('ROOM123', 'test-token');
    });

    it('handles STOMP error frame by updating ws status and calling onSocketError', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }), {
            wrapper: createWrapper(),
        });
        await act(async () => { vi.advanceTimersByTime(10); });

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
        await act(async () => { vi.advanceTimersByTime(10); });

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
        await act(async () => { vi.advanceTimersByTime(10); });

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
        await act(async () => { vi.advanceTimersByTime(10); });

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
});

