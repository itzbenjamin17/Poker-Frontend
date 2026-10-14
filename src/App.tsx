import { Suspense, lazy } from 'react';
import Lobby from './Lobby';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingView } from './components/LoadingView';
import { SESSION_RESTORING } from './constants/strings';
import { useAuthSession } from './hooks/useAuthSession';

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
    const { auth, setAuth, clearAuth } = useAuthSession();

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

            <ErrorBoundary onLeave={clearAuth} onReset={recoverApp}>
                {!auth ? (
                    <Lobby onAuth={setAuth} />
                ) : (
                    <Suspense fallback={<LoadingView status={SESSION_RESTORING} onLeave={clearAuth} />}>
                        <GameView auth={auth} onLeave={clearAuth} />
                    </Suspense>
                )}
            </ErrorBoundary>
        </div>
    );
}
