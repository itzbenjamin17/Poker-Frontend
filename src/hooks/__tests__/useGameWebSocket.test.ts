import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameWebSocket } from '../useGameWebSocket';
import { useGameContext } from '../../context/GameContext';
import { MockStompClient, activeSubscriptions } from '../../test/mocks/stomp';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

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
    const onRaiseError = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
        vi.useFakeTimers();

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
            scheduleShowdownHide: vi.fn(),
            latestGameStateRef: { current: null },
            notificationTimerRef: { current: null },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('subscribes to channels on connection', async () => {
        const { result } = renderHook(() => useGameWebSocket({ onRaiseError }));

        expect(result.current).toBeDefined();

        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        expect(activeSubscriptions.has('/user/queue/private')).toBe(true);
        expect(activeSubscriptions.has('/room/ROOM123')).toBe(true);
    });

    it('handles ROOM_CLOSED updates by dispatching actions and scheduling redirect', async () => {
        renderHook(() => useGameWebSocket({ onRaiseError }));

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
        renderHook(() => useGameWebSocket({ onRaiseError }));

        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        act(() => {
            MockStompClient.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR',
                message: 'Invalid Raise Amount',
            });
        });
        expect(onRaiseError).toHaveBeenCalledWith('Invalid Raise Amount');

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
        const { result } = renderHook(() => useGameWebSocket({ onRaiseError }));

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
});
