import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameDispatcher } from '../useGameDispatcher';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { InMemoryTransportAdapter } from '../../services/transport';
import { pokerApi } from '../../services/api';
import { RAISE_ERROR_FORBIDDEN_BET } from '../../constants/strings';
import type { GameState } from '../../types';

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
    let transport: InMemoryTransportAdapter;
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
        vi.useFakeTimers();

        transport = new InMemoryTransportAdapter();
        session = new GameSession({
            auth: mockAuth,
            transport,
            onLeave,
            initialGameState: {
                gameId: 'GAME123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                maxPlayers: 6,
                currentPlayerName: 'TestPlayer',
                currentPlayerId: 'p-1',
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, hasFolded: false, status: 'ACTIVE' },
                ],
            } as GameState,
        });
        session.connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatch PLAY_ACTION publishes STOMP message', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'RAISE', amount: 100 });
        });

        expect(transport.getPublishedMessages('/app/GAME123/action')).toEqual([
            {
                destination: '/app/GAME123/action',
                body: JSON.stringify({ action: 'RAISE', amount: 100 }),
            },
        ]);
        expect(result.current.isPending('PLAY_ACTION')).toBe(true);
        expect(session.getSnapshot().pendingActions.has('PLAY_ACTION')).toBe(true);
    });

    it('blocks duplicate rapid calls until timeout', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
        });

        expect(transport.getPublishedMessages('/app/GAME123/action')).toHaveLength(1);

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
        });

        expect(transport.getPublishedMessages('/app/GAME123/action')).toHaveLength(2);
    });

    it('defers and sets notification when client is not connected', async () => {
        transport.disconnect();
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'RAISE', amount: 100 });
        });

        expect(transport.getPublishedMessages()).toHaveLength(0);
        expect(session.getSnapshot().notification).toBe('Waiting for connection...');
    });

    it('dispatch READY and UNREADY publish STOMP messages', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'READY' });
            await result.current.dispatch({ type: 'UNREADY' });
        });

        expect(transport.getPublishedMessages('/app/GAME123/ready')).toEqual([
            {
                destination: '/app/GAME123/ready',
                body: '{}',
            },
        ]);
        expect(transport.getPublishedMessages('/app/GAME123/unready')).toEqual([
            {
                destination: '/app/GAME123/unready',
                body: '{}',
            },
        ]);
    });

    it('dispatch START_GAME calls pokerApi', async () => {
        const startGameSpy = vi.mocked(pokerApi.startGame).mockResolvedValue({});
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(startGameSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
    });

    it('dispatch START_GAME handles error', async () => {
        vi.mocked(pokerApi.startGame).mockRejectedValue(new Error('Start failed'));
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(session.getSnapshot().notification).toBe('Start failed');
    });

    it('dispatch CLAIM_WIN calls pokerApi', async () => {
        const claimWinSpy = vi.mocked(pokerApi.claimWin).mockResolvedValue(true);
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(session.getSnapshot().claimPending).toBe(true);
        expect(claimWinSpy).toHaveBeenCalledWith('GAME123', 'test-token');
    });

    it('dispatch LEAVE_GAME calls leaveGame and leaveRoom', async () => {
        const leaveGameSpy = vi.mocked(pokerApi.leaveGame).mockResolvedValue();
        const leaveRoomSpy = vi.mocked(pokerApi.leaveRoom).mockResolvedValue();
        const clearShowdownSpy = vi.spyOn(session, 'clearShowdownTimers');
        session.applyPrivateState({ playerId: 'p-1', holeCards: ['AS', 'KS'] });

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(clearShowdownSpy).toHaveBeenCalled();
        expect(session.getSnapshot().privateState).toBeNull();
        expect(leaveGameSpy).toHaveBeenCalledWith('GAME123', 'test-token');
        expect(leaveRoomSpy).toHaveBeenCalledWith('ROOM123', 'test-token');
        expect(onLeave).toHaveBeenCalled();
    });

    it('dispatch LEAVE_REVIEW clears persisted game-end snapshot and calls onLeave even if REST fails', async () => {
        vi.mocked(pokerApi.leaveGame).mockRejectedValue(new Error('404 Not Found'));
        vi.mocked(pokerApi.leaveRoom).mockRejectedValue(new Error('404 Not Found'));
        const clearShowdownSpy = vi.spyOn(session, 'clearShowdownTimers');
        localStorage.setItem(
            'poker-game-end:ROOM123',
            JSON.stringify({ winnerName: 'TestPlayer', isForfeit: false, message: 'TestPlayer wins!' })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_REVIEW' });
        });

        expect(localStorage.getItem('poker-game-end:ROOM123')).toBeNull();
        expect(clearShowdownSpy).toHaveBeenCalled();
        expect(session.getSnapshot().gameState).toBeNull();
        expect(onLeave).toHaveBeenCalled();
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('dispatch LEAVE_GAME calls onLeave even on 404 error', async () => {
        const error = new Error('Not Found') as Error & { status?: number };
        error.status = 404;
        vi.mocked(pokerApi.leaveGame).mockRejectedValue(error);

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(onLeave).toHaveBeenCalled();
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('onSocketError parses errors and updates error state', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        act(() => {
            result.current.onSocketError('INSUFFICIENT_CHIPS');
        });

        expect(result.current.error?.message).toBe('INSUFFICIENT_CHIPS');
        expect(session.getSnapshot().notification).toBe(RAISE_ERROR_FORBIDDEN_BET);

        act(() => {
            result.current.onSocketError('SOME_OTHER_ERROR');
        });

        expect(session.getSnapshot().notification).toBe('SOME_OTHER_ERROR');
    });
});
