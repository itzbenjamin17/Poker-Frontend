import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import { createValidGameState, createValidRoomData, mockAuth } from '../../test/fixtures';
import { useSessionHydration } from '../useSessionHydration';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function setup() {
    const auth = { ...mockAuth };
    const onLeave = vi.fn();
    const clock = new TestClock(1000);
    const session = new GameSession({ auth, transport: new InMemoryTransportAdapter(), clock });
    server.use(
        http.get('*/api/room/:roomId', () => HttpResponse.json(createValidRoomData({ gameStarted: true }))),
        http.get('*/api/game/:gameId/private-state', () =>
            HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AS', 'KS'] })
        )
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameProvider auth={auth} session={session} onLeave={onLeave}>{children}</GameProvider>
    );
    return { session, clock, onLeave, wrapper };
}

async function flushAsync() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initial hydration attempt lifecycle', () => {
    it('recovers from an empty public snapshot through the session retry workflow', async () => {
        const { session, clock, wrapper } = setup();
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/:gameId/state', () => {
                publicCalls += 1;
                if (publicCalls === 1) {
                    return HttpResponse.json({});
                }
                return HttpResponse.json(createValidGameState({ pot: 40 }));
            })
        );
        const { result } = renderHook(() => useSessionHydration(), { wrapper });

        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));

        act(() => {
            clock.tick(2000);
        });

        await waitFor(() => expect(session.getSnapshot().isHydrated).toBe(true));
        expect(session.getSnapshot().gameState?.pot).toBe(40);
        expect(session.getSnapshot().privateState?.holeCards).toEqual(['AS', 'KS']);
        expect(result.current.initialLoadFailed).toBe(false);
    });

    it.each(['valid', 'invalid', 'rejected'] as const)('ignores an obsolete %s response after the latest retry succeeds', async outcome => {
        const { session, wrapper, onLeave } = setup();
        const obsolete = deferred<Response>();
        const latest = deferred<Response>();
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/:gameId/state', () => {
                publicCalls += 1;
                return publicCalls === 1 ? obsolete.promise : latest.promise;
            })
        );

        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await waitFor(() => expect(publicCalls).toBe(1));

        act(() => {
            result.current.retryInitialLoad();
        });
        await waitFor(() => expect(publicCalls).toBe(2));

        latest.resolve(HttpResponse.json(createValidGameState({ pot: 250 })));
        await waitFor(() => expect(session.getSnapshot().isHydrated).toBe(true));
        const accepted = session.getSnapshot();

        await act(async () => {
            if (outcome === 'rejected') {
                obsolete.resolve(HttpResponse.json({ detail: 'Forbidden' }, { status: 403 }));
            } else {
                obsolete.resolve(HttpResponse.json(outcome === 'valid' ? createValidGameState({ pot: 10 }) : {}));
            }
            await flushAsync();
        });

        expect(session.getSnapshot()).toBe(accepted);
        expect(result.current.initialLoadFailed).toBe(false);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it.each(['room', 'public', 'private'] as const)('ignores a %s response after unmount', async stage => {
        const { session, wrapper } = setup();
        const pending = deferred<Response>();
        let stageEntered = false;
        server.use(
            http.get('*/api/room/:roomId', () => {
                if (stage === 'room') {
                    stageEntered = true;
                    return pending.promise;
                }
                return HttpResponse.json(createValidRoomData({ gameStarted: true }));
            }),
            http.get('*/api/game/:gameId/state', () => {
                if (stage === 'public') {
                    stageEntered = true;
                    return pending.promise;
                }
                return HttpResponse.json(createValidGameState());
            }),
            http.get('*/api/game/:gameId/private-state', () => {
                if (stage === 'private') {
                    stageEntered = true;
                    return pending.promise;
                }
                return HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AS', 'KS'] });
            })
        );

        const { unmount } = renderHook(() => useSessionHydration(), { wrapper });
        await waitFor(() => expect(stageEntered).toBe(true));
        if (stage === 'private') expect(session.getSnapshot().gameState).toBeNull();
        expect(session.getSnapshot().isHydrated).toBe(false);

        unmount();
        const departed = session.getSnapshot();
        await act(async () => {
            if (stage === 'room') {
                pending.resolve(HttpResponse.json(createValidRoomData({ gameStarted: true })));
            } else if (stage === 'public') {
                pending.resolve(HttpResponse.json(createValidGameState({ pot: 250 })));
            } else {
                pending.resolve(HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AH', 'KH'] }));
            }
            await flushAsync();
        });

        expect(session.getSnapshot()).toBe(departed);
    });

    it('keeps the latest private cards and cancels an obsolete attempt timeout', async () => {
        const { session, clock, wrapper, onLeave } = setup();
        const obsoletePrivate = deferred<Response>();
        let publicCalls = 0;
        let privateCalls = 0;
        server.use(
            http.get('*/api/game/:gameId/state', () => {
                publicCalls += 1;
                return HttpResponse.json(createValidGameState({ pot: publicCalls === 1 ? 10 : 250 }));
            }),
            http.get('*/api/game/:gameId/private-state', () => {
                privateCalls += 1;
                if (privateCalls === 1) {
                    return obsoletePrivate.promise;
                }
                return HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AH', 'KH'] });
            })
        );

        renderHook(() => useSessionHydration(), { wrapper });
        await waitFor(() => expect(privateCalls).toBe(1));
        expect(session.getSnapshot().gameState).toBeNull();
        expect(session.getSnapshot().isHydrated).toBe(false);

        await act(async () => {
            await session.synchronizeSession({ resetBudget: true });
        });
        const accepted = session.getSnapshot();
        expect(accepted.isHydrated).toBe(true);
        expect(accepted.privateState?.holeCards).toEqual(['AH', 'KH']);

        act(() => {
            clock.tick(123_000);
        });
        await act(async () => {
            obsoletePrivate.resolve(HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AS', 'KS'] }));
            await flushAsync();
        });

        expect(session.getSnapshot()).toBe(accepted);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('keeps retrying an upstream HTTP 502 as a network failure', async () => {
        const { session, clock, wrapper } = setup();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let publicCalls = 0;
        server.use(
            http.get('*/api/game/:gameId/state', () => {
                publicCalls += 1;
                if (publicCalls === 1) {
                    return HttpResponse.json({ detail: 'Bad gateway' }, { status: 502 });
                }
                return HttpResponse.json(createValidGameState({ pot: 80 }));
            })
        );

        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await waitFor(() => expect(publicCalls).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));
        expect(result.current.initialLoadFailed).toBe(false);
        expect(session.getSnapshot().isHydrated).toBe(false);

        act(() => {
            clock.tick(1500);
        });

        await waitFor(() => expect(session.getSnapshot().isHydrated).toBe(true));
        expect(session.getSnapshot().gameState?.pot).toBe(80);
        expect(console.warn).toHaveBeenCalledTimes(1);
    });
});
