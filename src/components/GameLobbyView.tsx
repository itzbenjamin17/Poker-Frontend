import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Card } from './UI';
import { Button } from './UI';
import { Info, Play, Copy, Check, Crown, AlertTriangle } from 'lucide-react';
import { NotificationBanner, type NotificationControls } from './NotificationBanner';
import {
    GAME_LOBBY_LABEL,
    BTN_START_GAME, BTN_STARTING_GAME, LABEL_WAITING_HOST,
    LABEL_BLINDS, LABEL_MIN_BUYIN,
    LABEL_TURN_TIME, LABEL_TURN_TIME_VALUE, LABEL_TURN_TIME_EXPLANATION,
    LABEL_TABLE_RULES, LABEL_HOST, ERROR_COPY_ROOM_CODE, COPY_ROOM_CODE_SUCCESS, ARIA_COPY_ROOM_CODE,
    LABEL_INACTIVITY_LIMIT, VALUE_INACTIVITY_LIMIT, LOBBY_TIMING_RULE_DESC,
    LOBBY_INACTIVITY_WARNING_TITLE, LOBBY_INACTIVITY_WARNING_MESSAGE,
    LABEL_GAME_INACTIVITY_LIMIT, VALUE_GAME_INACTIVITY_LIMIT, GAME_TIMING_RULE_DESC,
} from '../constants/strings';
import type { RoomState } from '../types';

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

export interface GameLobbyViewProps {
    roomState: RoomState | null;
    playerName?: string;
    auth?: { playerName: string } | null;
    notification?: string | null;
    notificationControls?: NotificationControls;
    onStartGame: () => void;
    onLeaveGame?: () => void;
    isStartingGame?: boolean;
    isLobbyInactivityWarningActive?: boolean;
}

