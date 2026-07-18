import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionHydration } from '../useSessionHydration';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

describe('useSessionHydration', () => {
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
            gameEndResult: null,
            scheduleShowdownHide: vi.fn(),
            latestGameStateRef: { current: null },
            notificationTimerRef: { current: null },
            clearShowdownTimers: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hydrates room and transitions loading state successfully when game is not started', async () => {
        const getRoomInfoSpy = vi.spyOn(pokerApi, 'getRoomInfo').mockResolvedValue({
            roomId: 'ROOM123',
            roomName: 'Table 1',
            players: [{ name: 'TestPlayer', isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
            maxPlayers: 6,
            buyIn: 2000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: true,
            gameStarted: false,
            createdAt: '2026-05-22T00:00:00Z',
            hostName: 'TestPlayer',
            currentPlayers: 1,
        });

        renderHook(() => useSessionHydration());

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getRoomInfoSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
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

    it('redirects to lobby if session hydration times out after 120 seconds', async () => {
        // Mock getRoomInfo to hang indefinitely (never resolve)
        const getRoomInfoSpy = vi.spyOn(pokerApi, 'getRoomInfo').mockReturnValue(new Promise(() => {}));

        renderHook(() => useSessionHydration());

        expect(getRoomInfoSpy).toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_LOADING_STATUS',
            payload: 'Connecting...',
        });

        // Fast-forward 120 seconds to trigger the timeout
        act(() => {
            vi.advanceTimersByTime(120000);
        });

        // Should trigger redirect message
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_NOTIFICATION',
            payload: 'Session expired. Returning to lobby...',
        });

        // Fast-forward 3 seconds to complete redirection
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });
});
