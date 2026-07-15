import { useState, useCallback, useEffect } from 'react';
import { logger } from '../security/logger';
import { isJwtValid } from '../services/api';
import type { AuthResponse } from '../types';

const AUTH_KEY = 'poker-auth';

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


let initialAuthError: string | null = null;

function loadAuthFromStorage(): AuthResponse | null {
    const saved = localStorage.getItem(AUTH_KEY);
    if (!saved) return null;
    try {
        const parsed = JSON.parse(saved);
        if (!isValidAuth(parsed)) {
            logger.warn('Invalid auth shape in localStorage — clearing.');
            localStorage.removeItem(AUTH_KEY);
            initialAuthError = "Your session couldn't be restored.";
            return null;
        }
        if (!isJwtValid(parsed.token)) {
            logger.warn('Stored JWT is expired — clearing session.');
            localStorage.removeItem(AUTH_KEY);
            initialAuthError = "Your session couldn't be restored.";
            return null;
        }
        return parsed;
    } catch (e) {
        logger.error('Failed to parse saved auth:', e);
        localStorage.removeItem(AUTH_KEY);
        initialAuthError = "Your session couldn't be restored.";
        return null;
    }
}

export function useAuthSession() {
    const [auth, setAuthState] = useState<AuthResponse | null>(loadAuthFromStorage);
    const [authError, setAuthError] = useState<string | null>(initialAuthError);

    const setAuth = useCallback((data: AuthResponse) => {
        setAuthState(data);
        localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const clearAuth = useCallback(() => {
        setAuthState(null);
        localStorage.removeItem(AUTH_KEY);
    }, []);

    // Listen for cross-tab changes and global expiry events
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === AUTH_KEY) {
                setAuthState(loadAuthFromStorage());
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

    return { auth, setAuth, clearAuth, authError, clearAuthError: () => setAuthError(null) };
}
