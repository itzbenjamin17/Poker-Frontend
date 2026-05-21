import { useCallback, useState } from 'react';
import Lobby from './Lobby';
import GameView from './GameView';
import type { AuthResponse } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logger } from './security/logger';

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

export default function App() {
    const [auth, setAuth] = useState<AuthResponse | null>(() => {
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
    });

    const handleAuth = useCallback((data: AuthResponse) => {
        setAuth(data);
        localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    }, []);

    const handleLeave = useCallback(() => {
        setAuth(null);
        localStorage.removeItem(AUTH_KEY);
    }, []);

    return (
        <div className="min-h-screen bg-surface selection:bg-emerald-primary selection:text-surface">
            {/* Global Nav */}
            <nav
                aria-label="Main Navigation"
                className="fixed top-0 left-0 w-full z-50 hidden md:flex justify-between items-center px-8 py-6 bg-surface/80 backdrop-blur-xl border-b border-white/5"
            >
                <div className="flex items-center gap-12">
                    <span className="text-2xl font-headline font-bold tracking-tighter text-emerald-primary">
                        VAULT POKER
                    </span>
                </div>
            </nav>

            <ErrorBoundary>
                {!auth ? (
                    <Lobby onAuth={handleAuth} />
                ) : (
                    <GameView auth={auth} onLeave={handleLeave} />
                )}
            </ErrorBoundary>
        </div>
    );
}
