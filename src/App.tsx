import { useCallback, useEffect, useState } from 'react';
import Lobby from './Lobby';
import GameView from './GameView';
import type {AuthResponse} from './types';

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);

  const handleAuth = useCallback((data: AuthResponse) => {
    setAuth(data);
  }, []);

  const handleLeave = useCallback(() => {
    setAuth(null);
  }, []);

  return (
      <div className="min-h-screen bg-surface selection:bg-emerald-primary selection:text-surface">
        {/* Global Nav */}
        <nav aria-label="Main Navigation" className="fixed top-0 left-0 w-full z-50 hidden md:flex justify-between items-center px-8 py-6 bg-surface/80 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center gap-12">
            <span className="text-2xl font-headline font-bold tracking-tighter text-emerald-primary">VAULT POKER</span>
            <div className="hidden md:flex items-center gap-8">
              <button aria-label="Go to Lobby" className="text-[10px] font-bold uppercase tracking-widest text-emerald-primary border-b-2 border-emerald-primary pb-1">Lobby</button>
              <button aria-label="Go to Tables" className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Tables</button>
            </div>
          </div>
          <div className="flex items-center gap-4">
          </div>
        </nav>

        {!auth ? (
            <Lobby onAuth={handleAuth} />
        ) : (
          <GameView auth={auth} onLeave={handleLeave} />
        )}

      </div>
  );
}
