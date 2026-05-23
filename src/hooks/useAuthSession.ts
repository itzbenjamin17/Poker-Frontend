import { useState, useCallback, useEffect } from 'react';
import { logger } from '../security/logger';
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

/** Decode JWT payload and check exp claim. Returns false if expired. */
function isJwtValid(token: string): boolean {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof payload.exp === 'number') {
            return payload.exp * 1000 > Date.now();
        }
        return true; // No exp claim — treat as valid
    } catch {
        return false;
    }
}

function loadAuthFromStorage(): AuthResponse | null {
    const saved = localStorage.getItem(AUTH_KEY);
    if (!saved) return null;
    try {
        const parsed = JSON.parse(saved);
        if (!isValidAuth(parsed)) {
            logger.warn('Invalid auth shape in localStorage — clearing.');
            localStorage.removeItem(AUTH_KEY);
            return null;
        }
        if (!isJwtValid(parsed.token)) {
            logger.warn('Stored JWT is expired — clearing session.');
            localStorage.removeItem(AUTH_KEY);
            return null;
        }
        return parsed;
    } catch (e) {
        logger.error('Failed to parse saved auth:', e);
        localStorage.removeItem(AUTH_KEY);
        return null;
    }
}

export function useAuthSession() {
    const [auth, setAuthState] = useState<AuthResponse | null>(loadAuthFromStorage);

    const setAuth = useCallback((data: AuthResponse) => {
        setAuthState(data);
        localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const clearAuth = useCallback(() => {
        setAuthState(null);
        localStorage.removeItem(AUTH_KEY);
    }, []);

    // Listen for cross-tab changes
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === AUTH_KEY) {
                setAuthState(loadAuthFromStorage());
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    return { auth, setAuth, clearAuth };
}
