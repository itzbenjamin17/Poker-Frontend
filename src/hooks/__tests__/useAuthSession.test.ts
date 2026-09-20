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

    it('returns null auth and null authError when no session is stored', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(result.current.authError).toBeNull();
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
        expect(result.current.authError).toBeNull();
    });

    it('clears storage, sets authError, and returns null auth when stored JWT is expired', async () => {
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
        expect(result.current.authError).toBe("Your session couldn't be restored.");
    });

    it('clears storage, sets authError, and returns null auth when storage has invalid shape', async () => {
        localStorage.setItem('poker-auth', JSON.stringify({ token: '', roomId: 'room-1' }));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
        expect(result.current.authError).toBe("Your session couldn't be restored.");
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

    it('clears auth and localStorage on auth-expired window event', async () => {
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
            window.dispatchEvent(new Event('auth-expired'));
        });

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });
});
