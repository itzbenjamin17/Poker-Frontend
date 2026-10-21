import { createElement, type ReactNode } from 'react';
import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionHydration } from '../useSessionHydration';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import { pokerApi } from '../../services/api';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';
import { SESSION_EXPIRED, SESSION_SEAT_GONE } from '../../constants/strings';
import type { RoomDataResponse, SessionSnapshot } from '../../types';

const sessions: GameSession[] = [];

function setup(started = false) {
    const auth = { token: createMockJwt(), roomId: 'ROOM123', playerName: 'TestPlayer', message: 'Success' };
    const room = createValidRoomData({
        roomId: auth.roomId, gameStarted: started,
        players: [{ name: auth.playerName, isHost: true, joinedAt: '2026-05-22T00:00:00Z' }],
    });
    const publicState = createValidGameState({
        gameId: auth.roomId, handNumber: 1, stateRevision: 1,
        players: [{ id: 'hero-id', name: auth.playerName }],
    });
    const privateState = { playerId: 'hero-id', handNumber: 1, holeCards: ['AS', 'KS'] };
    const review = {
        gameId: auth.roomId, winnerName: auth.playerName, winnerChips: 1000,
        isForfeit: false, message: 'Game Over',
    };
    const api = {
        ...pokerApi,
        getRoomData: vi.fn<typeof pokerApi.getRoomData>().mockResolvedValue(room),
        getPublicGameState: vi.fn<typeof pokerApi.getPublicGameState>().mockResolvedValue(publicState),
        getPrivatePlayerState: vi.fn<typeof pokerApi.getPrivatePlayerState>().mockResolvedValue(privateState),
        getReview: vi.fn<typeof pokerApi.getReview>().mockResolvedValue(review),
    };
    const clock = new TestClock();
    const onLeave = vi.fn();
    const session = new GameSession({ auth, transport: new InMemoryTransportAdapter(), clock, pokerApi: api, onLeave });
    sessions.push(session);
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(GameProvider, { auth, session, onLeave, children });
    }
    return { api, auth, clock, onLeave, session, wrapper, privateState, room };
}

async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
    });
}

async function exhaustRetries(clock: TestClock) {
    await settle();
    for (let i = 0; i < 3; i++) {
        await act(async () => {
            clock.tick(9000);
            for (let j = 0; j < 8; j++) await Promise.resolve();
        });
    }
}

afterEach(() => {
    cleanup();
    sessions.splice(0).forEach(session => session.dispose());
    vi.restoreAllMocks();
});

