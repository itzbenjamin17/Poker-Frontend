import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthSession } from '../useAuthSession';
import { createMockJwt } from '../../test/fixtures';
import type { AuthResponse } from '../../types';

const FIXED_NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

function expOffset(offsetSeconds: number): number {
    return Math.floor(FIXED_NOW_MS / 1000) + offsetSeconds;
}

function createJwt(payload: Record<string, unknown>): string {
    return createMockJwt(payload);
}

describe('useAuthSession', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_NOW_MS);
    });

    it('returns null auth when no session is stored', () => {
        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
    });

    it('returns parsed auth object when valid session is stored', () => {
        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-1',
            playerName: 'Alice',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('enforces exact JWT expiry boundary deterministically under frozen time', () => {
        const borderlineValid = {
            token: createJwt({ exp: expOffset(1) }),
            roomId: 'room-boundary-valid',
            playerName: 'Alice',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(borderlineValid));
        const validRender = renderHook(() => useAuthSession());
        expect(validRender.result.current.auth).toEqual(borderlineValid);
        validRender.unmount();

        const borderlineExpired = {
            token: createJwt({ exp: expOffset(0) }),
            roomId: 'room-boundary-expired',
            playerName: 'Alice',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(borderlineExpired));
        const expiredRender = renderHook(() => useAuthSession());
        expect(expiredRender.result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('retires a legacy shared value when this tab already has its own session', () => {
        const tabAuth = {
            token: createJwt({ exp: expOffset(3600), tab: 'own' }),
            roomId: 'tab-room',
            playerName: 'Tab User',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(tabAuth));
        localStorage.setItem('poker-auth', JSON.stringify({ ...tabAuth, roomId: 'legacy-room' }));
        const { result } = renderHook(() => useAuthSession());
        expect(result.current.auth).toEqual(tabAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when stored JWT is expired', () => {
        const expiredAuth = {
            token: createJwt({ exp: expOffset(-3600) }),
            roomId: 'room-1',
            playerName: 'Alice',
        };
        localStorage.setItem('poker-auth', JSON.stringify(expiredAuth));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when storage has invalid shape', () => {
        localStorage.setItem('poker-auth', JSON.stringify({ token: '', roomId: 'room-1' }));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when stored auth has empty or whitespace playerName', () => {
        const invalidPlayerAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-1',
            playerName: '   ',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(invalidPlayerAuth));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('clears storage and returns null auth when stored auth has whitespace-only token or identity', () => {
        const whitespaceTokenAuth = {
            token: '   ',
            roomId: 'room-1',
            playerName: 'Alice',
        };
        sessionStorage.setItem('poker-auth', JSON.stringify(whitespaceTokenAuth));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('defensively rejects invalid auth in setAuth and leaves current valid auth and storage untouched', () => {
        const { result } = renderHook(() => useAuthSession());

        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-valid',
            playerName: 'ValidUser',
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
            } as unknown as AuthResponse);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth({
                token: validAuth.token,
                roomId: '   ',
                playerName: 'ValidUser',
            } as unknown as AuthResponse);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth(null as unknown as AuthResponse);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);

        act(() => {
            result.current.setAuth([] as unknown as AuthResponse);
        });
        expect(result.current.auth).toEqual(validAuth);
        expect(result.current.getCurrentAuth()).toEqual(validAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(validAuth);
    });

    it('writes to sessionStorage when setAuth is called', () => {
        const { result } = renderHook(() => useAuthSession());

        const newAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-2',
            playerName: 'Bob',
        };

        act(() => {
            result.current.setAuth(newAuth);
        });

        expect(result.current.auth).toEqual(newAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(newAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
    });

    it('exposes a stable synchronous auth getter updated before React renders', () => {
        const { result } = renderHook(() => useAuthSession());
        const getCurrentAuth = result.current.getCurrentAuth;
        const nextAuth = { token: createJwt({ exp: expOffset(3600) }), roomId: 'room-sync', playerName: 'Sync' };
        act(() => result.current.setAuth(nextAuth));
        expect(result.current.getCurrentAuth).toBe(getCurrentAuth);
        expect(getCurrentAuth()).toEqual(nextAuth);
        act(() => result.current.clearAuth(nextAuth.token));
        expect(getCurrentAuth()).toBeNull();
    });

    it('removes from sessionStorage and resets state when clearAuth is called', () => {
        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-3',
            playerName: 'Charlie',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

        const { result } = renderHook(() => useAuthSession());

        expect(result.current.auth).toEqual(validAuth);

        act(() => {
            result.current.clearAuth();
        });

        expect(result.current.auth).toBeNull();
        expect(sessionStorage.getItem('poker-auth')).toBeNull();
    });

    it('does not adopt or clear tab auth from cross-tab storage events', () => {
        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-4',
            playerName: 'Dave',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

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

    it('clears auth and sessionStorage on a matching token-scoped auth-expired event', () => {
        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-5',
            playerName: 'Eve',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));

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

    it('ignores an auth-expired race for a stale token', () => {
        const currentAuth = {
            token: createJwt({ exp: expOffset(3600), session: 'current' }),
            roomId: 'room-current',
            playerName: 'Current Player',
        };
        const staleToken = createJwt({ exp: expOffset(3600), session: 'stale' });
        localStorage.setItem('poker-auth', JSON.stringify(currentAuth));
        const { result } = renderHook(() => useAuthSession());

        act(() => {
            window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token: staleToken } }));
        });

        expect(result.current.auth).toEqual(currentAuth);
        expect(result.current.authExpired).toBe(false);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(currentAuth);
    });

    it('ignores storage.clear events because session auth is tab-local', () => {
        const validAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-clear',
            playerName: 'Clear Test',
        };
        localStorage.setItem('poker-auth', JSON.stringify(validAuth));
        const { result } = renderHook(() => useAuthSession());

        act(() => {
            localStorage.clear();
            window.dispatchEvent(new StorageEvent('storage', { key: null }));
        });

        expect(result.current.auth).toEqual(validAuth);
    });

    it('does not let stale token cleanup clear a replacement session', () => {
        const { result } = renderHook(() => useAuthSession());
        const oldAuth = { token: createJwt({ exp: expOffset(3600), id: 'old' }), roomId: 'old', playerName: 'A' };
        const newAuth = { token: createJwt({ exp: expOffset(3600), id: 'new' }), roomId: 'new', playerName: 'B' };
        act(() => result.current.setAuth(oldAuth));
        act(() => result.current.setAuth(newAuth));
        act(() => result.current.clearAuth(oldAuth.token));

        expect(result.current.auth).toEqual(newAuth);
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(newAuth);
    });

    it('survives localStorage SecurityError and QuotaExceededError while keeping auth state in memory', () => {
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
                token: createJwt({ exp: expOffset(3600) }),
                roomId: 'room-mem',
                playerName: 'InMemoryUser',
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

    it('clears memory state on clearAuth(expectedToken) even if persisted storage contains malformed JSON', () => {
        const validToken = createJwt({ exp: expOffset(3600) });
        const validAuth = {
            token: validToken,
            roomId: 'room-corrupt',
            playerName: 'CorruptTest',
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

    it('migrates legacy localStorage once to sessionStorage and prevents subsequent tabs from adopting it', () => {
        const legacyAuth = {
            token: createJwt({ exp: expOffset(3600) }),
            roomId: 'room-migration',
            playerName: 'MigratedUser',
        };
        localStorage.setItem('poker-auth', JSON.stringify(legacyAuth));

        // Tab 1 loads: imports to sessionStorage, removes from localStorage
        const tab1 = renderHook(() => useAuthSession());
        expect(tab1.result.current.auth).toEqual(legacyAuth);
        expect(localStorage.getItem('poker-auth')).toBeNull();
        expect(JSON.parse(sessionStorage.getItem('poker-auth')!)).toEqual(legacyAuth);

        // Simulate Tab 2 with its own fresh sessionStorage
        sessionStorage.clear();
        const tab2 = renderHook(() => useAuthSession());
        expect(tab2.result.current.auth).toBeNull();
    });

    describe('F1-1 scoped clearAuth behavior', () => {
        it('clears auth unconditionally when clearAuth() is called with no arguments', () => {
            const validAuth = {
                token: createJwt({ exp: expOffset(3600), id: 'token-no-arg' }),
                roomId: 'room-no-arg',
                playerName: 'Player1',
            };
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

        it('clears auth when clearAuth(matching-token) matches active auth token', () => {
            const token = createJwt({ exp: expOffset(3600), id: 'matching-token' });
            const validAuth = {
                token,
                roomId: 'room-matching',
                playerName: 'Player2',
            };
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

        it('does NOT clear auth when clearAuth(stale-token) does not match active auth token', () => {
            const activeToken = createJwt({ exp: expOffset(3600), id: 'active-token' });
            const staleToken = createJwt({ exp: expOffset(3600), id: 'stale-token' });
            const validAuth = {
                token: activeToken,
                roomId: 'room-active',
                playerName: 'Player3',
            };
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

    describe('recent seats for rejoining from a new tab', () => {
        const seat = (playerName: string, id: string) => ({
            token: createJwt({ exp: expOffset(3600), id }),
            roomId: 'room-1',
            playerName,
        });
        const rememberedSeats = () => JSON.parse(localStorage.getItem('poker-recent-seats') ?? '{"seats":[]}').seats;

        it('remembers a seat when the tab logs in, without logging other tabs in', () => {
            const ann = seat('Ann', 'ann');
            const { result } = renderHook(() => useAuthSession());

            act(() => result.current.setAuth(ann));

            expect(rememberedSeats()).toEqual([ann]);
            expect(localStorage.getItem('poker-auth')).toBeNull();
        });

        it('remembers the seat a refreshed tab restores', () => {
            const ann = seat('Ann', 'ann');
            sessionStorage.setItem('poker-auth', JSON.stringify(ann));

            renderHook(() => useAuthSession());

            expect(rememberedSeats()).toEqual([ann]);
        });

        it('forgets the seat when the tab leaves it or loses it, keeping other seats', () => {
            const ann = seat('Ann', 'ann');
            const ben = seat('Ben', 'ben');
            const { result } = renderHook(() => useAuthSession());
            act(() => result.current.setAuth(ben));
            act(() => result.current.setAuth(ann));

            act(() => result.current.clearAuth(ann.token));

            expect(rememberedSeats()).toEqual([ben]);
        });

        it('keeps the seat when a stale token cleanup is ignored', () => {
            const ann = seat('Ann', 'ann');
            const { result } = renderHook(() => useAuthSession());
            act(() => result.current.setAuth(ann));

            act(() => result.current.clearAuth(seat('Ann', 'stale').token));

            expect(rememberedSeats()).toEqual([ann]);
        });
    });
});
