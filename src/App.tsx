import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import Lobby from './Lobby';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingView } from './components/LoadingView';
import { SESSION_RESTORING } from './constants/strings';
import { useAuthSession } from './hooks/useAuthSession';
import { pokerApi } from './services/api';
import { getErrorStatusCode, isAuthResponse } from './lib/payloads';
import { savePersistedGameEnd, retireDifferentlyOwnedGameEnd } from './services/gameEndStorage';

class GameViewLoadError extends Error {}

const GameView = lazy(() =>
    import('./GameView').catch((cause: unknown) => {
        throw new GameViewLoadError('Unable to load GameView', { cause });
    })
);

function recoverApp(error: unknown) {
    if (error instanceof GameViewLoadError) {
        window.location.reload();
    }
}

export default function App() {
    const { auth, setAuth, clearAuth, authExpired, dismissAuthExpired, getCurrentAuth } = useAuthSession();
    const [leaveErrorState, setLeaveErrorState] = useState<{ token: string; message: string } | null>(null);
    const leaveFlights = useRef(new Map<string, Promise<boolean>>());
    const leaveError = auth && leaveErrorState?.token === auth.token ? leaveErrorState.message : null;
    const requestLeave = useCallback(async (originatingToken?: string): Promise<boolean> => {
        const tokenToLeave = (typeof originatingToken === 'string' && originatingToken) ? originatingToken : auth?.token;
        if (!tokenToLeave) return true;
        const current = getCurrentAuth();
        const originatingAuth = (current && current.token === tokenToLeave)
            ? current
            : (auth && auth.token === tokenToLeave ? auth : null);
        if (!originatingAuth) return false;
        const existing = leaveFlights.current.get(originatingAuth.token);
        if (existing) return existing;
        setLeaveErrorState(null);
        const request = (async () => {
            try {
                await pokerApi.leaveRoom(originatingAuth.roomId, originatingAuth.token);
            } catch (error) {
                const status = getErrorStatusCode(error);
                if (status === 404 || status === 410) {
                    // Room or seat is already gone; proceed to local departure
                } else {
                    const message = error instanceof Error ? error.message : 'Could not leave the room. Try again.';
                    if (getCurrentAuth()?.token === originatingAuth.token) setLeaveErrorState({ token: originatingAuth.token, message });
                    return false;
                }
            }
            const currentAfter = getCurrentAuth();
            if (!currentAfter || currentAfter.roomId !== originatingAuth.roomId) {
                savePersistedGameEnd(originatingAuth, null);
                return false;
            }
            if (currentAfter.token === originatingAuth.token) {
                savePersistedGameEnd(originatingAuth, null);
                clearAuth(originatingAuth.token);
                return true;
            }
            return false;
        })();
        leaveFlights.current.set(originatingAuth.token, request);
        try { return await request; }
        finally { if (leaveFlights.current.get(originatingAuth.token) === request) leaveFlights.current.delete(originatingAuth.token); }
    }, [auth, clearAuth, getCurrentAuth]);

    const handleLeave = useCallback((originatingToken?: string) => {
        const tokenToClear = (typeof originatingToken === 'string' && originatingToken) ? originatingToken : auth?.token;
        if (!tokenToClear) return;
        if (getCurrentAuth()?.token !== tokenToClear) return;
        if (auth && auth.token === tokenToClear) {
            savePersistedGameEnd(auth, null);
        } else {
            const current = getCurrentAuth();
            if (current && current.token === tokenToClear) {
                savePersistedGameEnd(current, null);
            }
        }
        clearAuth(tokenToClear);
    }, [auth, clearAuth, getCurrentAuth]);

    const handleSetAuth = useCallback((data: Parameters<typeof setAuth>[0]) => {
        if (data && isAuthResponse(data)) {
            retireDifferentlyOwnedGameEnd(data);
        }
        setAuth(data);
    }, [setAuth]);

    return (
        <div className="min-h-screen bg-surface selection:bg-emerald-primary selection:text-surface">
            {/* Global Nav */}
            {!auth && (
                <nav
                    aria-label="Main Navigation"
                    className="fixed top-0 left-0 w-full z-50 hidden md:flex justify-between items-center px-8 py-6 bg-surface/80 backdrop-blur-xl border-b border-white/5"
                >
                    <div className="flex items-center gap-12">
                        <span className="text-2xl font-headline font-bold tracking-tighter text-emerald-primary">
                            POKER
                        </span>
                    </div>
                </nav>
            )}
            {!auth && authExpired && (
                <div role="alert" className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] rounded-xl border border-amber-300/30 bg-surface-high px-4 py-3 text-sm text-amber-100 shadow-lg">
                    Your room session expired. Join or create a room to continue.
                    <button type="button" className="ml-4 underline" onClick={dismissAuthExpired}>Dismiss</button>
                </div>
            )}
            {!auth ? (
                <ErrorBoundary onLeave={requestLeave} leaveError={leaveError} onReset={recoverApp}>
                    <Lobby onAuth={handleSetAuth} />
                </ErrorBoundary>
            ) : (
                <ErrorBoundary
                    key={`${auth.roomId}:${auth.playerName}:${auth.token}`}
                    onLeave={requestLeave}
                    leaveError={leaveError}
                    onReset={recoverApp}
                >
                    <Suspense fallback={<LoadingView status={SESSION_RESTORING} onLeave={requestLeave} errorMessage={leaveError} />}>
                        <GameView
                            key={`${auth.roomId}:${auth.playerName}:${auth.token}`}
                            auth={auth}
                            onLeave={handleLeave}
                            onRequestLeave={requestLeave}
                            leaveError={leaveError}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}
        </div>
    );
}
