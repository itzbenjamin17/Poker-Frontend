import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useGameDispatcher, type PublisherAdapter } from '../useGameDispatcher';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';
import { RAISE_ERROR_FORBIDDEN_BET } from '../../constants/strings';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

vi.mock('../../services/api', () => ({
    pokerApi: {
        startGame: vi.fn(),
        claimWin: vi.fn(),
        leaveGame: vi.fn(),
        leaveRoom: vi.fn(),
    },
}));

describe('useGameDispatcher', () => {
    const mockAuth = {
        token: 'test-token',
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
        message: 'Success',
    };
    const onLeave = vi.fn();
    const dispatch = vi.fn();
    const clearShowdownTimers = vi.fn();
    let publisherAdapter: PublisherAdapter;
    let publishMock: Mock<(destination: string, body: string) => void>;
    let isConnectedMock: Mock<() => boolean>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        publishMock = vi.fn<(destination: string, body: string) => void>();
        isConnectedMock = vi.fn<() => boolean>().mockReturnValue(true);
        publisherAdapter = {
            publish: publishMock,
            isConnected: isConnectedMock,
        };

        vi.mocked(useGameContext).mockReturnValue({
            auth: mockAuth,
            onLeave,
            dispatch,
            clearShowdownTimers,
            roomState: null,
            gameState: { gameId: 'GAME123' } as unknown as import('../../types').GameState,
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
            applyIncomingGameState: vi.fn(),
            applyIncomingPrivateState: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatch PLAY_ACTION publishes STOMP message', async () => {
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'RAISE', amount: 100 });
        });

        expect(publishMock).toHaveBeenCalledWith(
            '/app/GAME123/action',
            JSON.stringify({ action: 'RAISE', amount: 100 })
        );
        expect(result.current.isPending('PLAY_ACTION')).toBe(true);
    });

    it('blocks duplicate rapid calls until timeout', async () => {
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
        });

        expect(publishMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
        });

        expect(publishMock).toHaveBeenCalledTimes(2);
    });

    it('defers and sets notification when client is not connected', async () => {
        isConnectedMock.mockReturnValue(false);
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'RAISE', amount: 100 });
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'Waiting for connection...',
        });
    });

    it('dispatch READY publishes STOMP message', async () => {
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'READY' });
        });

        expect(publishMock).toHaveBeenCalledWith(
            '/app/GAME123/ready',
            '{}'
        );
    });

    it('dispatch START_GAME calls pokerApi', async () => {
        const startGameSpy = vi.mocked(pokerApi.startGame).mockResolvedValue({});
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(startGameSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
    });

    it('dispatch START_GAME handles error', async () => {
        vi.mocked(pokerApi.startGame).mockRejectedValue(new Error('Start failed'));
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'Start failed',
        });
    });

    it('dispatch CLAIM_WIN calls pokerApi', async () => {
        const claimWinSpy = vi.mocked(pokerApi.claimWin).mockResolvedValue(true);
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_CLAIM_PENDING',
            payload: true,
        });
        expect(claimWinSpy).toHaveBeenCalledWith('GAME123', 'test-token');
    });

    it('dispatch LEAVE_GAME calls leaveGame and leaveRoom', async () => {
        const leaveGameSpy = vi.mocked(pokerApi.leaveGame).mockResolvedValue();
        const leaveRoomSpy = vi.mocked(pokerApi.leaveRoom).mockResolvedValue();

        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(clearShowdownTimers).toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_PRIVATE',
            payload: null,
        });
        expect(leaveGameSpy).toHaveBeenCalledWith('GAME123', 'test-token');
        expect(leaveRoomSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
        expect(onLeave).toHaveBeenCalled();
    });

    it('dispatch LEAVE_REVIEW calls onLeave even if REST fails', async () => {
        vi.mocked(pokerApi.leaveGame).mockRejectedValue(new Error('404 Not Found'));
        vi.mocked(pokerApi.leaveRoom).mockRejectedValue(new Error('404 Not Found'));

        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_REVIEW' });
        });

        expect(clearShowdownTimers).toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_GAME_STATE' });
        expect(onLeave).toHaveBeenCalled();
        // No notification on LEAVE_REVIEW failure
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_NOTIFICATION', payload: expect.any(String) });
    });

    it('dispatch LEAVE_GAME calls onLeave even on 404 error', async () => {
        const error = new Error('Not Found') as any;
        error.status = 404;
        vi.mocked(pokerApi.leaveGame).mockRejectedValue(error);

        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(onLeave).toHaveBeenCalled();
        // Should NOT have called setNotification via the outer catch because we handled 404
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_NOTIFICATION', payload: expect.any(String) });
    });

    it('onSocketError parses errors and updates error state', async () => {
        const { result } = renderHook(() => useGameDispatcher(publisherAdapter));

        act(() => {
            result.current.onSocketError('INSUFFICIENT_CHIPS');
        });

        expect(result.current.error?.message).toBe('INSUFFICIENT_CHIPS');
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: RAISE_ERROR_FORBIDDEN_BET,
        });

        act(() => {
            result.current.onSocketError('SOME_OTHER_ERROR');
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'SOME_OTHER_ERROR',
        });
    });
});
