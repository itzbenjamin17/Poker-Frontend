import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function toBase64Url(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(payload: Record<string, unknown>): string {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const pl = toBase64Url(JSON.stringify(payload));
    return `${header}.${pl}.fake-signature`;
}

describe('useAuthSession', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it('returns null auth when no session is stored', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
    });

    it('returns parsed auth object when valid session is stored', async () => {
        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-1',
            playerName: 'Alice',
            message: 'Success',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);
    });

    it('clears storage and returns null auth when stored JWT is expired', async () => {
        const expiredAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }),
            roomId: 'room-1',
            playerName: 'Alice',
            message: 'Success',
        };
        localStorage.setItem('poker-auth', JSON.stringify(expiredAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when storage has invalid shape', async () => {
        localStorage.setItem('poker-auth', JSON.stringify({ token: '', roomId: 'room-1' }));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('writes to localStorage when setAuth is called', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        const newAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-2',
            playerName: 'Bob',
            message: 'Joined',
        };

        act(() => {
            result.current.setAuth(newAuth);
        });

        expect(result.current.auth).toEqual(newAuth);
        expect(JSON.parse(localStorage.getItem('poker-auth')!)).toEqual(newAuth);
    });

    it('removes from localStorage and resets state when clearAuth is called', async () => {
        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-3',
            playerName: 'Charlie',
            message: 'Ok',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);

        act(() => {
            result.current.clearAuth();
        });

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('updates auth to null on cross-tab storage event when auth is cleared', async () => {
        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-4',
            playerName: 'Dave',
            message: 'Ok',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);

        act(() => {
            localStorage.removeItem('poker-auth');
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'poker-auth',
                newValue: null,
            }));
        });

        expect(result.current.auth).toBeNull();
    });

    it('clears auth and localStorage on a token-scoped auth-expired window event', async () => {
        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-5',
            playerName: 'Eve',
            message: 'Ok',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);

        act(() => {
            window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: validAuth.token } }));
        });

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('ignores an auth-expired race for a stale token', async () => {
        const currentAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, session: 'current' }),
            roomId: 'room-current',
            playerName: 'Current Player',
            message: 'Ok',
        };
        const staleToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, session: 'stale' });
        localStorage.setItem('poker-auth', JSON.stringify(currentAuth));
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        act(() => {
            window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: staleToken } }));
        });

        expect(result.current.auth).toEqual(currentAuth);
        expect(JSON.parse(localStorage.getItem('poker-auth')!)).toEqual(currentAuth);
    });

    it('clears auth when a storage event with a null key signals storage.clear()', async () => {
        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-clear',
            playerName: 'Clear Test',
            message: 'Ok',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        act(() => {
            localStorage.clear();
            window.dispatchEvent(new StorageEvent('storage', { key: null }));
        });

        expect(result.current.auth).toBeNull();
    });

    it('survives localStorage SecurityError and QuotaExceededError while keeping auth state in memory', async () => {
        const { useAuthSession } = await import('../useAuthSession');

        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('Access is denied', 'SecurityError');
        });
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Access is denied', 'SecurityError');
        });

        try {
            const { result } = renderHook(() => useAuthSession());
            expect(result.current.auth).toBeNull();

            const newAuth = {
                token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
                roomId: 'room-mem',
                playerName: 'InMemoryUser',
                message: 'Ok',
            };

            act(() => {
                result.current.setAuth(newAuth);
            });
            expect(result.current.auth).toEqual(newAuth);

            act(() => {
                result.current.clearAuth();
            });
            expect(result.current.auth).toBeNull();
        } finally {
            getItemSpy.mockRestore();
            setItemSpy.mockRestore();
            removeItemSpy.mockRestore();
        }
    });
});
