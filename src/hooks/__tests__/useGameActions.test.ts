/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameActions } from '../useGameActions';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';
import {
    STATUS_WAITING_CONNECTION,
    RAISE_ERROR_FORBIDDEN_BET,
} from '../../constants/strings';

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

describe('useGameActions', () => {
    const mockAuth = {
        token: 'test-token',
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
        message: 'Success',
    };
    const onLeave = vi.fn();
    const dispatch = vi.fn();
    const clearShowdownTimers = vi.fn();

    const setRaiseAmount = vi.fn();
    const setRaiseError = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        vi.mocked(useGameContext).mockReturnValue({
            auth: mockAuth,
            onLeave,
            dispatch,
            clearShowdownTimers,
            roomState: null,
            gameState: { gameId: 'GAME123' } as any,
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
            applyIncomingGameState: vi.fn(),
            applyIncomingPrivateState: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('handleAction publishes STOMP message when client is connected', () => {
        const publishMock = vi.fn();
        const stompClientRef = {
            current: {
                connected: true,
                publish: publishMock,
            } as any,
        };

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        act(() => {
            result.current.handleAction('RAISE', 100);
        });

        expect(publishMock).toHaveBeenCalledWith({
            destination: '/app/GAME123/action',
            body: JSON.stringify({ action: 'RAISE', amount: 100 }),
        });
        expect(setRaiseAmount).toHaveBeenCalledWith('');
        expect(setRaiseError).toHaveBeenCalledWith(null);
    });

    it('handleAction blocks duplicate rapid calls until reset or timed out', () => {
        const publishMock = vi.fn();
        const stompClientRef = {
            current: {
                connected: true,
                publish: publishMock,
            } as any,
        };

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        act(() => {
            result.current.handleAction('CHECK');
            result.current.handleAction('CHECK');
        });

        expect(publishMock).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        act(() => {
            result.current.handleAction('CHECK');
        });

        expect(publishMock).toHaveBeenCalledTimes(2);
    });

    it('handleAction defers and sets notification when client is not connected', () => {
        const stompClientRef = {
            current: {
                connected: false,
                publish: vi.fn(),
            } as any,
        };

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        act(() => {
            result.current.handleAction('RAISE', 100);
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: STATUS_WAITING_CONNECTION,
        });
    });

    it('handleReady publishes STOMP message when connected', () => {
        const publishMock = vi.fn();
        const stompClientRef = {
            current: {
                connected: true,
                publish: publishMock,
            } as any,
        };

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        act(() => {
            result.current.handleReady();
        });

        expect(publishMock).toHaveBeenCalledWith({
            destination: '/app/GAME123/ready',
            body: '{}',
        });
    });

    it('handleStartGame calls pokerApi successfully', async () => {
        const stompClientRef = { current: null };
        const startGameSpy = vi.mocked(pokerApi.startGame).mockResolvedValue({} as any);

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        await act(async () => {
            await result.current.handleStartGame();
        });

        expect(startGameSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
    });

    it('handleStartGame dispatches notification on error', async () => {
        const stompClientRef = { current: null };
        vi.mocked(pokerApi.startGame).mockRejectedValue(new Error('Start failed'));

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        await act(async () => {
            await result.current.handleStartGame();
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'Start failed',
        });
    });

    it('handleClaimWin calls pokerApi successfully', async () => {
        const stompClientRef = { current: null };
        const claimWinSpy = vi.mocked(pokerApi.claimWin).mockResolvedValue({} as any);

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        await act(async () => {
            await result.current.handleClaimWin();
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_CLAIM_PENDING',
            payload: true,
        });
        expect(claimWinSpy).toHaveBeenCalledWith('GAME123', 'test-token');
    });

    it('handleLeaveGame calls leaveGame and leaveRoom then onLeave', async () => {
        const stompClientRef = { current: null };
        const leaveGameSpy = vi.mocked(pokerApi.leaveGame).mockResolvedValue({} as any);
        const leaveRoomSpy = vi.mocked(pokerApi.leaveRoom).mockResolvedValue({} as any);

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        await act(async () => {
            await result.current.handleLeaveGame();
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

    it('handleRaiseError handles bet/raise patterns vs normal errors', () => {
        const stompClientRef = { current: null };

        const { result } = renderHook(() =>
            useGameActions(stompClientRef, setRaiseAmount, setRaiseError)
        );

        act(() => {
            result.current.handleRaiseError('INSUFFICIENT_CHIPS');
        });

        expect(setRaiseError).toHaveBeenCalledWith('INSUFFICIENT_CHIPS');
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: RAISE_ERROR_FORBIDDEN_BET,
        });

        act(() => {
            result.current.handleRaiseError('SOME_OTHER_ERROR');
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'SOME_OTHER_ERROR',
        });
    });
});
