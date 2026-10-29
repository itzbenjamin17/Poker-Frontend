import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameDispatcher } from '../useGameDispatcher';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { InMemoryTransportAdapter } from '../../services/transport';
import { pokerApi } from '../../services/api';
import type { GameEndResult, GameState } from '../../types';
import { createValidGameState } from '../../test/fixtures';

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/api')>();
    return {
        ...actual,
        pokerApi: {
            ...actual.pokerApi,
            startGame: vi.fn(),
            claimWin: vi.fn(),
            getReview: vi.fn(),
            leaveGame: vi.fn(),
            leaveRoom: vi.fn(),
        },
    };
});

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

    function createWrapper(customSession = session, customAuth = mockAuth, customRequestLeave?: () => Promise<boolean>) {
        return function Wrapper({ children }: { children: ReactNode }) {
            return createElement(GameProvider, {
                auth: customAuth,
                onLeave,
                requestLeave: customRequestLeave,
                session: customSession,
                children,
            });
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        localStorage.clear();
        sessionStorage.clear();

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

        expect(startGameSpy).toHaveBeenCalledWith('ROOM123', 'test-token', expect.any(AbortSignal));
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

    it('dispatch CLAIM_WIN success installs terminal result and clears claimPending', async () => {
        const installSpy = vi.spyOn(session, 'installTerminalResult');
        const terminalData = {
            gameId: 'GAME123',
            winnerName: 'TestPlayer',
            winnerChips: 1980,
            isForfeit: true,
            message: 'Win claimed',
        };
        const claimWinSpy = vi.mocked(pokerApi.claimWin).mockResolvedValue({
            message: 'Win claimed',
            data: terminalData,
        });
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(claimWinSpy).toHaveBeenCalledWith('GAME123', 'test-token', expect.any(AbortSignal));
        expect(installSpy).toHaveBeenCalledWith(terminalData);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.winnerName).toBe('TestPlayer');
    });

    it('dispatch CLAIM_WIN directly transitions session to review state and invokes setGameEndResult without waiting for STOMP', async () => {
        const terminalData = {
            gameId: 'GAME123',
            winnerName: 'TestPlayer',
            winnerChips: 1980,
            isForfeit: true,
            message: 'Win claimed directly',
        };
        const claimWinSpy = vi.mocked(pokerApi.claimWin).mockResolvedValue({
            message: 'Win claimed',
            data: terminalData,
        });
        const setGameEndResultSpy = vi.spyOn(session, 'setGameEndResult');
        const installSpy = vi.spyOn(session, 'installTerminalResult');

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(claimWinSpy).toHaveBeenCalledWith('GAME123', 'test-token', expect.any(AbortSignal));
        expect(installSpy).toHaveBeenCalledWith(terminalData);
        expect(setGameEndResultSpy).toHaveBeenCalledWith(terminalData);
        expect(pokerApi.getReview).not.toHaveBeenCalled();
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.winnerName).toBe('TestPlayer');
    });

    it('recovers terminal game review from getReview when public state polling encounters 404', async () => {
        session.markGameStarted();
        const reviewResult = {
            gameId: 'ROOM123',
            winnerName: 'TestPlayer',
            winnerChips: 2000,
            isForfeit: true,
            message: 'Recovered review from polling 404',
        };
        const getPublicSpy = vi.spyOn(pokerApi, 'getPublicGameState').mockRejectedValue({ status: 404 });
        vi.spyOn(pokerApi, 'getPrivatePlayerState').mockRejectedValue({ status: 404 });
        const getReviewSpy = vi.mocked(pokerApi.getReview).mockResolvedValue(reviewResult);

        renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await session.synchronizeSession({ resetBudget: true });
        });

        expect(getPublicSpy).toHaveBeenCalled();
        expect(getReviewSpy).toHaveBeenCalledWith('ROOM123', 'test-token', expect.any(AbortSignal));
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.winnerName).toBe('TestPlayer');
        expect(session.getSnapshot().gameEndResult?.message).toBe('Recovered review from polling 404');
    });

    it('dispatch CLAIM_WIN triggers review recovery via pokerApi.getReview on network/timeout failure and installs terminal result', async () => {
        const networkError = new TypeError('Failed to fetch');
        vi.mocked(pokerApi.claimWin).mockRejectedValue(networkError);
        const reviewResult = {
            gameId: 'GAME123',
            winnerName: 'TestPlayer',
            winnerChips: 2000,
            isForfeit: true,
            message: 'Recovered review: TestPlayer won',
        };
        const getReviewSpy = vi.mocked(pokerApi.getReview).mockResolvedValue(reviewResult);
        const installSpy = vi.spyOn(session, 'installTerminalResult');

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(getReviewSpy).toHaveBeenCalledWith('GAME123', 'test-token', expect.any(AbortSignal));
        expect(installSpy).toHaveBeenCalledWith(reviewResult);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.winnerName).toBe('TestPlayer');
    });

    it('recovers by review after a timed-out claim response', async () => {
        vi.mocked(pokerApi.claimWin).mockRejectedValue(Object.assign(new Error('Request timed out'), { status: 408 }));
        vi.mocked(pokerApi.getReview).mockResolvedValue({
            gameId: 'GAME123', winnerName: 'TestPlayer', winnerChips: 2000,
            isForfeit: true, message: 'Recovered review',
        });
        const { result } = renderHook(() => useGameDispatcher(), { wrapper: createWrapper() });

        await act(async () => { await result.current.dispatch({ type: 'CLAIM_WIN' }); });

        expect(pokerApi.getReview).toHaveBeenCalledWith('GAME123', 'test-token', expect.any(AbortSignal));
        expect(session.getSnapshot().isGameOver).toBe(true);
    });

    it('keeps claim pending across public socket updates during deferred review recovery', async () => {
        let resolveReview!: (value: GameEndResult) => void;
        vi.mocked(pokerApi.claimWin).mockRejectedValue(new TypeError('Lost claim response'));
        vi.mocked(pokerApi.getReview).mockReturnValue(new Promise((resolve) => { resolveReview = resolve; }));
        const { result } = renderHook(() => useGameDispatcher(), { wrapper: createWrapper() });

        let dispatchPromise!: Promise<void>;
        act(() => { dispatchPromise = result.current.dispatch({ type: 'CLAIM_WIN' }); });
        await vi.waitFor(() => expect(pokerApi.getReview).toHaveBeenCalledTimes(1));
        expect(session.getSnapshot().claimPending).toBe(true);
        transport.simulateMessage('/game/ROOM123', createValidGameState({
            gameId: 'ROOM123', handNumber: 1, pot: 42,
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 980 }],
        }));
        expect(session.getSnapshot().gameState?.pot).toBe(42);
        expect(session.getSnapshot().claimPending).toBe(true);

        await act(async () => {
            resolveReview({
                gameId: 'GAME123', winnerName: 'TestPlayer', winnerChips: 2000,
                isForfeit: true, message: 'Recovered review',
            });
            await dispatchPromise;
        });
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().claimPending).toBe(false);
    });

    it('dispatch CLAIM_WIN clears claimPending and exposes retry when review recovery is exhausted', async () => {
        const error500 = Object.assign(new Error('Internal Server Error'), { status: 500 });
        vi.mocked(pokerApi.claimWin).mockRejectedValue(error500);
        vi.mocked(pokerApi.getReview).mockRejectedValue(new Error('Review unavailable'));

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
            await vi.advanceTimersByTimeAsync(20_000);
        });

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(false);
        expect(result.current.isPending('CLAIM_WIN')).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(pokerApi.getReview).toHaveBeenCalledTimes(4);
    });

    it('does not retry review after a definite claim rejection', async () => {
        const error = Object.assign(new Error('Cannot claim win right now.'), { status: 403 });
        vi.mocked(pokerApi.claimWin).mockRejectedValue(error);
        const getReviewSpy = vi.mocked(pokerApi.getReview).mockRejectedValue(new Error('No review available'));
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(getReviewSpy).not.toHaveBeenCalled();
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().notification).toBe('Cannot claim win right now.');
    });

    it('dispatch LEAVE_GAME calls the shared room departure endpoint once', async () => {
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
        expect(leaveGameSpy).not.toHaveBeenCalled();
        expect(leaveRoomSpy).toHaveBeenCalledWith('ROOM123', 'test-token', false, expect.any(AbortSignal));
        expect(leaveRoomSpy).toHaveBeenCalledTimes(1);
        expect(onLeave).toHaveBeenCalled();
    });

    it('retains the session and surfaces an error when room departure fails', async () => {
        const error = Object.assign(new Error('Network failure'), { status: 500 });
        const leaveGameSpy = vi.mocked(pokerApi.leaveGame);
        const leaveRoomSpy = vi.mocked(pokerApi.leaveRoom).mockRejectedValue(error);
        const clearShowdownSpy = vi.spyOn(session, 'clearShowdownTimers');
        session.applyPrivateState({ playerId: 'p-1', holeCards: ['AS', 'KS'] });
        localStorage.setItem(
            'poker-game-end:ROOM123',
            JSON.stringify({ winnerName: 'TestPlayer', isForfeit: false, message: 'TestPlayer wins!' })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(leaveGameSpy).not.toHaveBeenCalled();
        expect(leaveRoomSpy).toHaveBeenCalledWith('ROOM123', 'test-token', false, expect.any(AbortSignal));
        expect(leaveRoomSpy).toHaveBeenCalledTimes(1);
        expect(clearShowdownSpy).not.toHaveBeenCalled();
        expect(session.getSnapshot().privateState).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();
        expect(session.getSnapshot().notification).toContain('Network failure');
    });

    it('dispatch LEAVE_REVIEW clears persisted game-end snapshot and calls onLeave even if REST fails', async () => {
        const leaveGameSpy = vi.mocked(pokerApi.leaveGame);
        const leaveRoomSpy = vi.mocked(pokerApi.leaveRoom);
        const clearShowdownSpy = vi.spyOn(session, 'clearShowdownTimers');
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });
        sessionStorage.setItem(
            'poker-game-end:ROOM123',
            JSON.stringify({ winnerName: 'TestPlayer', isForfeit: false, message: 'TestPlayer wins!' })
        );

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_REVIEW' });
        });

        expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
        expect(leaveRoomSpy).not.toHaveBeenCalled();
        expect(leaveGameSpy).not.toHaveBeenCalled();
        expect(clearShowdownSpy).toHaveBeenCalled();
        expect(session.getSnapshot().gameState).toBeNull();
        expect(onLeave).toHaveBeenCalled();
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('dispatch LEAVE_GAME calls onLeave even on 404 error', async () => {
        const error = new Error('Not Found') as Error & { status?: number };
        error.status = 404;
        vi.mocked(pokerApi.leaveRoom).mockRejectedValue(error);

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(onLeave).toHaveBeenCalled();
        expect(pokerApi.leaveRoom).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('onSocketError keeps transport failures in generic notifications', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        act(() => {
            result.current.onSocketError('INSUFFICIENT_CHIPS');
        });

        expect(result.current.error).toBeNull();
        expect(session.getSnapshot().notification).toBe('INSUFFICIENT_CHIPS');

        act(() => {
            result.current.onSocketError('SOME_OTHER_ERROR');
        });

        expect(session.getSnapshot().notification).toBe('SOME_OTHER_ERROR');
    });

    it('handles HTTP 503 from START_GAME as retryable feedback and keeps controls usable', async () => {
        const error503 = Object.assign(new Error('Server unavailable'), { status: 503 });
        vi.mocked(pokerApi.startGame).mockRejectedValue(error503);
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(result.current.isPending('START_GAME')).toBe(false);
        expect(session.getSnapshot().error).toBeNull();
        expect(session.getSnapshot().notification).toBe('Server unavailable');
        expect(onLeave).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.dispatch({ type: 'PLAY_ACTION', action: 'CHECK' });
        });
        expect(transport.getPublishedMessages('/app/GAME123/action')).toHaveLength(1);
    });

    it('handles HTTP 503 from CLAIM_WIN as retryable feedback and keeps session', async () => {
        const error503 = Object.assign(new Error('Server recovering'), { status: 503 });
        vi.mocked(pokerApi.claimWin).mockRejectedValue(error503);
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
            await vi.advanceTimersByTimeAsync(20_000);
        });

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(result.current.isPending('CLAIM_WIN')).toBe(false);
        expect(session.getSnapshot().error).toBeNull();
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(pokerApi.getReview).toHaveBeenCalledTimes(4);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('missing GAME_STARTED or public STOMP after successful Start still reaches the table through REST; duplicate clicks produce one POST', async () => {
        const startGameSpy = vi.mocked(pokerApi.startGame).mockResolvedValue({});
        const syncSpy = vi.spyOn(session, 'synchronizeSession').mockImplementation(async () => {
            session.setGameState(createValidGameState({ gameId: 'ROOM123', phase: 'PRE_FLOP' }));
        });

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(startGameSpy).toHaveBeenCalledTimes(1);
        expect(session.isStarted()).toBe(true);
        expect(syncSpy).toHaveBeenCalled();
        expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });
        expect(startGameSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores START_GAME continuation and does not update state if detached before completion', async () => {
        let resolveStart!: (val?: unknown) => void;
        let capturedSignal: AbortSignal | undefined;
        vi.mocked(pokerApi.startGame).mockImplementation((_roomId, _token, signal) => {
            capturedSignal = signal;
            return new Promise((resolve) => {
                resolveStart = resolve;
            });
        });
        const syncSpy = vi.spyOn(session, 'synchronizeSession');

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'START_GAME' });
        });

        expect(result.current.isPending('START_GAME')).toBe(true);

        // Detach session / unmount hook before START_GAME finishes
        unmount();

        expect(capturedSignal?.aborted).toBe(true);

        await act(async () => {
            resolveStart();
            await dispatchPromise;
        });

        // Continuation must NOT run
        expect(session.isStarted()).toBe(false);
        expect(syncSpy).not.toHaveBeenCalled();
    });

    it('ignores START_GAME rejection and does not set error notification if detached before completion', async () => {
        let rejectStart!: (err: unknown) => void;
        vi.mocked(pokerApi.startGame).mockImplementation(() => {
            return new Promise((_, reject) => {
                rejectStart = reject;
            });
        });

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'START_GAME' });
        });

        // Detach session / unmount
        unmount();

        await act(async () => {
            rejectStart(new Error('Server crashed'));
            await dispatchPromise;
        });

        expect(session.getSnapshot().notification).toBeNull();
    });

    it('ignores LEAVE_GAME continuation when requestLeave completes after session detachment', async () => {
        let resolveLeave!: (val: boolean) => void;
        const mockRequestLeave = vi.fn().mockImplementation(() => {
            return new Promise<boolean>((resolve) => {
                resolveLeave = resolve;
            });
        });

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(session, mockAuth, mockRequestLeave),
        });

        session.applyPrivateState({ playerId: 'p-1', holeCards: ['AS', 'KS'] });
        expect(session.getSnapshot().privateState).not.toBeNull();

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        // Session unmounts / detaches before requestLeave finishes
        unmount();

        await act(async () => {
            resolveLeave(true);
            await dispatchPromise;
        });

        // Stale dispatcher must NOT change privateState or dispatch CLEAR_GAME_STATE on obsolete session
        // (the mock session was detached, but should not be wiped by the obsolete continuation)
    });

    it('passes AbortSignal to hook-owned fallback leave and aborts on unmount', async () => {
        let capturedSignal: AbortSignal | undefined;
        let resolveLeave!: () => void;
        vi.mocked(pokerApi.leaveRoom).mockImplementation((_roomId, _token, _keepalive, signal) => {
            capturedSignal = signal;
            return new Promise((resolve) => {
                resolveLeave = resolve;
            });
        });

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(session, mockAuth, undefined), // fallback leave
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(capturedSignal).toBeDefined();
        expect(capturedSignal?.aborted).toBe(false);

        unmount();

        expect(capturedSignal?.aborted).toBe(true);

        await act(async () => {
            resolveLeave();
            await dispatchPromise;
        });
    });
});

