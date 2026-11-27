import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLobbyRequest } from '../useLobbyRequest';
import type { LobbyRequestLock } from '../useLobbyRequest';
import type { AuthResponse } from '../../../types';
import { ERROR_MALFORMED_RESPONSE } from '../../../constants/strings';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('useLobbyRequest', () => {
    const onAuth = vi.fn();
    const onError = vi.fn();
    const setLoading = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const validAuth: AuthResponse = {
        token: 'valid.token.jwt',
        roomId: 'room-1',
        playerName: 'Alice',
    };

    it('invokes onAuth on successful request and keeps submission locked during transition', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result, unmount } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(async () => validAuth, 'Fallback error');
        });

        expect(onAuth).toHaveBeenCalledWith(validAuth);
        expect(onError).not.toHaveBeenCalled();
        expect(setLoading).toHaveBeenCalledWith(true);
        expect(setLoading).toHaveBeenCalledWith(false);
        expect(result.current.pending).toBe(false);
        expect(result.current.isBusy()).toBe(true);

        const secondRequest = vi.fn(async () => validAuth);
        await act(async () => {
            await result.current.run(secondRequest, 'Fallback error');
        });
        expect(secondRequest).not.toHaveBeenCalled();

        unmount();
    });

    it('blocks concurrent calls while a request is pending and allows retry after rejection', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const pendingRequest = deferred<AuthResponse>();
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        let firstRun!: Promise<void>;
        act(() => {
            firstRun = result.current.run(() => pendingRequest.promise, 'Fallback error');
        });

        expect(result.current.pending).toBe(true);
        expect(result.current.isBusy()).toBe(true);
        expect(setLoading).toHaveBeenLastCalledWith(true);

        const concurrentRequest = vi.fn(async () => validAuth);
        await act(async () => {
            await result.current.run(concurrentRequest, 'Fallback error');
        });
        expect(concurrentRequest).not.toHaveBeenCalled();

        await act(async () => {
            pendingRequest.reject(new Error('   \t\n   '));
            await firstRun;
        });

        expect(onError).toHaveBeenCalledWith('Fallback error');
        expect(onAuth).not.toHaveBeenCalled();
        expect(result.current.pending).toBe(false);
        expect(result.current.isBusy()).toBe(false);
        expect(setLoading).toHaveBeenLastCalledWith(false);

        await act(async () => {
            await result.current.run(async () => validAuth, 'Fallback error');
        });
        expect(onAuth).toHaveBeenCalledWith(validAuth);
    });

    it('uses onRejected custom mapping when provided and normalizes fallback messages', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(
                async () => {
                    throw new Error('Raw server failure');
                },
                'Custom fallback',
                () => 'Mapped conflict message'
            );
        });

        expect(onError).toHaveBeenCalledWith('Mapped conflict message');
        expect(result.current.isBusy()).toBe(false);

        await act(async () => {
            await result.current.run(
                async () => {
                    throw 'non-error rejection';
                },
                'Custom fallback',
                () => undefined
            );
        });

        expect(onError).toHaveBeenCalledWith('Custom fallback');
        expect(result.current.isBusy()).toBe(false);
    });

    it('aborts the active signal on unmount and suppresses late callbacks', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const pendingSuccess = deferred<AuthResponse>();
        let capturedSignal: AbortSignal | undefined;

        const { result, unmount } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        let runPromise!: Promise<void>;
        act(() => {
            runPromise = result.current.run((signal) => {
                capturedSignal = signal;
                return pendingSuccess.promise;
            }, 'Fallback error');
        });

        expect(capturedSignal?.aborted).toBe(false);
        unmount();
        expect(capturedSignal?.aborted).toBe(true);

        const nextMount = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );
        expect(nextMount.result.current.isBusy()).toBe(false);

        await act(async () => {
            pendingSuccess.resolve(validAuth);
            await runPromise;
        });

        expect(onAuth).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        nextMount.unmount();
    });

    it('rejects malformed auth responses and releases the lock for retry', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        const malformed = {
            token: 'valid.jwt.token',
            roomId: 'room-1',
            playerName: '',
        } as unknown as AuthResponse;

        await act(async () => {
            await result.current.run(async () => malformed, 'Fallback error');
        });

        expect(onAuth).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(ERROR_MALFORMED_RESPONSE);
        expect(result.current.isBusy()).toBe(false);

        await act(async () => {
            await result.current.run(async () => validAuth, 'Fallback error');
        });
        expect(onAuth).toHaveBeenCalledWith(validAuth);
    });
});
