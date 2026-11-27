import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { useGameDispatcher } from '../useGameDispatcher';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, PublicGameStateResponse } from '../../types';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';

async function advanceRecoveryRetries(
    clock: TestClock,
    session: GameSession,
    getCallCount: () => number,
    maxSteps = 4
) {
    for (let step = 0; step < maxSteps && session.hasPendingRecoveryTimer(); step += 1) {
        const previousCalls = getCallCount();
        act(() => {
            clock.tick(10_000);
        });
        await waitFor(() => {
            expect(getCallCount()).toBeGreaterThan(previousCalls);
        });
        await waitFor(() => {
            expect(session.hasPendingRecoveryTimer() || session.getSnapshot().recoveryFailed).toBe(true);
        });
    }
}

describe('useGameDispatcher', () => {
    const tokenA = createMockJwt({ sub: 'TestPlayer' });
    const mockAuth: AuthResponse = {
        token: tokenA,
        roomId: 'ROOM123',
        playerName: 'TestPlayer',
    };
    const onLeave = vi.fn();
    let transport: InMemoryTransportAdapter;
    let clock: TestClock;
    let session: GameSession;

    function createWrapper(
        customSession = session,
        customAuth = mockAuth,
        customRequestLeave?: (originatingToken?: string) => Promise<boolean>
    ) {
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
        localStorage.clear();
        sessionStorage.clear();

        transport = new InMemoryTransportAdapter();
        clock = new TestClock(1000);
        session = new GameSession({
            auth: mockAuth,
            transport,
            clock,
            onLeave,
            initialGameState: createValidGameState({
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
            }),
        });
        session.connect();
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

        act(() => {
            clock.tick(3000);
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

    it('dispatch START_GAME calls start-game endpoint with Bearer token', async () => {
        let startGameCalls = 0;
        let capturedAuthHeader: string | null = null;
        server.use(
            http.post('*/api/room/ROOM123/start-game', ({ request }) => {
                startGameCalls += 1;
                capturedAuthHeader = request.headers.get('Authorization');
                return new HttpResponse(null, { status: 204 });
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(startGameCalls).toBe(1);
        expect(capturedAuthHeader).toBe(`Bearer ${tokenA}`);
    });

    it('dispatch START_GAME handles error', async () => {
        server.use(
            http.post('*/api/room/ROOM123/start-game', () =>
                HttpResponse.json({ detail: 'Start failed' }, { status: 400 })
            )
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(session.getSnapshot().notification).toBe('Start failed');
    });

    it('dispatch CLAIM_WIN success installs terminal result and clears claimPending', async () => {
        const terminalData: PublicGameStateResponse = createValidGameState({
            gameId: 'GAME123',
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1980 }],
            gameEnd: {
                winner: 'TestPlayer',
                winnerChips: 1980,
                isForfeit: true,
                message: 'Win claimed',
            },
        });
        let claimWinCalls = 0;
        let capturedAuthHeader: string | null = null;
        server.use(
            http.post('*/api/game/GAME123/claim-win', ({ request }) => {
                claimWinCalls += 1;
                capturedAuthHeader = request.headers.get('Authorization');
                return HttpResponse.json(terminalData);
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(claimWinCalls).toBe(1);
        expect(capturedAuthHeader).toBe(`Bearer ${tokenA}`);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.gameEnd?.winner).toBe('TestPlayer');
    });

    it('dispatch CLAIM_WIN directly transitions session to review state without waiting for STOMP or polling getReview', async () => {
        const terminalData: PublicGameStateResponse = createValidGameState({
            gameId: 'GAME123',
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 1980 }],
            gameEnd: {
                winner: 'TestPlayer',
                winnerChips: 1980,
                isForfeit: true,
                message: 'Win claimed directly',
            },
        });
        let claimWinCalls = 0;
        let reviewCalls = 0;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () => {
                claimWinCalls += 1;
                return HttpResponse.json(terminalData);
            }),
            http.get('*/api/game/:gameId/review', () => {
                reviewCalls += 1;
                return HttpResponse.json({ detail: 'Not needed' }, { status: 404 });
            })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(claimWinCalls).toBe(1);
        expect(reviewCalls).toBe(0);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult).toMatchObject({
            gameId: 'GAME123',
            gameEnd: terminalData.gameEnd,
        });
    });

    it('recovers terminal game review from getReview when public state polling encounters 404', async () => {
        session.markGameStarted();
        const reviewResult: PublicGameStateResponse = createValidGameState({
            gameId: 'ROOM123',
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 2000 }],
            gameEnd: {
                winner: 'TestPlayer',
                winnerChips: 2000,
                isForfeit: true,
                message: 'Recovered review from polling 404',
            },
        });
        let publicCalls = 0;
        let reviewCalls = 0;
        let capturedReviewAuth: string | null = null;
        server.use(
            http.get('*/api/game/ROOM123/state', () => {
                publicCalls += 1;
                return HttpResponse.json({ detail: 'Not found' }, { status: 404 });
            }),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ detail: 'Not found' }, { status: 404 })
            ),
            http.get('*/api/game/ROOM123/review', ({ request }) => {
                reviewCalls += 1;
                capturedReviewAuth = request.headers.get('Authorization');
                return HttpResponse.json(reviewResult);
            })
        );

        renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await session.synchronizeSession({ resetBudget: true });
        });

        expect(publicCalls).toBeGreaterThanOrEqual(1);
        expect(reviewCalls).toBe(1);
        expect(capturedReviewAuth).toBe(`Bearer ${tokenA}`);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.gameEnd?.winner).toBe('TestPlayer');
        expect(session.getSnapshot().gameEndResult?.gameEnd?.message).toBe('Recovered review from polling 404');
    });

    it('dispatch CLAIM_WIN triggers review recovery via getReview on network failure and installs terminal result', async () => {
        const reviewResult: PublicGameStateResponse = createValidGameState({
            gameId: 'GAME123',
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 2000 }],
            gameEnd: {
                winner: 'TestPlayer',
                winnerChips: 2000,
                isForfeit: true,
                message: 'Recovered review: TestPlayer won',
            },
        });
        let reviewCalls = 0;
        let capturedReviewAuth: string | null = null;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () => HttpResponse.error()),
            http.get('*/api/game/GAME123/review', ({ request }) => {
                reviewCalls += 1;
                capturedReviewAuth = request.headers.get('Authorization');
                return HttpResponse.json(reviewResult);
            })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(reviewCalls).toBe(1);
        expect(capturedReviewAuth).toBe(`Bearer ${tokenA}`);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().gameEndResult?.gameEnd?.winner).toBe('TestPlayer');
    });

    it('recovers by review after a timed-out claim response (408)', async () => {
        let reviewCalls = 0;
        let capturedReviewAuth: string | null = null;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () =>
                HttpResponse.json({ detail: 'Request timed out' }, { status: 408 })
            ),
            http.get('*/api/game/GAME123/review', ({ request }) => {
                reviewCalls += 1;
                capturedReviewAuth = request.headers.get('Authorization');
                return HttpResponse.json(createValidGameState({
                    gameId: 'GAME123',
                    phase: 'SHOWDOWN',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 2000 }],
                    gameEnd: {
                        winner: 'TestPlayer',
                        winnerChips: 2000,
                        isForfeit: true,
                        message: 'Recovered review',
                    },
                }));
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), { wrapper: createWrapper() });

        await act(async () => { await result.current.dispatch({ type: 'CLAIM_WIN' }); });

        expect(reviewCalls).toBe(1);
        expect(capturedReviewAuth).toBe(`Bearer ${tokenA}`);
        expect(session.getSnapshot().isGameOver).toBe(true);
    });

    it('keeps claim pending across public socket updates during deferred review recovery', async () => {
        let resolveReview!: () => void;
        let reviewCalls = 0;
        const reviewPayload = createValidGameState({
            gameId: 'GAME123',
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'TestPlayer', chips: 2000 }],
            gameEnd: {
                winner: 'TestPlayer',
                winnerChips: 2000,
                isForfeit: true,
                message: 'Recovered review',
            },
        });
        server.use(
            http.post('*/api/game/GAME123/claim-win', () => HttpResponse.error()),
            http.get('*/api/game/GAME123/review', () => {
                reviewCalls += 1;
                return new Promise<Response>((resolve) => {
                    resolveReview = () => resolve(HttpResponse.json(reviewPayload));
                });
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), { wrapper: createWrapper() });

        let dispatchPromise!: Promise<void>;
        act(() => { dispatchPromise = result.current.dispatch({ type: 'CLAIM_WIN' }); });
        await waitFor(() => expect(reviewCalls).toBe(1));
        expect(session.getSnapshot().claimPending).toBe(true);

        act(() => {
            transport.simulateMessage('/game/ROOM123', createValidGameState({
                gameId: 'ROOM123', handNumber: 1, pot: 42,
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 980 }],
            }));
        });
        expect(session.getSnapshot().gameState?.pot).toBe(42);
        expect(session.getSnapshot().claimPending).toBe(true);

        await act(async () => {
            resolveReview();
            await dispatchPromise;
        });
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().claimPending).toBe(false);
    });

    it('dispatch CLAIM_WIN clears claimPending and exposes retry when review recovery is exhausted', async () => {
        let reviewCalls = 0;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () =>
                HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
            ),
            http.get('*/api/game/GAME123/review', () => {
                reviewCalls += 1;
                return HttpResponse.json({ detail: 'Review unavailable' }, { status: 503 });
            })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });
        await advanceRecoveryRetries(clock, session, () => reviewCalls);

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().isGameOver).toBe(false);
        expect(result.current.isPending('CLAIM_WIN')).toBe(false);
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(reviewCalls).toBe(4);
    });

    it('does not retry review after a definite claim rejection', async () => {
        let reviewCalls = 0;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () =>
                HttpResponse.json({ detail: 'Cannot claim win right now.' }, { status: 403 })
            ),
            http.get('*/api/game/GAME123/review', () => {
                reviewCalls += 1;
                return HttpResponse.json({ detail: 'No review available' }, { status: 404 });
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });

        expect(reviewCalls).toBe(0);
        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().notification).toBe('Cannot claim win right now.');
    });

    it('dispatch LEAVE_GAME calls the shared room departure endpoint once', async () => {
        let leaveCalls = 0;
        let capturedAuthHeader: string | null = null;
        server.use(
            http.post('*/api/room/ROOM123/leave', ({ request }) => {
                leaveCalls += 1;
                capturedAuthHeader = request.headers.get('Authorization');
                return new HttpResponse(null, { status: 204 });
            })
        );
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
        expect(leaveCalls).toBe(1);
        expect(capturedAuthHeader).toBe(`Bearer ${tokenA}`);
        expect(onLeave).toHaveBeenCalled();
    });

    it('retains the session and surfaces an error when room departure fails', async () => {
        let leaveCalls = 0;
        server.use(
            http.post('*/api/room/ROOM123/leave', () => {
                leaveCalls += 1;
                return HttpResponse.json({ detail: 'Network failure' }, { status: 500 });
            }),
            http.get('*/api/room/ROOM123', () =>
                HttpResponse.json(createValidRoomData({
                    roomId: 'ROOM123',
                    players: [{ name: 'TestPlayer', isHost: true }],
                    gameStarted: true,
                }))
            ),
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'PRE_FLOP',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 980 }],
                }))
            ),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: ['AS', 'KS'] })
            )
        );
        const disconnectSpy = vi.spyOn(transport, 'disconnect');
        session.applyPrivateState({ playerId: 'p-1', holeCards: ['AS', 'KS'] });
        localStorage.setItem(
            'poker-game-end:ROOM123',
            JSON.stringify({
                version: 2,
                roomId: 'ROOM123',
                playerName: 'TestPlayer',
                token: tokenA,
                result: createValidGameState({
                    gameId: 'ROOM123',
                    gameEnd: { winner: 'TestPlayer', isForfeit: false, message: 'TestPlayer wins!' },
                }),
            })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(leaveCalls).toBe(1);
        expect(disconnectSpy).not.toHaveBeenCalled();
        expect(session.getSnapshot().privateState).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();
        expect(session.getSnapshot().notification).toContain('Network failure');
    });

    it('dispatch LEAVE_REVIEW clears persisted game-end snapshot and calls onLeave without posting leave', async () => {
        let leaveCalls = 0;
        server.use(
            http.post('*/api/room/ROOM123/leave', () => {
                leaveCalls += 1;
                return new HttpResponse(null, { status: 204 });
            })
        );
        const clearShowdownSpy = vi.spyOn(session, 'clearShowdownTimers');
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });
        sessionStorage.setItem(
            'poker-game-end:ROOM123',
            JSON.stringify({
                version: 2,
                roomId: 'ROOM123',
                playerName: 'TestPlayer',
                token: tokenA,
                result: createValidGameState({
                    gameId: 'ROOM123',
                    gameEnd: { winner: 'TestPlayer', isForfeit: false, message: 'TestPlayer wins!' },
                }),
            })
        );

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_REVIEW' });
        });

        expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
        expect(leaveCalls).toBe(0);
        expect(clearShowdownSpy).toHaveBeenCalled();
        expect(session.getSnapshot().gameState).toBeNull();
        expect(onLeave).toHaveBeenCalled();
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('dispatch LEAVE_GAME calls onLeave even on 404 error', async () => {
        let leaveCalls = 0;
        server.use(
            http.post('*/api/room/ROOM123/leave', () => {
                leaveCalls += 1;
                return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
            })
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(onLeave).toHaveBeenCalled();
        expect(leaveCalls).toBe(1);
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
        server.use(
            http.post('*/api/room/ROOM123/start-game', () =>
                HttpResponse.json({ detail: 'Server unavailable' }, { status: 503 })
            )
        );
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
        let reviewCalls = 0;
        server.use(
            http.post('*/api/game/GAME123/claim-win', () =>
                HttpResponse.json({ detail: 'Server recovering' }, { status: 503 })
            ),
            http.get('*/api/game/GAME123/review', () => {
                reviewCalls += 1;
                return HttpResponse.json({ detail: 'Review recovering' }, { status: 503 });
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'CLAIM_WIN' });
        });
        await advanceRecoveryRetries(clock, session, () => reviewCalls);

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(result.current.isPending('CLAIM_WIN')).toBe(false);
        expect(session.getSnapshot().error).toBeNull();
        expect(session.getSnapshot().recoveryFailed).toBe(true);
        expect(reviewCalls).toBe(4);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('missing GAME_STARTED or public STOMP after successful Start still reaches the table through REST; duplicate clicks produce one POST', async () => {
        let startGameCalls = 0;
        server.use(
            http.post('*/api/room/ROOM123/start-game', () => {
                startGameCalls += 1;
                return new HttpResponse(null, { status: 204 });
            }),
            http.get('*/api/room/ROOM123', () =>
                HttpResponse.json(createValidRoomData({ roomId: 'ROOM123', gameStarted: true }))
            ),
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json(createValidGameState({
                    gameId: 'ROOM123',
                    phase: 'PRE_FLOP',
                    players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000 }],
                }))
            ),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: ['AS', 'KS'] })
            )
        );

        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });

        expect(startGameCalls).toBe(1);
        expect(session.isStarted()).toBe(true);
        await waitFor(() => expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP'));

        await act(async () => {
            await result.current.dispatch({ type: 'START_GAME' });
        });
        expect(startGameCalls).toBe(1);
    });

    it('ignores START_GAME continuation and does not update state if detached before completion', async () => {
        let resolveStart!: () => void;
        let capturedSignal: AbortSignal | undefined;
        let requestStarted = false;
        let syncRequests = 0;
        server.use(
            http.post('*/api/room/ROOM123/start-game', ({ request }) => {
                capturedSignal = request.signal;
                requestStarted = true;
                return new Promise<Response>((resolve) => {
                    resolveStart = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            }),
            http.get('*/api/game/ROOM123/state', () => {
                syncRequests += 1;
                return HttpResponse.json(createValidGameState({ gameId: 'ROOM123' }));
            })
        );

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'START_GAME' });
        });

        expect(result.current.isPending('START_GAME')).toBe(true);
        await waitFor(() => expect(requestStarted).toBe(true));

        // Detach session / unmount hook before START_GAME finishes
        unmount();

        expect(capturedSignal?.aborted).toBe(true);

        await act(async () => {
            resolveStart();
            await dispatchPromise;
        });

        // Continuation must NOT run
        expect(session.isStarted()).toBe(false);
        expect(syncRequests).toBe(0);
    });

    it('ignores START_GAME rejection and does not set error notification if detached before completion', async () => {
        let rejectStart!: () => void;
        let requestStarted = false;
        server.use(
            http.post('*/api/room/ROOM123/start-game', () => {
                requestStarted = true;
                return new Promise<Response>((resolve) => {
                    rejectStart = () => resolve(HttpResponse.json({ detail: 'Server crashed' }, { status: 500 }));
                });
            })
        );

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'START_GAME' });
        });
        await waitFor(() => expect(requestStarted).toBe(true));

        // Detach session / unmount
        unmount();

        await act(async () => {
            rejectStart();
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

        expect(session.getSnapshot().privateState).toEqual({ holeCards: ['AS', 'KS'] });
        expect(session.getSnapshot().gameState).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('passes AbortSignal to hook-owned fallback leave and aborts on unmount', async () => {
        let capturedSignal: AbortSignal | undefined;
        let resolveLeave!: () => void;
        let requestStarted = false;
        server.use(
            http.post('*/api/room/ROOM123/leave', ({ request }) => {
                capturedSignal = request.signal;
                requestStarted = true;
                return new Promise<Response>((resolve) => {
                    resolveLeave = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            })
        );

        const { result, unmount } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(session, mockAuth, undefined), // fallback leave
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        await waitFor(() => expect(requestStarted).toBe(true));
        expect(capturedSignal).toBeDefined();
        expect(capturedSignal?.aborted).toBe(false);

        unmount();

        expect(capturedSignal?.aborted).toBe(true);

        await act(async () => {
            resolveLeave();
            await dispatchPromise;
        });
    });

    it('dispatch LEAVE_GAME passes originating token to onLeave callback', async () => {
        let capturedAuthHeader: string | null = null;
        server.use(
            http.post('*/api/room/ROOM123/leave', ({ request }) => {
                capturedAuthHeader = request.headers.get('Authorization');
                return new HttpResponse(null, { status: 204 });
            })
        );
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(capturedAuthHeader).toBe(`Bearer ${tokenA}`);
        expect(onLeave).toHaveBeenCalledWith(tokenA);
    });

    it('dispatch LEAVE_GAME passes originating token to requestLeave callback', async () => {
        const mockRequestLeave = vi.fn().mockResolvedValue(true);
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(session, mockAuth, mockRequestLeave),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_GAME' });
        });

        expect(mockRequestLeave).toHaveBeenCalledWith(tokenA);
    });

    it('dispatch LEAVE_REVIEW passes originating token to onLeave callback', async () => {
        const { result } = renderHook(() => useGameDispatcher(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.dispatch({ type: 'LEAVE_REVIEW' });
        });

        expect(onLeave).toHaveBeenCalledWith(tokenA);
    });

    it('does not invoke onLeave or clear state when auth token changes before fallback leaveRoom completes', async () => {
        let resolveLeave!: () => void;
        let leaveStarted = false;
        server.use(
            http.post('*/api/room/ROOM123/leave', () => {
                leaveStarted = true;
                return new Promise<Response>((resolve) => {
                    resolveLeave = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            })
        );

        let currentAuth = mockAuth;
        const { result, rerender } = renderHook(() => useGameDispatcher(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                createElement(GameProvider, {
                    auth: currentAuth,
                    onLeave,
                    session,
                    children,
                })
            ),
        });

        let dispatchPromise!: Promise<void>;
        act(() => {
            dispatchPromise = result.current.dispatch({ type: 'LEAVE_GAME' });
        });
        await waitFor(() => expect(leaveStarted).toBe(true));

        // While leave is in flight, auth switches to token-b
        currentAuth = { ...mockAuth, token: createMockJwt({ sub: 'token-b' }) };
        rerender();

        await act(async () => {
            resolveLeave();
            await dispatchPromise;
        });

        // Because token changed from tokenA to token-b, isCurrent() returned false,
        // so stale onLeave was NOT called
        expect(onLeave).not.toHaveBeenCalled();
    });
});
