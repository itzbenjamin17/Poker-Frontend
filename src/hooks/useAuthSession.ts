import { useState, useCallback, useEffect } from 'react';
import { logger } from '../security/logger';
import { isJwtValid } from '../services/api';
import { AUTH_KEY } from '../constants/strings';
import type { AuthResponse } from '../types';

/** Validate that a parsed auth object has all required fields. */
function isValidAuth(obj: unknown): obj is AuthResponse {
    if (!obj || typeof obj !== 'object') return false;
    const a = obj as Record<string, unknown>;
    return (
        typeof a.token === 'string' && a.token.length > 0 &&
        typeof a.roomId === 'string' && a.roomId.length > 0 &&
        typeof a.playerName === 'string' && a.playerName.length > 0
    );
}

function safeGetStorageItem(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        logger.warn('Failed to read from localStorage:', e);
        return null;
    }
}

function safeSetStorageItem(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        logger.warn('Failed to write to localStorage:', e);
    }
}

function safeRemoveStorageItem(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        logger.warn('Failed to remove from localStorage:', e);
    }
}

function loadAuthStateFromStorage(): AuthResponse | null {
    const saved = safeGetStorageItem(AUTH_KEY);
    if (!saved) return null;
    try {
        const parsed = JSON.parse(saved);
        if (!isValidAuth(parsed)) {
            logger.warn('Invalid auth shape in localStorage — clearing.');
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

    const setAuth = useCallback((data: AuthResponse) => {
        setAuthState(data);
        safeSetStorageItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const clearAuth = useCallback(() => {
        setAuthState(null);
        safeRemoveStorageItem(AUTH_KEY);
    }, []);

    // Listen for cross-tab changes and global expiry events
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === AUTH_KEY) {
                setAuthState(loadAuthStateFromStorage());
            }
        };
        const handleAuthExpired = () => {
            clearAuth();
        };

        window.addEventListener('storage', handleStorage);
        window.addEventListener('auth-expired', handleAuthExpired);
        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('auth-expired', handleAuthExpired);
        };
    }, [clearAuth]);

    return {
        auth,
        setAuth,
        clearAuth,
    };
}
