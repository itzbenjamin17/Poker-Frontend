import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { InMemoryTransportAdapter } from '../../services/transport';
import { pokerApi } from '../../services/api';
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
    const session = new GameSession({ auth, transport: new InMemoryTransportAdapter() });
    vi.spyOn(pokerApi, 'getRoomInfo').mockResolvedValue(createValidRoomData({ gameStarted: true }));
    vi.spyOn(pokerApi, 'getPrivateState').mockResolvedValue({ holeCards: ['AS', 'KS'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameProvider auth={auth} session={session} onLeave={onLeave}>{children}</GameProvider>
    );
    return { session, onLeave, wrapper };
}

describe('initial hydration attempt lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('treats a returned null snapshot as a failed load and recovers on retry', async () => {
        const { session, wrapper } = setup();
        vi.spyOn(pokerApi, 'getGameState').mockResolvedValueOnce(null).mockResolvedValue(createValidGameState({ pot: 40 }));
        const { result } = renderHook(() => useSessionHydration(), { wrapper });

        await waitFor(() => expect(result.current.initialLoadFailed).toBe(true));
        expect(session.getSnapshot().isHydrated).toBe(false);
        act(() => result.current.retryInitialLoad());
        await waitFor(() => expect(session.getSnapshot().isHydrated).toBe(true));
        expect(session.getSnapshot().gameState?.pot).toBe(40);
        expect(session.getSnapshot().privateState?.holeCards).toEqual(['AS', 'KS']);
        expect(result.current.initialLoadFailed).toBe(false);
    });

    it.each(['valid', 'invalid', 'rejected'] as const)('ignores an obsolete %s response after the latest retry succeeds', async outcome => {
        const { session, wrapper, onLeave } = setup();
        const obsolete = deferred<unknown>();
        const latest = deferred<unknown>();
        vi.spyOn(pokerApi, 'getGameState')
            .mockResolvedValueOnce(null)
            .mockReturnValueOnce(obsolete.promise)
            .mockReturnValueOnce(latest.promise);
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await waitFor(() => expect(result.current.initialLoadFailed).toBe(true));

        await act(async () => result.current.retryInitialLoad());
        await act(async () => result.current.retryInitialLoad());
        await act(async () => latest.resolve(createValidGameState({ pot: 250 })));
        expect(session.getSnapshot().isHydrated).toBe(true);
        const accepted = session.getSnapshot();

        await act(async () => {
            if (outcome === 'rejected') obsolete.reject({ status: 403 });
            else obsolete.resolve(outcome === 'valid' ? createValidGameState({ pot: 10 }) : null);
        });

        expect(session.getSnapshot()).toBe(accepted);
        expect(result.current.initialLoadFailed).toBe(false);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it.each(['room', 'public', 'private'] as const)('ignores a %s response after unmount', async stage => {
        const { session, wrapper } = setup();
        const pending = deferred<unknown>();
        const getGameState = vi.spyOn(pokerApi, 'getGameState').mockResolvedValue(createValidGameState());
        if (stage === 'room') vi.mocked(pokerApi.getRoomInfo).mockReturnValue(pending.promise as ReturnType<typeof pokerApi.getRoomInfo>);
        if (stage === 'public') getGameState.mockReturnValue(pending.promise);
        if (stage === 'private') vi.mocked(pokerApi.getPrivateState).mockReturnValue(pending.promise);

        const { unmount } = renderHook(() => useSessionHydration(), { wrapper });
        await act(async () => { await Promise.resolve(); });
        if (stage === 'private') expect(session.getSnapshot().gameState).not.toBeNull();
        expect(session.getSnapshot().isHydrated).toBe(false);
        unmount();
        const departed = session.getSnapshot();
        await act(async () => pending.resolve(stage === 'room'
            ? createValidRoomData({ gameStarted: true })
            : stage === 'public' ? createValidGameState({ pot: 250 }) : { holeCards: ['AH', 'KH'] }));

        expect(session.getSnapshot()).toBe(departed);
    });

    it('keeps the latest private cards and cancels an obsolete attempt timeout', async () => {
        vi.useFakeTimers();
        const { session, wrapper, onLeave } = setup();
        const obsoletePrivate = deferred<unknown>();
        vi.spyOn(pokerApi, 'getGameState')
            .mockResolvedValueOnce(createValidGameState({ pot: 10 }))
            .mockResolvedValue(createValidGameState({ pot: 250 }));
        vi.mocked(pokerApi.getPrivateState)
            .mockReturnValueOnce(obsoletePrivate.promise)
            .mockResolvedValue({ holeCards: ['AH', 'KH'] });
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await act(async () => { await Promise.resolve(); });
        expect(session.getSnapshot().gameState?.pot).toBe(10);
        expect(session.getSnapshot().isHydrated).toBe(false);

        await act(async () => result.current.retryInitialLoad());
        const accepted = session.getSnapshot();
        expect(accepted.isHydrated).toBe(true);
        expect(accepted.privateState?.holeCards).toEqual(['AH', 'KH']);
        await act(async () => vi.advanceTimersByTimeAsync(123_000));
        await act(async () => obsoletePrivate.resolve({ holeCards: ['AS', 'KS'] }));

        expect(session.getSnapshot()).toBe(accepted);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('keeps retrying an upstream HTTP 502 as a network failure', async () => {
        vi.useFakeTimers();
        const { session, wrapper } = setup();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(pokerApi, 'getGameState')
            .mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { status: 502 }))
            .mockResolvedValue(createValidGameState({ pot: 80 }));
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await act(async () => { await Promise.resolve(); });
        expect(result.current.initialLoadFailed).toBe(false);
        expect(session.getSnapshot().isHydrated).toBe(false);
        await act(async () => vi.advanceTimersByTimeAsync(1500));
        expect(session.getSnapshot().isHydrated).toBe(true);
        expect(session.getSnapshot().gameState?.pot).toBe(80);
        expect(console.warn).not.toHaveBeenCalled();
    });
});
