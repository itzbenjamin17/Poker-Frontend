import { useContext } from 'react';
import { Button } from './UI';
import { cn } from '../lib/cn';
import { BTN_LEAVE_TABLE } from '../constants/strings';
import { GameContext } from '../context/GameContext';
import type { WsStatus } from '../types';

// eslint-disable-next-line react-refresh/only-export-components
export const WS_STATUS_CONFIG: Record<WsStatus, { dot: string; label: string; labelClass: string }> = {
    connected: {
        dot: 'bg-emerald-primary shadow-[0_0_8px_rgba(170,234,208,0.8)]',
        label: 'Connected',
        labelClass: 'text-emerald-primary/80',
    },
    reconnecting: {
        dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse',
        label: 'Reconnecting…',
        labelClass: 'text-amber-300/90',
    },
    disconnected: {
        dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse',
        label: 'Disconnected',
        labelClass: 'text-red-400/90',
    },
};

export function WsStatusBadge({ status }: { status: WsStatus }) {
    if (status === 'connected') {
        return null;
    }

    const cfg = WS_STATUS_CONFIG[status] ?? WS_STATUS_CONFIG.disconnected;
    return (
        <div
            role="status"
            aria-label={`Connection status: ${cfg.label}`}
            className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface/90 border border-white/10 text-xs backdrop-blur-sm shrink-0"
        >
            <span className={cn('w-2 h-2 rounded-full inline-block shrink-0', cfg.dot)} />
            <span className={cn('font-mono font-medium text-[11px]', cfg.labelClass)}>
                {cfg.label}
            </span>
        </div>
    );
}

export interface RoomHeaderProps {
    brandTitle?: string;
    roomName?: string;
    playerCount?: number;
    wsStatus?: WsStatus;
    onLeave?: () => void;
    isCompact?: boolean;
    confirmLeave?: boolean;
    confirmLeaveMessage?: string;
    className?: string;
}

export function RoomHeader({
    brandTitle = 'POKER',
    roomName,
    playerCount,
    wsStatus,
    onLeave,
    isCompact = false,
    confirmLeave = true,
    confirmLeaveMessage = 'Are you sure you want to leave the table? This will abandon your seat.',
    className,
}: RoomHeaderProps) {
    const gameContext = useContext(GameContext);

    const effectiveWsStatus = wsStatus ?? gameContext?.wsStatus ?? 'connected';
    const effectiveRoomName = roomName ?? gameContext?.roomState?.roomName;
    const effectivePlayerCount = playerCount ?? gameContext?.gameState?.players?.length ?? gameContext?.roomState?.players?.length;
    const effectiveOnLeave = onLeave ?? gameContext?.onLeave;

    const handleLeave = () => {
        if (!effectiveOnLeave) return;
        if (confirmLeave) {
            if (window.confirm(confirmLeaveMessage)) {
                effectiveOnLeave();
            }
        } else {
            effectiveOnLeave();
        }
    };

    return (
        <header
            data-testid="room-header"
            role="banner"
            aria-label="Room Header"
            className={cn(
                'w-full shrink-0 flex items-center justify-between border-b border-white/5 bg-surface/90 backdrop-blur-md z-40 transition-all select-none',
                isCompact ? 'h-11 px-3 py-1' : 'h-14 md:h-16 px-4 md:px-8 py-2 md:py-3',
                'short:h-8 short:px-3 short:py-0',
                className
            )}
        >
            {/* Identity group: Logo + Room Info */}
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <span
                    className={cn(
                        'font-headline font-bold tracking-tighter text-emerald-primary shrink-0',
                        isCompact ? 'text-lg' : 'text-xl md:text-2xl',
                        'short:text-lg'
                    )}
                >
                    {brandTitle}
                </span>

                {effectiveRoomName && (
                    <span
                        className="text-zinc-400 text-xs font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10 truncate max-w-[120px] sm:max-w-[200px]"
                        title={effectiveRoomName}
                    >
                        {effectiveRoomName}
                    </span>
                )}

                {effectivePlayerCount !== undefined && (
                    <span className="text-zinc-400 text-xs hidden sm:inline">
                        {effectivePlayerCount} {effectivePlayerCount === 1 ? 'player' : 'players'}
                    </span>
                )}
            </div>

            {/* Actions group: Connection Status + Leave Action */}
            <div className="flex items-center gap-2 md:gap-3 shrink-0">
                <WsStatusBadge status={effectiveWsStatus} />

                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLeave}
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10 text-xs px-2.5 py-1 h-auto"
                >
                    {BTN_LEAVE_TABLE}
                </Button>
            </div>
        </header>
    );
}
