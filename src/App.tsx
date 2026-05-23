import Lobby from './Lobby';
import GameView from './GameView';
import { ErrorBoundary } from './components/ErrorBoundary';

import { useAuthSession } from './hooks/useAuthSession';

export default function App() {
    const { auth, setAuth, clearAuth } = useAuthSession();

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
                    <Lobby onAuth={setAuth} />
                ) : (
                    <GameView auth={auth} onLeave={clearAuth} />
                )}
            </ErrorBoundary>
        </div>
    );
}
