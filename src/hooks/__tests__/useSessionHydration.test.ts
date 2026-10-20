import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionHydration } from '../useSessionHydration';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';
import { SESSION_EXPIRED, SESSION_SEAT_GONE } from '../../constants/strings';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

describe('useSessionHydration', () => {
    const mockAuth = {
        token: createMockJwt(),
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
        message: 'Success',
    };
    const onLeave = vi.fn();
    const dispatch = vi.fn();
    const applyIncomingGameState = vi.fn();
    const applyIncomingPrivateState = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        vi.mocked(useGameContext).mockReturnValue({
            auth: mockAuth,
            onLeave,
            dispatch,
            applyIncomingGameState,
            applyIncomingPrivateState,
            roomState: null,
            gameState: null,
            privateState: null,
            showdown: null,
            showdownResult: null,
            notification: null,
            loadingStatus: 'Connecting...',
            myPlayerId: 'p-1',
            claimPending: false,
            wsStatus: 'connected',
            isHydrated: true,
            isGameOver: false,
            gameEndResult: null,
            clearShowdownTimers: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hydrates room and transitions loading state successfully when game is not started', async () => {
        const getRoomInfoSpy = vi.spyOn(pokerApi, 'getRoomInfo').mockResolvedValue({
            ...createValidRoomData(),
            roomId: 'ROOM123',
            roomName: 'Table 1',
            players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
            canStartGame: true,
            gameStarted: false,
        });

        renderHook(() => useSessionHydration());

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getRoomInfoSpy).toHaveBeenCalledWith('ROOM123', mockAuth.token);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_ROOM',
            payload: expect.objectContaining({
                roomId: 'ROOM123',
                roomName: 'Table 1',
                gameStarted: false,
            }),
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_LOADING_STATUS',
            payload: 'Connected.',
        });
    });

    it('handles 403 / 404 hydration errors and redirects to lobby', async () => {
        const getRoomInfoSpy = vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({
            status: 403,
            message: 'Session Expired',
        });

        renderHook(() => useSessionHydration());

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getRoomInfoSpy).toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: expect.any(String),
        });

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('bounds retries to 1 initial plus 3 retries and exposes initialLoadFailed on exhaustion', async () => {
        vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({ status: 503 });

        const { result } = renderHook(() => useSessionHydration());

        // Initial attempt 1 + 3 retries across backoff
        for (let i = 0; i < 4; i++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(9000);
            });
        }

        expect(pokerApi.getRoomInfo).toHaveBeenCalledTimes(4);
        expect(result.current.initialLoadFailed).toBe(true);
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_HYDRATED', payload: true });
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_LOADING_STATUS', payload: 'Connected.' });

        // retryInitialLoad triggers a new attempt with reset budget
        vi.mocked(pokerApi.getRoomInfo).mockResolvedValueOnce(createValidRoomData({
            roomId: 'ROOM123',
            gameStarted: false,
            players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
        }));

        await act(async () => {
            result.current.retryInitialLoad();
            await Promise.resolve();
        });

        expect(result.current.initialLoadFailed).toBe(false);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_HYDRATED', payload: true });
    });

    it('does not mark hydration complete when unmounted during the private-state fetch', async () => {
        let resolvePrivateState!: (value: { playerId: string; holeCards: string[] }) => void;
        const privateState = new Promise<{ playerId: string; holeCards: string[] }>((resolve) => {
            resolvePrivateState = resolve;
        });
        vi.spyOn(pokerApi, 'getRoomInfo').mockResolvedValue(createValidRoomData({
            roomId: 'ROOM123',
            gameStarted: true,
            players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
        }));
        vi.spyOn(pokerApi, 'getGameState').mockResolvedValue(createValidGameState({
            gameId: 'ROOM123',
            players: [],
        }));
        vi.spyOn(pokerApi, 'getPrivateState').mockReturnValue(privateState);

        const { unmount } = renderHook(() => useSessionHydration());
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(pokerApi.getPrivateState).toHaveBeenCalled();
        dispatch.mockClear();

        unmount();
        resolvePrivateState({ playerId: 'p-1', holeCards: ['AS', 'KS'] });
        await act(async () => {
            await privateState;
        });

        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_HYDRATED', payload: true });
    });

    describe('review recovery on 403 / 404 failures', () => {
        const terminalReview = {
            gameId: 'ROOM123',
            winnerName: 'TestPlayer',
            winnerChips: 1000,
            isForfeit: false,
            message: 'Game Over',
        };

        it('installs terminal result when room 404 recovers via review 200', async () => {
            vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({ status: 404 });
            const getReviewSpy = vi.spyOn(pokerApi, 'getReview').mockResolvedValue(terminalReview);

            renderHook(() => useSessionHydration());

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(getReviewSpy).toHaveBeenCalledWith('ROOM123', mockAuth.token);
            expect(dispatch).toHaveBeenCalledWith({
                type: 'INSTALL_TERMINAL_RESULT',
                payload: terminalReview,
            });
            expect(dispatch).toHaveBeenCalledWith({
                type: 'SET_HYDRATED',
                payload: true,
            });
            expect(onLeave).not.toHaveBeenCalled();
        });

        it('installs terminal result when game state 404 recovers via review 200', async () => {
            vi.spyOn(pokerApi, 'getRoomInfo').mockResolvedValue(createValidRoomData({
                roomId: 'ROOM123',
                gameStarted: true,
                players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
            }));
            vi.spyOn(pokerApi, 'getGameState').mockRejectedValue({ status: 404 });
            const getReviewSpy = vi.spyOn(pokerApi, 'getReview').mockResolvedValue(terminalReview);

            renderHook(() => useSessionHydration());

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(getReviewSpy).toHaveBeenCalledWith('ROOM123', mockAuth.token);
            expect(dispatch).toHaveBeenCalledWith({
                type: 'INSTALL_TERMINAL_RESULT',
                payload: terminalReview,
            });
            expect(dispatch).toHaveBeenCalledWith({
                type: 'SET_HYDRATED',
                payload: true,
            });
            expect(onLeave).not.toHaveBeenCalled();
        });

        it('honors original 404 failure with session expired redirect when review returns 404 or 409', async () => {
            vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({ status: 404 });
            vi.spyOn(pokerApi, 'getReview').mockRejectedValue({ status: 404 });

            renderHook(() => useSessionHydration());

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(dispatch).toHaveBeenCalledWith({
                type: 'SET_NOTIFICATION',
                payload: SESSION_EXPIRED,
            });

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(onLeave).toHaveBeenCalledTimes(1);
        });

        it('triggers seat-gone redirect when review returns 403', async () => {
            vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({ status: 404 });
            vi.spyOn(pokerApi, 'getReview').mockRejectedValue({ status: 403 });

            renderHook(() => useSessionHydration());

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(dispatch).toHaveBeenCalledWith({
                type: 'SET_NOTIFICATION',
                payload: SESSION_SEAT_GONE,
            });

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(onLeave).toHaveBeenCalledTimes(1);
        });

        it('retries when review returns 500 / network error and fails load upon exhaustion', async () => {
            vi.spyOn(pokerApi, 'getRoomInfo').mockRejectedValue({ status: 404 });
            vi.spyOn(pokerApi, 'getReview').mockRejectedValue({ status: 500 });

            const { result } = renderHook(() => useSessionHydration());

            // 1 initial + 3 retries across backoff
            for (let i = 0; i < 4; i++) {
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(9000);
                });
            }

            expect(pokerApi.getReview).toHaveBeenCalledTimes(4);
            expect(result.current.initialLoadFailed).toBe(true);
            expect(onLeave).not.toHaveBeenCalled();
        });
    });
});
