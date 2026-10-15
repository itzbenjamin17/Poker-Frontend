import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Card } from './UI';
import { Button } from './UI';
import { Info, Play, Copy, Check, Crown } from 'lucide-react';
import { NotificationBanner } from './NotificationBanner';
import {
    GAME_LOBBY_LABEL,
    BTN_START_GAME, BTN_STARTING_GAME, LABEL_WAITING_HOST,
    LABEL_BLINDS, LABEL_MIN_BUYIN,
    LABEL_TABLE_RULES, LABEL_HOST, ERROR_COPY_ROOM_CODE,
} from '../constants/strings';
import type { RoomState } from '../types';

export interface GameLobbyViewProps {
    roomState: RoomState | null;
    playerName?: string;
    auth?: { playerName: string } | null;
    notification?: string | null;
    onStartGame: () => void;
    onLeaveGame?: () => void;
    isStartingGame?: boolean;
}

export function GameLobbyView({
    roomState,
    playerName,
    auth,
    notification = null,
    onStartGame,
    isStartingGame = false,
}: GameLobbyViewProps) {
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyAttempt = useRef(0);

    useEffect(() => () => {
        copyAttempt.current += 1;
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    }, []);

    if (!roomState) return null;

    const handleCopyCode = async () => {
        const code = roomState.roomName || '';
        if (!code) return;
        const attempt = ++copyAttempt.current;
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
        setCopied(false);
        setCopyFailed(false);
        try {
            await navigator.clipboard.writeText(code);
            if (attempt !== copyAttempt.current) return;
            setCopied(true);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            if (attempt === copyAttempt.current) setCopyFailed(true);
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

    const effectivePlayerName = playerName ?? auth?.playerName;
    const amHost = roomState.players?.find(p => p.name === effectivePlayerName)?.isHost ?? false;

    return (
        <div
            role="region"
            aria-label="Game lobby"
            className="w-full max-w-5xl p-4 sm:p-8 overflow-y-auto max-h-full"
        >
            <NotificationBanner notification={notification} />
            {copyFailed && <p role="alert">{ERROR_COPY_ROOM_CODE}</p>}

            <div className="w-full">
                <div className="mb-8">
                    <span className="text-emerald-primary text-[10px] font-bold tracking-[0.3em] uppercase">
                        {GAME_LOBBY_LABEL}
                    </span>
                    <h1 className="text-5xl font-headline font-bold mt-2 flex items-center flex-wrap gap-4">
                        <span className="text-white">GAME LOBBY </span>
                        <button type="button" className="flex items-center gap-4 bg-white/5 px-6 py-2 rounded-2xl cursor-pointer hover:bg-white/10 transition-colors group" onClick={handleCopyCode} aria-label="Copy room code">
                            <span className="text-emerald-primary/80 group-hover:text-emerald-primary transition-colors">
                                {roomState.roomName || ''}
                            </span>
                            {copied ? (
                                <span className="text-emerald-primary flex items-center gap-1 text-sm bg-emerald-primary/10 px-2 py-1 rounded-md ml-2">
                                    <Check className="w-4 h-4" /> Copied!
                                </span>
                            ) : (
                                <Copy className="w-6 h-6 text-emerald-primary/40 group-hover:text-emerald-primary/80 transition-colors ml-2" />
                            )}
                        </button>
                    </h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Player list */}
                    <ul className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 list-none m-0 p-0">
                        {roomState.players?.map((p, i) => (
                            <li key={i}>
                                <Card className="p-6">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-headline font-bold text-xl">{p.name}</h3>
                                            {p.isHost && (
                                                <Crown
                                                    role="img"
                                                    aria-label={LABEL_HOST}
                                                    className="w-4 h-4 text-gold-secondary"
                                                />
                                            )}
                                        </div>
                                        <div
                                            className={cn('w-3 h-3 rounded-full', p.isHost ? 'bg-gold-secondary' : 'bg-emerald-primary')}
                                            aria-hidden="true"
                                        />
                                    </div>
                                </Card>
                            </li>
                        ))}
                        {((roomState.maxPlayers || 6) - (roomState.players?.length || 0)) > 0 && (
                            <li className="md:col-span-2">
                                <div className="border border-white/5 rounded-xl p-6 flex items-center justify-center border-dashed">
                                    <p className="text-zinc-500 text-sm uppercase tracking-widest font-semibold">
                                        {roomState.players?.length || 0} / {roomState.maxPlayers || 6} Players Joined
                                    </p>
                                </div>
                            </li>
                        )}
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
                            </div>
                        </Card>

                        {amHost ? (
                            <Button
                                variant="primary"
                                size="xl"
                                className="w-full"
                                onClick={onStartGame}
                                disabled={!roomState.canStartGame || isStartingGame}
                            >
                                {isStartingGame ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-surface border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                                        {BTN_STARTING_GAME}
                                    </>
                                ) : (
                                    <>
                                        <Play aria-hidden="true" className="w-5 h-5 fill-current" />
                                        {BTN_START_GAME}
                                    </>
                                )}
                            </Button>
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

