import { useState, useEffect } from 'react';
import Lobby from './Lobby';
import GameView from './GameView';
import { ErrorBoundary } from './components/ErrorBoundary';

import { useAuthSession } from './hooks/useAuthSession';

function WindowSizeGuard({ children }: { children: React.ReactNode }) {
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

    useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    if (size.w < 320 || size.h < 480) {
        return (
            <div className="h-dvh flex flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
                <span className="text-xl font-headline font-bold text-emerald-primary">VAULT POKER</span>
                <p className="text-zinc-400 text-sm">
                    {size.w < 320 ? 'Window too narrow' : 'Window too short'} to play.
                </p>
                <p className="text-zinc-600 text-xs uppercase tracking-widest">
                    {size.h < 480 ? 'Try rotating your device.' : 'Please resize your window.'}
                </p>
            </div>
        );
    }

    return <>{children}</>;
}

export default function App() {
    const { auth, setAuth, clearAuth, authError, clearAuthError } = useAuthSession();

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
                <WindowSizeGuard>
                    {!auth ? (
                        <Lobby
                            onAuth={setAuth}
                            initialError={authError}
                            onClearInitialError={clearAuthError}
                        />
                    ) : (
                        <GameView auth={auth} onLeave={clearAuth} />
                    )}
                </WindowSizeGuard>
            </ErrorBoundary>
        </div>
    );
}