export function GameLobbyView({
    roomState,
    playerName,
    auth,
    notification = null,
    notificationControls,
    onStartGame,
    isStartingGame = false,
    isLobbyInactivityWarningActive = false,
}: GameLobbyViewProps) {
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    // One message for sighted and screen reader users: it is both the visible bubble and the live region.
    const [copyMessage, setCopyMessage] = useState('');
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyFrame = useRef<number | null>(null);
    const copyAttempt = useRef(0);
    const lastCopyMessage = useRef('');
    const inactivityTitleId = useId();

    useEffect(() => () => {
        copyAttempt.current += 1;
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
        if (copyFrame.current !== null) cancelAnimationFrame(copyFrame.current);
    }, []);

    if (!roomState) return null;

    const reportCopy = (attempt: number, ok: boolean) => {
        if (attempt !== copyAttempt.current) return;
        // VoiceOver skips a message identical to the previous one; a no-break space makes a repeat differ.
        const base = ok ? COPY_ROOM_CODE_SUCCESS : ERROR_COPY_ROOM_CODE;
        const message = lastCopyMessage.current === base ? base + NO_BREAK_SPACE : base;
        lastCopyMessage.current = message;
        // Set the text on the next frame, after the region was emptied, so it is announced as new.
        copyFrame.current = requestAnimationFrame(() => {
            copyFrame.current = null;
            if (attempt !== copyAttempt.current) return;
            setCopyState(ok ? 'copied' : 'failed');
            setCopyMessage(message);
            copyTimer.current = setTimeout(() => {
                copyTimer.current = null;
                setCopyState('idle');
                setCopyMessage('');
            }, 2000);
        });
    };

    const handleCopyCode = async () => {
        const code = roomState.roomName || '';
        if (!code) return;
        const attempt = ++copyAttempt.current;
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
        if (copyFrame.current !== null) cancelAnimationFrame(copyFrame.current);
        setCopyState('idle');
        setCopyMessage('');
        try {
            await navigator.clipboard.writeText(code);
            reportCopy(attempt, true);
        } catch {
            reportCopy(attempt, false);
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
            <NotificationBanner notification={notification} {...notificationControls} />

            <div className="w-full">
                <div className="mb-8">
                    <span className="text-emerald-primary text-[0.625rem] font-bold tracking-[0.3em] uppercase">
                        {GAME_LOBBY_LABEL}
                    </span>
                    <h1 className="text-5xl font-headline font-bold mt-2 flex items-center flex-wrap gap-4">
                        <span className="text-white">GAME LOBBY </span>
                        <span className="relative inline-flex">
                            {/* The visible room code is part of the name, prefixed with the action for screen readers. */}
                            <button type="button" className="flex items-center gap-4 bg-white/5 px-6 py-2 rounded-2xl cursor-pointer hover:bg-white/10 transition-colors group" onClick={handleCopyCode}>
                                <span className="sr-only">{ARIA_COPY_ROOM_CODE} </span>
                                <span className="text-emerald-primary/80 group-hover:text-emerald-primary transition-colors">
                                    {roomState.roomName || ''}
                                </span>
                                {copyState === 'copied' ? (
                                    <Check aria-hidden="true" className="w-6 h-6 text-emerald-primary ml-2" />
                                ) : (
                                    <Copy aria-hidden="true" className="w-6 h-6 text-emerald-primary/40 group-hover:text-emerald-primary/80 transition-colors ml-2" />
                                )}
                            </button>
                            {/* Outside the button: a button's children are presentational, so a live region inside it is not reliably announced. */}
                            <span
                                role="status"
                                className={cn(
                                    'pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 font-body text-sm font-normal tracking-normal transition-opacity duration-200',
                                    copyMessage ? 'opacity-100' : 'opacity-0',
                                    copyState === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-primary/10 text-emerald-primary',
                                )}
                            >
                                {copyMessage}
                            </span>
                        </span>
                    </h1>
                </div>

                {isLobbyInactivityWarningActive && (
                    <div
                        role="status"
                        aria-live="polite"
                        aria-labelledby={inactivityTitleId}
                        className="mb-8 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 flex items-center gap-3 text-sm"
                    >
                        <AlertTriangle aria-hidden="true" className="w-5 h-5 shrink-0 text-amber-400" />
                        <div className="flex-1">
                            <p id={inactivityTitleId} className="font-semibold">{LOBBY_INACTIVITY_WARNING_TITLE}</p>
                            <p className="text-zinc-300 text-xs mt-0.5">{LOBBY_INACTIVITY_WARNING_MESSAGE}</p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Player list */}
                    <ul className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 self-start gap-4 list-none m-0 p-0">
                        {roomState.players?.map((p, i) => (
                            <li key={i}>
                                <Card className="p-6">
                                    <div className="flex justify-between items-center gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <h3 className="min-w-0 truncate font-headline font-bold text-xl" title={p.name}>{p.name}</h3>
                                            {p.isHost && (
                                                <Crown
                                                    role="img"
                                                    aria-label={LABEL_HOST}
                                                    className="w-4 h-4 shrink-0 text-gold-secondary"
                                                />
                                            )}
                                        </div>
                                        <div
                                            className={cn('w-3 h-3 shrink-0 rounded-full', p.isHost ? 'bg-gold-secondary' : 'bg-emerald-primary')}
                                            aria-hidden="true"
                                        />
                                    </div>
                                </Card>
                            </li>
                        ))}
                        {((roomState.maxPlayers || 6) - (roomState.players?.length || 0)) > 0 && (
                            <li className="md:col-span-2">
                                <div className="border border-white/5 rounded-xl p-6 flex items-center justify-center border-dashed">
                                    <p className="text-zinc-400 text-sm uppercase tracking-widest font-semibold">
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
                                    <span className="text-zinc-400 uppercase text-[0.625rem] font-bold">{LABEL_BLINDS}</span>
                                    <span className="text-emerald-primary font-bold">{blindsLabel}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400 uppercase text-[0.625rem] font-bold">{LABEL_MIN_BUYIN}</span>
                                    <span className="text-emerald-primary font-bold">{buyInLabel}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400 uppercase text-[0.625rem] font-bold">{LABEL_TURN_TIME}</span>
                                    <span className="text-emerald-primary font-bold">{LABEL_TURN_TIME_VALUE}</span>
                                </div>
                                <p className="text-[0.6875rem] text-zinc-400">
                                    {LABEL_TURN_TIME_EXPLANATION}
                                </p>
                                <div className="border-t border-white/5 pt-3">
                                    <div className="flex justify-between">
                                        <span className="text-zinc-400 uppercase text-[0.625rem] font-bold">{LABEL_INACTIVITY_LIMIT}</span>
                                        <span className="text-emerald-primary font-bold">{VALUE_INACTIVITY_LIMIT}</span>
                                    </div>
                                    <p className="text-zinc-400 text-xs mt-1">{LOBBY_TIMING_RULE_DESC}</p>
                                </div>
                                <div className="border-t border-white/5 pt-3">
                                    <div className="flex justify-between">
                                        <span className="text-zinc-400 uppercase text-[0.625rem] font-bold">{LABEL_GAME_INACTIVITY_LIMIT}</span>
                                        <span className="text-emerald-primary font-bold">{VALUE_GAME_INACTIVITY_LIMIT}</span>
                                    </div>
                                    <p className="text-zinc-400 text-xs mt-1">{GAME_TIMING_RULE_DESC}</p>
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
                                <p className="text-zinc-400 text-xs uppercase tracking-widest text-center">
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

