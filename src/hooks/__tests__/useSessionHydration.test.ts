import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionHydration } from '../useSessionHydration';
import { useGameContext } from '../../context/GameContext';
import { pokerApi } from '../../services/api';
import { createValidGameState, createValidRoomData } from '../../test/fixtures';

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
});
