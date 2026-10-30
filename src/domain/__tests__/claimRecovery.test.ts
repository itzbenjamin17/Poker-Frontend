import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import { pokerApi } from '../../services/api';
import { createMockJwt, createValidGameState } from '../../test/fixtures';
import type { GameEndResult } from '../../types';
import { SESSION_SEAT_GONE } from '../../constants/strings';

const sessions: GameSession[] = [];

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}

function setup() {
    const auth = { token: createMockJwt(), roomId: 'claim-room', playerName: 'Hero', message: '' };
    const transport = new InMemoryTransportAdapter();
    const clock = new TestClock(1000);
    const result: GameEndResult = {
        gameId: auth.roomId, winnerName: auth.playerName, winnerChips: 1000,
        isForfeit: true, message: 'Hero wins!',
    };
    const api = {
        ...pokerApi,
        claimWin: vi.fn<typeof pokerApi.claimWin>().mockRejectedValue(new TypeError('Claim response lost')),
        getReview: vi.fn<typeof pokerApi.getReview>().mockRejectedValue({ status: 503 }),
        getRoomData: vi.fn<typeof pokerApi.getRoomData>(),
        getPublicGameState: vi.fn<typeof pokerApi.getPublicGameState>(),
        getPrivatePlayerState: vi.fn<typeof pokerApi.getPrivatePlayerState>(),
    };
    const session = new GameSession({
        auth, transport, clock, pokerApi: api,
        initialRoomState: { roomId: auth.roomId, gameStarted: true },
        initialGameState: createValidGameState({
            gameId: auth.roomId, handNumber: 1, stateRevision: 1,
            players: [{ id: 'hero-id', name: auth.playerName }],
        }),
    });
    sessions.push(session);
    session.setHydrated(true);
    session.connect();
    return { api, auth, clock, session, transport, result };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function exhaust(clock: TestClock) {
    for (let i = 0; i < 3; i++) {
        clock.tick(9000);
        await flush();
    }
}

afterEach(() => {
    sessions.splice(0).forEach(session => session.dispose());
    vi.restoreAllMocks();
});

describe('claim review recovery ownership', () => {
    it.each([404, 409, 503])('bounds review %i to four reads and manual Retry resumes review after pending clears', async status => {
        const { api, auth, clock, session, result } = setup();
        api.getReview.mockRejectedValue({ status });
        await session.claimWin(auth.roomId);
        expect(api.getReview).toHaveBeenCalledOnce();
        expect(session.getSnapshot().claimPending).toBe(true);
        clock.tick(999);
        await flush();
        expect(api.getReview).toHaveBeenCalledOnce();
        await exhaust(clock);

        expect(api.getReview).toHaveBeenCalledTimes(4);
        expect(session.getSnapshot()).toMatchObject({ claimPending: false, recoveryFailed: true, isGameOver: false });
        expect(session.hasPendingRecoveryTimer()).toBe(false);
        clock.tick(60_000);
        await flush();
        expect(api.getReview).toHaveBeenCalledTimes(4);

        api.getReview.mockResolvedValue(result);
        session.retryConnection();
        await flush();

        expect(api.getReview).toHaveBeenCalledTimes(5);
        expect(api.claimWin).toHaveBeenCalledOnce();
        expect(api.getPublicGameState).not.toHaveBeenCalled();
        expect(api.getRoomData).not.toHaveBeenCalled();
        expect(session.getSnapshot()).toMatchObject({
            isGameOver: true, claimPending: false, recoveryFailed: false, gameEndResult: { message: result.message },
        });
    });

    it('lets GAME_END win over a deferred HTTP review and aborts the losing request', async () => {
        const { api, auth, session, transport, result } = setup();
        const pending = deferred<GameEndResult>();
        api.getReview.mockReturnValue(pending.promise);
        const claiming = session.claimWin(auth.roomId);
        await flush();
        const signal = api.getReview.mock.calls[0][2] as AbortSignal | undefined;

        transport.simulateMessage('/game/claim-room', {
            type: 'GAME_END', gameId: auth.roomId, winner: auth.playerName,
            winnerChips: 1000, isForfeit: true, message: 'Socket terminal result',
        });
        expect(signal?.aborted).toBe(true);
        const accepted = session.getSnapshot();
        pending.resolve(result);
        await claiming;

        expect(session.getSnapshot()).toBe(accepted);
        expect(session.getSnapshot().gameEndResult?.message).toBe('Socket terminal result');
        expect(session.hasPendingRecoveryTimer()).toBe(false);
    });

    it('aborts a deferred review on disposal and ignores a late success that disregards abort', async () => {
        const { api, auth, session, result } = setup();
        const pending = deferred<GameEndResult>();
        api.getReview.mockReturnValue(pending.promise);
        const claiming = session.claimWin(auth.roomId);
        await flush();
        const signal = api.getReview.mock.calls[0][2] as AbortSignal | undefined;
        session.dispose();
        expect(signal?.aborted).toBe(true);
        const disposed = session.getSnapshot();
        pending.resolve(result);
        await claiming;

        expect(session.getSnapshot()).toBe(disposed);
        expect(session.getSnapshot().isGameOver).toBe(false);
    });

    it('invalidates an old review during leave and restarts review with a fresh budget when leave fails', async () => {
        const { api, auth, clock, session, result } = setup();
        const pending = deferred<GameEndResult>();
        api.getReview.mockReturnValueOnce(pending.promise);
        const claiming = session.claimWin(auth.roomId);
        await flush();
        const signal = api.getReview.mock.calls[0][2] as AbortSignal | undefined;
        session.setPendingLeave(true);
        expect(signal?.aborted).toBe(true);
        pending.resolve(result);
        await claiming;
        expect(session.getSnapshot().isGameOver).toBe(false);

        session.setPendingLeave(false);
        await flush();
        expect(api.getReview).toHaveBeenCalledTimes(2);
        expect(api.getPublicGameState).not.toHaveBeenCalled();
        await exhaust(clock);
        expect(api.getReview).toHaveBeenCalledTimes(5);
        expect(session.getSnapshot()).toMatchObject({ claimPending: false, recoveryFailed: true });
    });

    it('invalidates a pending claim POST when leave starts, even if leave subsequently fails', async () => {
        const { api, auth, session, result } = setup();
        const pending = deferred<{ message: string; data: GameEndResult }>();
        api.claimWin.mockReturnValue(pending.promise);
        const claiming = session.claimWin(auth.roomId);
        const signal = api.claimWin.mock.calls[0][2];
        session.setPendingLeave(true);
        expect(signal?.aborted).toBe(true);
        session.setPendingLeave(false);
        await flush();
        expect(api.getReview).toHaveBeenCalledOnce();
        pending.resolve({ message: 'Late original response', data: result });
        await claiming;

        expect(session.getSnapshot().isGameOver).toBe(false);
        expect(session.hasPendingRecoveryTimer()).toBe(true);
    });

    it.each(['claim', 'review'] as const)('emits token-specific auth expiry for %s 401 and never retries', async source => {
        const { api, auth, clock, session } = setup();
        if (source === 'claim') api.claimWin.mockRejectedValue({ status: 401 });
        else api.getReview.mockRejectedValue({ status: 401 });
        const onExpiry = vi.fn();
        window.addEventListener('auth-expired', onExpiry);
        try {
            await session.claimWin(auth.roomId);
            clock.tick(60_000);
            await flush();
            expect(onExpiry).toHaveBeenCalledOnce();
            expect((onExpiry.mock.calls[0][0] as CustomEvent).detail).toEqual({ token: auth.token });
            expect(api.claimWin).toHaveBeenCalledOnce();
            expect(api.getReview).toHaveBeenCalledTimes(source === 'claim' ? 0 : 1);
            expect(session.hasPendingRecoveryTimer()).toBe(false);
        } finally {
            window.removeEventListener('auth-expired', onExpiry);
        }
    });

    it('treats review 403 as a definite lost seat without another retry', async () => {
        const { api, auth, clock, session } = setup();
        api.getReview.mockRejectedValue({ status: 403 });
        await session.claimWin(auth.roomId);

        expect(session.getSnapshot()).toMatchObject({
            claimPending: false, notification: SESSION_SEAT_GONE, recoveryFailed: false,
        });
        clock.tick(60_000);
        await flush();
        expect(api.getReview).toHaveBeenCalledOnce();
        expect(session.hasPendingRecoveryTimer()).toBe(false);
    });

    it('directly transitions session to review state on successful claim-win response without STOMP frame', async () => {
        const { api, auth, session, result } = setup();
        const setGameEndResultSpy = vi.spyOn(session, 'setGameEndResult');
        const installTerminalResultSpy = vi.spyOn(session, 'installTerminalResult');

        api.claimWin.mockResolvedValueOnce({
            message: 'Win claimed successfully',
            data: result,
        });

        await session.claimWin(auth.roomId);

        expect(api.claimWin).toHaveBeenCalledWith(auth.roomId, auth.token, expect.any(AbortSignal));
        expect(installTerminalResultSpy).toHaveBeenCalledWith(result);
        expect(setGameEndResultSpy).toHaveBeenCalledWith(result);
        expect(api.getReview).not.toHaveBeenCalled();

        const snapshot = session.getSnapshot();
        expect(snapshot.isGameOver).toBe(true);
        expect(snapshot.claimPending).toBe(false);
        expect(snapshot.isRecovering).toBe(false);
        expect(snapshot.gameEndResult).toMatchObject({
            gameId: auth.roomId,
            winnerName: auth.playerName,
            isForfeit: true,
            message: 'Hero wins!',
        });
    });

    it('recovers terminal game review from getReview when public state polling encounters HTTP 404', async () => {
        const { api, auth, session, result } = setup();
        const setGameEndResultSpy = vi.spyOn(session, 'setGameEndResult');

        api.getPublicGameState.mockRejectedValueOnce({ status: 404 });
        api.getPrivatePlayerState.mockRejectedValueOnce({ status: 404 });
        api.getReview.mockResolvedValueOnce(result);

        await session.synchronizeSession({ resetBudget: true });

        expect(api.getPublicGameState).toHaveBeenCalled();
        expect(api.getReview).toHaveBeenCalledWith(auth.roomId, auth.token, expect.any(AbortSignal));
        expect(setGameEndResultSpy).toHaveBeenCalled();

        const snapshot = session.getSnapshot();
        expect(snapshot.isGameOver).toBe(true);
        expect(snapshot.gameEndResult).toMatchObject({
            gameId: auth.roomId,
            winnerName: auth.playerName,
            message: 'Hero wins!',
        });
        expect(session.hasPendingRecoveryTimer()).toBe(false);
    });
});
