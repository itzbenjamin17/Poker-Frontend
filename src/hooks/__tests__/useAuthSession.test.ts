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
        sessionStorage.clear();
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
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('retires a legacy shared value when this tab already has its own session', async () => {
        const tabAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, tab: 'own' }),
            roomId: 'tab-room', playerName: 'Tab User', message: 'Ok',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(tabAuth));
        localStorage.setItem('poker-auth', JSON.stringify({ ...tabAuth, roomId: 'legacy-room' }));
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());
        expect(result.current.auth).toEqual(tabAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
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

    it('clears storage and returns null auth when stored auth has empty or whitespace message', async () => {
        const invalidMessageAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-1',
            playerName: 'Alice',
            message: '   ',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(invalidMessageAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when stored auth has whitespace-only token or identity', async () => {
        const whitespaceTokenAuth = {
            token: '   ',
            roomId: 'room-1',
            playerName: 'Alice',
            message: 'ok',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(whitespaceTokenAuth));

        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('defensively rejects invalid auth in setAuth and leaves current valid auth and storage untouched', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());

        const validAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-valid',
            playerName: 'ValidUser',
            message: 'Success',
        };

        act(() => {
            result.current.setAuth(validAuth);
        });

        expect(result.current.auth).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        // Attempt invalid updates:
        act(() => {
            result.current.setAuth({
                token: '',
                roomId: 'room-2',
                playerName: 'BadUser',
                message: 'Fail',
            } as any);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth({
                token: validAuth.token,
                roomId: 'room-valid',
                playerName: 'ValidUser',
                message: '   ',
            } as any);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth(null as any);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth([] as any);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);
    });

    it('writes to sessionStorage when setAuth is called', async () => {
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
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(newAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('exposes a stable synchronous auth getter updated before React renders', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());
        const getCurrentAuth = result.current.getCurrentAuth;
        const nextAuth = { token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), roomId: 'room-sync', playerName: 'Sync', message: 'Ok' };
        act(() => result.current.setAuth(nextAuth));
        expect(result.current.getCurrentAuth).toBe(getCurrentAuth);
        expect(getCurrentAuth()).toEqual(nextAuth);
        act(() => result.current.clearAuth(nextAuth.token));
        expect(getCurrentAuth()).toBeNull();
    });

    it('removes from sessionStorage and resets state when clearAuth is called', async () => {
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
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('does not adopt or clear tab auth from cross-tab storage events', async () => {
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

        expect(result.current.auth).toEqual(validAuth);
    });

    it('clears auth and sessionStorage on a matching token-scoped auth-expired event', async () => {
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
        expect(result.current.authExpired).toBe(true);
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
        act(() => result.current.dismissAuthExpired());
        expect(result.current.authExpired).toBe(false);
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
        expect(result.current.authExpired).toBe(false);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(currentAuth);
    });

    it('ignores storage.clear events because session auth is tab-local', async () => {
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

        expect(result.current.auth).toEqual(validAuth);
    });

    it('does not let stale token cleanup clear a replacement session', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const { result } = renderHook(() => useAuthSession());
        const oldAuth = { token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'old' }), roomId: 'old', playerName: 'A', message: 'Old' };
        const newAuth = { token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'new' }), roomId: 'new', playerName: 'B', message: 'New' };
        act(() => result.current.setAuth(oldAuth));
        act(() => result.current.setAuth(newAuth));
        act(() => result.current.clearAuth(oldAuth.token));

        expect(result.current.auth).toEqual(newAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(newAuth);
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

    it('clears memory state on clearAuth(expectedToken) even if persisted storage contains malformed JSON', async () => {
        const { useAuthSession } = await import('../useAuthSession');
        const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
        const validAuth = {
            token: validToken,
            roomId: 'room-corrupt',
            playerName: 'CorruptTest',
            message: 'Ok',
        };
        const { result } = renderHook(() => useAuthSession());
        act(() => {
            result.current.setAuth(validAuth);
        });
        expect(result.current.auth).toEqual(validAuth);

        // Corrupt the persisted storage under the hood
        sessionStorage.setItem('poker-auth', '{invalid-json:');

        act(() => {
            result.current.clearAuth(validToken);
        });

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('migrates legacy localStorage once to sessionStorage and prevents subsequent tabs from adopting it', async () => {
        const legacyAuth = {
            token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            roomId: 'room-migration',
            playerName: 'MigratedUser',
            message: 'Ok',
        };
        localStorage.setItem('poker-auth', JSON.stringify(legacyAuth));

        // Tab 1 loads: imports to sessionStorage, removes from localStorage
        const { useAuthSession } = await import('../useAuthSession');
        const tab1 = renderHook(() => useAuthSession());
        expect(tab1.result.current.auth).toEqual(legacyAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(legacyAuth);

        // Simulate Tab 2 with its own fresh sessionStorage
        sessionStorage.clear();
        vi.resetModules();
        const { useAuthSession: useAuthSessionTab2 } = await import('../useAuthSession');
        const tab2 = renderHook(() => useAuthSessionTab2());
        expect(tab2.result.current.auth).toBeNull();
    });

    describe('F1-1 scoped clearAuth behavior', () => {
        it('clears auth unconditionally when clearAuth() is called with no arguments', async () => {
            const validAuth = {
                token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'token-no-arg' }),
                roomId: 'room-no-arg',
                playerName: 'Player1',
                message: 'Ok',
            };
            const { useAuthSession } = await import('../useAuthSession');
            const { result } = renderHook(() => useAuthSession());

            act(() => result.current.setAuth(validAuth));
            expect(result.current.auth).toEqual(validAuth);

            act(() => {
                result.current.clearAuth();
            });

            expect(result.current.auth).toBeNull();
            expect(result.current.getCurrentAuth()).toBeNull();
            expect(sessionStorage.getItem('poker-auth')).toBeNull();
        });

        it('clears auth when clearAuth(matching-token) matches active auth token', async () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'matching-token' });
            const validAuth = {
                token,
                roomId: 'room-matching',
                playerName: 'Player2',
                message: 'Ok',
            };
            const { useAuthSession } = await import('../useAuthSession');
            const { result } = renderHook(() => useAuthSession());

            act(() => result.current.setAuth(validAuth));
            expect(result.current.auth).toEqual(validAuth);

            act(() => {
                result.current.clearAuth(token);
            });

            expect(result.current.auth).toBeNull();
            expect(result.current.getCurrentAuth()).toBeNull();
            expect(sessionStorage.getItem('poker-auth')).toBeNull();
        });

        it('does NOT clear auth when clearAuth(stale-token) does not match active auth token', async () => {
            const activeToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'active-token' });
            const staleToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'stale-token' });
            const validAuth = {
                token: activeToken,
                roomId: 'room-active',
                playerName: 'Player3',
                message: 'Ok',
            };
            const { useAuthSession } = await import('../useAuthSession');
            const { result } = renderHook(() => useAuthSession());

            act(() => result.current.setAuth(validAuth));
            expect(result.current.auth).toEqual(validAuth);

            act(() => {
                result.current.clearAuth(staleToken);
            });

            expect(result.current.auth).toEqual(validAuth);
            expect(result.current.getCurrentAuth()).toEqual(validAuth);
            expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);
        });
    });
});