describe('useSessionHydration through the session coordinator', () => {
    it('hydrates a validated lobby without fetching game state', async () => {
        const { api, auth, session, wrapper } = setup();
        renderHook(() => useSessionHydration(), { wrapper });
        await settle();

        expect(api.getRoomData).toHaveBeenCalledWith(auth.roomId, auth.token, expect.any(AbortSignal));
        expect(api.getPublicGameState).not.toHaveBeenCalled();
        expect(session.getSnapshot()).toMatchObject({
            isHydrated: true, loadingStatus: 'Connected.', roomState: { roomId: auth.roomId, gameStarted: false },
        });
    });

    it('publishes the started public/private pair and hydration state together', async () => {
        const { api, session, wrapper } = setup(true);
        const observed: SessionSnapshot[] = [];
        const unsubscribe = session.subscribe(() => observed.push(session.getSnapshot()));
        renderHook(() => useSessionHydration(), { wrapper });
        await settle();
        unsubscribe();

        expect(api.getPublicGameState).toHaveBeenCalledOnce();
        expect(api.getPrivatePlayerState).toHaveBeenCalledOnce();
        const liveEmissions = observed.filter(snapshot => snapshot.gameState !== null);
        expect(liveEmissions).toHaveLength(1);
        expect(liveEmissions[0]).toMatchObject({
            isHydrated: true, gameState: { handNumber: 1 }, privateState: { holeCards: ['AS', 'KS'] },
        });
    });

    it('bounds initial attempts to four and manual Retry resets the budget before WebSocket connection', async () => {
        const { api, clock, session, wrapper, room } = setup();
        api.getRoomData.mockRejectedValue({ status: 503 });
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await exhaustRetries(clock);

        expect(api.getRoomData).toHaveBeenCalledTimes(4);
        expect(result.current.initialLoadFailed).toBe(true);
        expect(session.getSnapshot()).toMatchObject({ isHydrated: false, recoveryFailed: true });
        expect(session.getSnapshot().loadingStatus).not.toBe('Connected.');

        api.getRoomData.mockResolvedValue(room);
        act(() => result.current.retryInitialLoad());
        await settle();
        expect(api.getRoomData).toHaveBeenCalledTimes(5);
        expect(result.current.initialLoadFailed).toBe(false);
        expect(session.getSnapshot()).toMatchObject({ isHydrated: true, recoveryFailed: false });
    });

    it.each([
        { holeCards: ['AS', 'KS'], handNumber: 1 },
        { playerId: 'hero-id', holeCards: ['AS', 'KS'] },
        { playerId: 'hero-id', handNumber: 2, holeCards: ['AS', 'KS'] },
        { playerId: 'someone-else', handNumber: 1, holeCards: ['AS', 'KS'] },
        { playerId: 'hero-id', handNumber: 1, holeCards: ['AS'] },
        { playerId: 'hero-id', handNumber: 1, holeCards: ['BAD', 'KS'] },
    ])('never hydrates or commits either slice for invalid private data: %j', async privateData => {
        const { api, clock, session, wrapper, onLeave } = setup(true);
        api.getPrivatePlayerState.mockResolvedValue(privateData);
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await exhaustRetries(clock);

        expect(api.getPrivatePlayerState).toHaveBeenCalledTimes(4);
        expect(session.getSnapshot()).toMatchObject({
            gameState: null, privateState: null, isHydrated: false, recoveryFailed: true,
        });
        expect(result.current.initialLoadFailed).toBe(true);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('retries malformed Room membership instead of treating it as a lost seat', async () => {
        const { api, clock, session, wrapper, onLeave, room } = setup();
        api.getRoomData.mockResolvedValue({
            ...room, players: [{ name: 'Someone Else', isHost: 'invalid' }],
        } as unknown as RoomDataResponse);
        renderHook(() => useSessionHydration(), { wrapper });
        await exhaustRetries(clock);

        expect(api.getRoomData).toHaveBeenCalledTimes(4);
        expect(session.getSnapshot()).toMatchObject({ isHydrated: false, recoveryFailed: true });
        expect(api.getReview).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('aborts an unmounted private fetch and ignores a response that disregards cancellation', async () => {
        const { api, session, wrapper, privateState } = setup(true);
        let resolvePrivate!: (value: unknown) => void;
        api.getPrivatePlayerState.mockReturnValue(new Promise(resolve => { resolvePrivate = resolve; }));
        const { unmount } = renderHook(() => useSessionHydration(), { wrapper });
        await settle();
        expect(api.getPrivatePlayerState).toHaveBeenCalledOnce();
        const signal = api.getPrivatePlayerState.mock.calls[0][2];
        expect(signal?.aborted).toBe(false);
        unmount();
        expect(signal?.aborted).toBe(true);
        const afterUnmount = session.getSnapshot();
        resolvePrivate(privateState);
        await settle();
        expect(session.getSnapshot()).toBe(afterUnmount);
        expect(session.getSnapshot().isHydrated).toBe(false);
    });

    it.each(['room', 'public', 'private'] as const)('installs terminal review after a %s 404', async source => {
        const { api, session, wrapper, onLeave } = setup(source !== 'room');
        if (source === 'room') api.getRoomData.mockRejectedValue({ status: 404 });
        if (source === 'public') api.getPublicGameState.mockRejectedValue({ status: 404 });
        if (source === 'private') api.getPrivatePlayerState.mockRejectedValue({ status: 404 });
        renderHook(() => useSessionHydration(), { wrapper });
        await settle();

        expect(api.getReview).toHaveBeenCalledOnce();
        expect(session.getSnapshot()).toMatchObject({
            isGameOver: true, isHydrated: true, gameEndResult: { winnerName: 'TestPlayer' },
        });
        expect(onLeave).not.toHaveBeenCalled();
    });

    it.each([
        [403, 404, SESSION_SEAT_GONE], [403, 409, SESSION_SEAT_GONE],
        [404, 404, SESSION_EXPIRED], [404, 409, SESSION_EXPIRED],
        [404, 403, SESSION_SEAT_GONE],
    ] as const)('honors original %i when terminal review returns %i', async (original, reviewStatus, message) => {
        const { api, clock, session, wrapper, onLeave } = setup();
        api.getRoomData.mockRejectedValue({ status: original });
        api.getReview.mockRejectedValue({ status: reviewStatus });
        renderHook(() => useSessionHydration(), { wrapper });
        await settle();

        expect(session.getSnapshot().notification).toBe(message);
        expect(session.getSnapshot().isHydrated).toBe(false);
        expect(onLeave).not.toHaveBeenCalled();
        act(() => clock.tick(3000));
        expect(onLeave).toHaveBeenCalledOnce();
        expect(api.getRoomData).toHaveBeenCalledOnce();
    });

    it.each(['transient', 'malformed'] as const)('bounds %s review recovery without discarding auth or redirecting', async outcome => {
        const { api, auth, clock, session, wrapper, onLeave } = setup();
        api.getRoomData.mockRejectedValue({ status: 404 });
        if (outcome === 'transient') api.getReview.mockRejectedValue({ status: 500 });
        else api.getReview.mockResolvedValue({ message: 'Missing terminal fields' } as never);
        const { result } = renderHook(() => useSessionHydration(), { wrapper });
        await exhaustRetries(clock);

        expect(api.getReview).toHaveBeenCalledTimes(4);
        expect(result.current.initialLoadFailed).toBe(true);
        expect(session.getSnapshot()).toMatchObject({ isHydrated: false, gameEndResult: null });
        expect(api.getRoomData.mock.calls.every(call => call[1] === auth.token)).toBe(true);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('emits token-specific auth expiry once without scheduling another initial attempt', async () => {
        const { api, auth, clock, session, wrapper } = setup();
        const onExpiry = vi.fn();
        window.addEventListener('auth-expired', onExpiry);
        try {
            api.getRoomData.mockRejectedValue({ status: 401 });
            renderHook(() => useSessionHydration(), { wrapper });
            await settle();
            act(() => clock.tick(30_000));

            expect(onExpiry).toHaveBeenCalledOnce();
            expect((onExpiry.mock.calls[0][0] as CustomEvent).detail).toEqual({ token: auth.token });
            expect(api.getRoomData).toHaveBeenCalledOnce();
            expect(session.getSnapshot().isHydrated).toBe(false);
        } finally {
            window.removeEventListener('auth-expired', onExpiry);
        }
    });
});
