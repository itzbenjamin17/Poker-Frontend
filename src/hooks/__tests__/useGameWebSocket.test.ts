import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameWebSocket } from '../useGameWebSocket';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';
import { MockStompClient, activeSubscriptions } from '../../test/mocks/stomp';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

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
    const dispatch = vi.fn();
    const applyIncomingGameState = vi.fn();
    const applyIncomingPrivateState = vi.fn();
    const clearShowdownTimers = vi.fn();
    const onSocketError = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
        vi.useFakeTimers();

        vi.mocked(pokerApi.getGameState).mockResolvedValue({});
        vi.mocked(pokerApi.getPrivateState).mockResolvedValue({});

        vi.mocked(useGameContext).mockReturnValue({
            auth: mockAuth,
            onLeave,
            dispatch,
            applyIncomingGameState,
            applyIncomingPrivateState,
            clearShowdownTimers,
            roomState: null,
            gameState: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            notification: null,
            loadingStatus: 'Connected',
            myPlayerId: 'p-1',
            claimPending: false,
            wsStatus: 'connected',
            isHydrated: true,
            isGameOver: false,
            gameEndResult: null,
            scheduleShowdownHide: vi.fn(),
            latestGameStateRef: { current: null },
            notificationTimerRef: { current: null },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('subscribes to channels on connection', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onSocketError }));

        expect(result.current).toBeDefined();

        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
        expect(activeSubscriptions.has('/room/ROOM123')).toBe(true);
    });

    it('handles ROOM_CLOSED updates by dispatching actions and scheduling redirect', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }));

        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', {
                message: 'ROOM_CLOSED',
            });
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: expect.any(String),
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_LOADING_STATUS',
            payload: expect.any(String),
        });

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('handles incoming private state and action errors', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }));

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

        const privatePayload = {
            playerId: 'p-1',
            holeCards: ['AS', 'KS'],
        };
        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', privatePayload);
        });
        expect(applyIncomingPrivateState).toHaveBeenCalledWith(privatePayload);
    });

    it('resubscribes to private channel after STOMP reconnect', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onSocketError }));

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

    it('dispatches SET_GAME_END_RESULT with snapshot on GAME_END frame', async () => {
        renderHook(() => useGameWebSocket({ onSocketError }));
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
            }
        };

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', gameEndPayload);
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_GAME_END_RESULT',
            payload: {
                winnerName: 'Player1',
                winnerChips: 500,
                isForfeit: false,
                message: 'Player1 wins!',
                finalState: expect.objectContaining({ phase: 'SHOWDOWN' }),
            }
        });
    });

    it('ignores subsequent game updates after game end', async () => {
        vi.mocked(useGameContext).mockReturnValue({
            ...vi.mocked(useGameContext)(),
            gameEndResult: { winnerName: 'Player1', isForfeit: false, message: 'Done' }
        } as any);

        renderHook(() => useGameWebSocket({ onSocketError }));
        await act(async () => { vi.advanceTimersByTime(10); });

        act(() => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                phase: 'PRE_FLOP',
                pot: 0,
                players: [],
                communityCards: []
            });
        });

        expect(applyIncomingGameState).not.toHaveBeenCalled();
    });

    it('does not schedule redirect on 403 after game end', async () => {
        vi.mocked(useGameContext).mockReturnValue({
            ...vi.mocked(useGameContext)(),
            gameEndResult: { winnerName: 'Player1', isForfeit: false, message: 'Done' }
        } as any);

        // Mock pokerApi.getGameState to reject with 403
        vi.mocked(pokerApi.getGameState).mockRejectedValue({ status: 403 });

        renderHook(() => useGameWebSocket({ onSocketError }));

        // Advance timers to trigger onConnect
        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        // getGameState should not be called because gameEndedRef is true
        expect(pokerApi.getGameState).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('ignores ROOM_CLOSED after game end', async () => {
        vi.mocked(useGameContext).mockReturnValue({
            ...vi.mocked(useGameContext)(),
            gameEndResult: { winnerName: 'Player1', isForfeit: false, message: 'Done' }
        } as any);

        renderHook(() => useGameWebSocket({ onSocketError }));
        await act(async () => { vi.advanceTimersByTime(10); });

        act(() => {
            MockStompClient.simulateMessage('/room/ROOM123', {
                message: 'ROOM_CLOSED',
            });
        });

        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_ROOM', payload: null });
        expect(onLeave).not.toHaveBeenCalled();
    });
});
