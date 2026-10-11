import { useState, useCallback, useEffect } from 'react';
import { logger } from '../security/logger';
import { isJwtValid } from '../services/api';
import { AUTH_KEY, SESSION_RESTORE_FAILED } from '../constants/strings';
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

function loadAuthStateFromStorage(): { auth: AuthResponse | null; authError: string | null } {
    const saved = safeGetStorageItem(AUTH_KEY);
    if (!saved) return { auth: null, authError: null };
    try {
        const parsed = JSON.parse(saved);
        if (!isValidAuth(parsed)) {
            logger.warn('Invalid auth shape in localStorage — clearing.');
            safeRemoveStorageItem(AUTH_KEY);
            return { auth: null, authError: SESSION_RESTORE_FAILED };
        }
        if (!isJwtValid(parsed.token)) {
            logger.warn('Stored JWT is expired — clearing session.');
            safeRemoveStorageItem(AUTH_KEY);
            return { auth: null, authError: SESSION_RESTORE_FAILED };
        }
        return { auth: parsed, authError: null };
    } catch (e) {
        logger.error('Failed to parse saved auth:', e);
        safeRemoveStorageItem(AUTH_KEY);
        return { auth: null, authError: SESSION_RESTORE_FAILED };
    }
}

export function useAuthSession() {
    const [sessionState, setSessionState] = useState(loadAuthStateFromStorage);

    const setAuth = useCallback((data: AuthResponse) => {
        setSessionState((prev) => ({ ...prev, auth: data }));
        safeSetStorageItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const clearAuth = useCallback(() => {
        setSessionState((prev) => ({ ...prev, auth: null }));
        safeRemoveStorageItem(AUTH_KEY);
    }, []);

    const clearAuthError = useCallback(() => {
        setSessionState((prev) => ({ ...prev, authError: null }));
    }, []);

    // Listen for cross-tab changes and global expiry events
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === AUTH_KEY) {
                const next = loadAuthStateFromStorage();
                setSessionState((prev) => ({ ...prev, auth: next.auth }));
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
        auth: sessionState.auth,
        setAuth,
        clearAuth,
        authError: sessionState.authError,
        clearAuthError,
    };
}
