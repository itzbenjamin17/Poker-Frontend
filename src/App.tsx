import { useCallback, useState } from 'react';
import Lobby from './Lobby';
import GameView from './GameView';
import type {AuthResponse} from './types';

const AUTH_KEY = 'poker-auth';

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved auth:', e);
        return null;
      }
    }
    return null;
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
