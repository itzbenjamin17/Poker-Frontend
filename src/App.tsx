import { useCallback, useEffect, useState } from 'react';
import Lobby from './Lobby';
import GameView from './GameView';
import { Bell, Settings } from 'lucide-react';
import type {AuthResponse} from './types';

const AUTH_STORAGE_KEY = 'poker-auth';

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<AuthResponse>;
      if (parsed?.token && parsed?.roomId && parsed?.playerName) {
        setAuth({
          message: typeof parsed.message === 'string' ? parsed.message : '',
          token: parsed.token,
          roomId: parsed.roomId,
          playerName: parsed.playerName,
          playerId: parsed.playerId,
        });
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  }, [auth]);

  const handleAuth = useCallback((data: AuthResponse) => {
    setAuth(data);
  }, []);

  const handleLeave = useCallback(() => {
    setAuth(null);
  }, []);

  return (
      <div className="min-h-screen bg-surface selection:bg-emerald-primary selection:text-surface">
        {/* Global Nav */}
        <nav className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-8 py-6 bg-surface/80 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center gap-12">
            <span className="text-2xl font-headline font-bold tracking-tighter text-emerald-primary">VAULT POKER</span>
            <div className="hidden md:flex items-center gap-8">
              <button className="text-[10px] font-bold uppercase tracking-widest text-emerald-primary border-b-2 border-emerald-primary pb-1">Lobby</button>
              <button className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Tables</button>
              <button className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Rewards</button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-zinc-500 hover:text-white transition-all"><Bell className="w-5 h-5" /></button>
            <button className="p-2 text-zinc-500 hover:text-white transition-all"><Settings className="w-5 h-5" /></button>
          </div>
        </nav>

        {!auth ? (
            <Lobby onAuth={handleAuth} />
        ) : (
          <GameView auth={auth} onLeave={handleLeave} />
        )}

        {/* Footer Branding */}
        <footer className="fixed bottom-8 left-8 pointer-events-none opacity-20">
          <span className="text-[8px] font-headline font-bold uppercase tracking-[0.5em] text-white">Uncompromised Royal Action</span>
        </footer>
      </div>
  );
}
