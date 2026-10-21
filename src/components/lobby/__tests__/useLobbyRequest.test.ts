import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLobbyRequest } from '../useLobbyRequest';
import type { LobbyRequestLock } from '../useLobbyRequest';
import type { AuthResponse } from '../../../types';
import { ERROR_MALFORMED_RESPONSE, ERROR_TECHNICAL, ERROR_SYSTEM, ERROR_INVALID_FORMAT } from '../../../constants/strings';

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
        message: 'Success',
    };

    it('invokes onAuth on successful request and locks during transition', async () => {
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
        // Lock remains held after auth to prevent double-submit while unmounting
        expect(requestLock.current).not.toBeNull();
        unmount();
    });

    it('normalizes non-API Error with HTML markup and releases lock for retry', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(async () => {
                throw new Error('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>');
            }, 'Fallback error');
        });

        expect(onError).toHaveBeenCalledWith(ERROR_TECHNICAL);
        expect(onAuth).not.toHaveBeenCalled();
        expect(requestLock.current).toBeNull();
        expect(result.current.isBusy()).toBe(false);

        // Retry succeeds
        await act(async () => {
            await result.current.run(async () => validAuth, 'Fallback error');
        });
        expect(onAuth).toHaveBeenCalledWith(validAuth);
    });

    it('normalizes non-API Error with stack trace to system copy', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(async () => {
                throw new Error('java.lang.NullPointerException at com.pokergame.Lobby');
            }, 'Fallback error');
        });

        expect(onError).toHaveBeenCalledWith(ERROR_SYSTEM);
        expect(requestLock.current).toBeNull();
    });

    it('normalizes non-API Error with embedded JSON to format copy', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(async () => {
                throw new Error('{"status": 500, "error": "Internal"}');
            }, 'Fallback error');
        });

        expect(onError).toHaveBeenCalledWith(ERROR_INVALID_FORMAT);
        expect(requestLock.current).toBeNull();
    });

    it('falls back to fallback error message when error message is empty or whitespace-only', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        await act(async () => {
            await result.current.run(async () => {
                throw new Error('   \t\n   ');
            }, 'Custom fallback');
        });

        expect(onError).toHaveBeenCalledWith('Custom fallback');
        expect(requestLock.current).toBeNull();
    });

    it('rejects malformed auth responses and calls onError with malformed response copy', async () => {
        const requestLock: LobbyRequestLock = { current: null };
        const { result } = renderHook(() =>
            useLobbyRequest({ requestLock, onAuth, onError, setLoading })
        );

        const malformed = {
            token: 'valid-token',
            roomId: 'room-1',
            playerName: '',
            message: 'ok',
        } as unknown as AuthResponse;

        await act(async () => {
            await result.current.run(async () => malformed, 'Fallback error');
        });

        expect(onAuth).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(ERROR_MALFORMED_RESPONSE);
        expect(requestLock.current).toBeNull();
    });
});
