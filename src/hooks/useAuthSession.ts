import { useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '../security/logger';
import { isJwtValid } from '../services/api';
import { AUTH_KEY } from '../constants/strings';
import type { AuthResponse } from '../types';
import { isAuthResponse } from '../lib/payloads';

function safeGetStorageItem(key: string): string | null {
    try {
        return sessionStorage.getItem(key);
    } catch (e) {
        logger.warn('Failed to read from sessionStorage:', e);
        return null;
    }
}

function safeSetStorageItem(key: string, value: string): void {
    try {
        sessionStorage.setItem(key, value);
    } catch (e) {
        logger.warn('Failed to write to sessionStorage:', e);
    }
}

function safeRemoveStorageItem(key: string): void {
    try {
        sessionStorage.removeItem(key);
    } catch (e) {
        logger.warn('Failed to remove from sessionStorage:', e);
    }
}

function loadAuthStateFromStorage(): AuthResponse | null {
    let saved = safeGetStorageItem(AUTH_KEY);
    // Retire the legacy shared value on every load. If this tab has no
    // session yet, import it once before removing it so new tabs cannot adopt it.
    try {
        const legacy = localStorage.getItem(AUTH_KEY);
        if (!saved && legacy) {
            saved = legacy;
            sessionStorage.setItem(AUTH_KEY, legacy);
        }
        localStorage.removeItem(AUTH_KEY);
    } catch (e) {
        logger.warn('Failed to import legacy auth storage:', e);
    }
    if (!saved) return null;
    try {
        const parsed = JSON.parse(saved);
        if (!isAuthResponse(parsed)) {
            logger.warn('Invalid auth shape in sessionStorage — clearing.');
            safeRemoveStorageItem(AUTH_KEY);
            return null;
        }
        if (!isJwtValid(parsed.token)) {
            logger.warn('Stored JWT is expired — clearing session.');
            safeRemoveStorageItem(AUTH_KEY);
            return null;
        }
        return parsed;
    } catch (e) {
        logger.error('Failed to parse saved auth:', e);
        safeRemoveStorageItem(AUTH_KEY);
        return null;
    }
}

export function useAuthSession() {
    const [auth, setAuthState] = useState<AuthResponse | null>(loadAuthStateFromStorage);
    const [authExpired, setAuthExpired] = useState(false);
    const authRef = useRef(auth);

    const setAuth = useCallback((data: AuthResponse) => {
        if (!isAuthResponse(data)) {
            logger.warn('Invalid auth shape passed to setAuth — ignoring');
            return;
        }
        setAuthExpired(false);
        authRef.current = data;
        setAuthState(data);
        safeSetStorageItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const clearAuth = useCallback((expectedToken?: string) => {
        if (expectedToken && authRef.current?.token !== expectedToken) return;
        if (expectedToken) {
            const saved = safeGetStorageItem(AUTH_KEY);
            if (saved) {
                try {
                    const persisted: unknown = JSON.parse(saved);
                    if (isAuthResponse(persisted) && persisted.token !== expectedToken) return;
                } catch {
                    // Malformed persisted data does not represent a valid replacement token.
                }
            }
        }
        authRef.current = null;
        safeRemoveStorageItem(AUTH_KEY);
        setAuthState(null);
    }, []);

    const getCurrentAuth = useCallback(() => authRef.current, []);

    // Session auth is tab-local. Only token-specific expiry events can clear it.
    useEffect(() => {
        const handleAuthExpired = (event: Event) => {
            if (!(event instanceof CustomEvent)) return;
            const detail: unknown = event.detail;
            if (
                !detail || typeof detail !== 'object' ||
                !('token' in detail) || typeof detail.token !== 'string'
            ) return;

            const failedToken = detail.token;
            if (authRef.current?.token !== failedToken) return;
            setAuthExpired(true);
            clearAuth(failedToken);
        };

        window.addEventListener('auth-expired', handleAuthExpired);
        return () => {
            window.removeEventListener('auth-expired', handleAuthExpired);
        };
    }, [clearAuth]);

    return {
        auth,
        authExpired,
        dismissAuthExpired: () => setAuthExpired(false),
        isCurrentToken: (token: string) => authRef.current?.token === token,
        getCurrentAuth,
        setAuth,
        clearAuth,
    };
}
