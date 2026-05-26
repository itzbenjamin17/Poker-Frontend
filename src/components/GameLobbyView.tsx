import { useState } from 'react';
import { useGameContext } from '../context/GameContext';
import { cn } from '../lib/cn';
import { Card } from './UI';
import { Button } from './UI';
import { Info, Play, Wifi, WifiOff, Copy, Check } from 'lucide-react';
import { NotificationBanner } from './NotificationBanner';
import { useRelativeTime } from '../hooks/useRelativeTime';
import type { WsStatus } from '../types';
import {
    GAME_LOBBY_LABEL,
    BTN_LEAVE_LOBBY, BTN_START_GAME, LABEL_HOST_CONTROLS, LABEL_WAITING_HOST,
    LABEL_WAITING_PLAYERS, LABEL_BLINDS, LABEL_MIN_BUYIN, LABEL_FORMAT,
    FORMAT_NLHE, LABEL_TABLE_RULES, LABEL_HOST,
} from '../constants/strings';

function PlayerJoinedAt({ timestamp }: { timestamp?: string }) {
    const relativeTime = useRelativeTime(timestamp);
    return <span>JOINED {relativeTime.toUpperCase()}</span>;
}

interface GameLobbyViewProps {
    onStartGame: () => void;
    onLeaveGame: () => void;
}

export function GameLobbyView({ onStartGame, onLeaveGame }: GameLobbyViewProps) {
    const { auth, roomState, notification, wsStatus } = useGameContext();
    const [copied, setCopied] = useState(false);

    if (!roomState) return null;

    const handleCopyCode = () => {
        const code = roomState.roomName || roomState.roomId || auth.roomId;
        if (code) {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const blindsLabel =
        typeof roomState.smallBlind === 'number' && typeof roomState.bigBlind === 'number'
            ? `$${roomState.smallBlind.toLocaleString()} / $${roomState.bigBlind.toLocaleString()}`
            : 'Waiting...';
    const buyInLabel =
        typeof roomState.buyIn === 'number'
            ? `$${roomState.buyIn.toLocaleString()}`
            : 'Waiting...';

    const amHost = roomState.players?.find(p => p.name === auth.playerName)?.isHost ?? false;

    return (
        <div className="min-h-screen p-8 md:pt-28 flex flex-col items-center justify-center">
            <NotificationBanner notification={notification} />

            <div className="w-full max-w-5xl">
                <div className="mb-4 flex justify-between items-center">
                    <LobbyWsStatusBadge status={wsStatus} />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onLeaveGame}
                        className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                    >
                        {BTN_LEAVE_LOBBY}
                    </Button>
                </div>

                <div className="mb-12">
                    <span className="text-emerald-primary text-[10px] font-bold tracking-[0.3em] uppercase">
                        {GAME_LOBBY_LABEL}
                    </span>
                    <h1 className="text-5xl font-headline font-bold mt-2 flex items-center flex-wrap gap-4">
                        <span className="text-white">GAME LOBBY </span>
                        <div className="flex items-center gap-4 bg-white/5 px-6 py-2 rounded-2xl cursor-pointer hover:bg-white/10 transition-colors group" onClick={handleCopyCode} role="button" aria-label="Copy room code" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleCopyCode()}>
                            <span className="text-emerald-primary/80 group-hover:text-emerald-primary transition-colors">
                                {roomState.roomName || roomState.roomId || auth.roomId}
                            </span>
                            {copied ? (
                                <span className="text-emerald-primary flex items-center gap-1 text-sm bg-emerald-primary/10 px-2 py-1 rounded-md ml-2">
                                    <Check className="w-4 h-4" /> Copied!
                                </span>
                            ) : (
                                <Copy className="w-6 h-6 text-emerald-primary/40 group-hover:text-emerald-primary/80 transition-colors ml-2" />
                            )}
                        </div>
                    </h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Player list */}
                    <ul className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 list-none m-0 p-0">
                        {roomState.players?.map((p, i) => (
                            <li key={i}>
                                <Card className={cn('p-6', p.isHost && 'ring-1 ring-gold-secondary/30')}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-headline font-bold text-xl">{p.name}</h3>
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">
                                                {p.isHost ? LABEL_HOST : <PlayerJoinedAt timestamp={p.joinedAt} />}
                                            </p>
                                        </div>
                                        <div
                                            className={cn('w-3 h-3 rounded-full', p.isHost ? 'bg-gold-secondary' : 'bg-emerald-primary')}
                                            aria-label={p.isHost ? 'Host' : 'Player'}
                                        />
                                    </div>
                                </Card>
                            </li>
                        ))}
                        {Array.from({ length: (roomState.maxPlayers || 6) - (roomState.players?.length || 0) }).map((_, i) => (
                            <li key={`empty-${i}`}>
                                <div className="border border-white/5 rounded-xl p-6 flex items-center justify-center border-dashed">
                                    <p className="text-zinc-700 text-xs uppercase tracking-widest italic">
                                        {LABEL_WAITING_PLAYERS}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <Card className="bg-surface-high">
                            <h3 className="font-headline font-bold mb-4 flex items-center gap-2">
                                <Info aria-hidden="true" className="w-4 h-4 text-emerald-primary" />
                                {LABEL_TABLE_RULES}
                            </h3>
                            <div className="space-y-4 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500 uppercase text-[10px] font-bold">{LABEL_BLINDS}</span>
                                    <span className="text-emerald-primary font-bold">{blindsLabel}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500 uppercase text-[10px] font-bold">{LABEL_MIN_BUYIN}</span>
                                    <span className="text-emerald-primary font-bold">{buyInLabel}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500 uppercase text-[10px] font-bold">{LABEL_FORMAT}</span>
                                    <span className="text-emerald-primary font-bold">{FORMAT_NLHE}</span>
                                </div>
                            </div>
                        </Card>

                        {amHost ? (
                            <>
                                <Button
                                    variant="primary"
                                    size="xl"
                                    className="w-full"
                                    onClick={onStartGame}
                                    disabled={!roomState.canStartGame}
                                >
                                    <Play aria-hidden="true" className="w-5 h-5 fill-current" />
                                    {BTN_START_GAME}
                                </Button>
                                <p className="text-center text-[10px] text-zinc-600 uppercase tracking-widest">
                                    {LABEL_HOST_CONTROLS}
                                </p>
                            </>
                        ) : (
                            <div className="border border-white/5 rounded-xl p-6 flex flex-col items-center justify-center border-dashed gap-3">
                                <div className="w-6 h-6 border-2 border-emerald-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                                <p className="text-zinc-500 text-xs uppercase tracking-widest text-center">
                                    {LABEL_WAITING_HOST}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Lobby Connection Status Badge ───────────────────────────────────────────

function LobbyWsStatusBadge({ status }: { status: WsStatus }) {
    const isConnected = status === 'connected';
    const isReconnecting = status === 'reconnecting';

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all duration-300',
                isConnected && 'border-emerald-primary/20 text-emerald-primary/70',
                isReconnecting && 'border-amber-400/30 text-amber-300/80 animate-pulse',
                !isConnected && !isReconnecting && 'border-red-500/30 text-red-400/80 animate-pulse',
            )}
            role="status"
            aria-label={`Connection status: ${status}`}
        >
            {isConnected
                ? <Wifi aria-hidden="true" className="w-3 h-3" />
                : <WifiOff aria-hidden="true" className="w-3 h-3" />
            }
            <span>{isConnected ? 'Connected' : isReconnecting ? 'Reconnecting\u2026' : 'Disconnected'}</span>
        </div>
    );
}
