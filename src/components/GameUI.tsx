import React from 'react';
import { cn, type Player} from '../types';

const SUITS: Record<string, { icon: string; color: string }> = {
    'H': { icon: '♥', color: 'text-red-500' },
    'D': { icon: '♦', color: 'text-red-500' },
    'C': { icon: '♣', color: 'text-zinc-800' },
    'S': { icon: '♠', color: 'text-zinc-800' },
};

export const CardUI: React.FC<{ card: string; hidden?: boolean; className?: string }> = ({ card, hidden, className }) => {
    if (hidden) {
        return (
            <div className={cn("w-12 h-16 bg-emerald-container rounded-md border-2 border-white/20 flex items-center justify-center shadow-lg", className)}>
                <div className="w-8 h-12 border border-white/10 rounded-sm opacity-20" />
            </div>
        );
    }

    const value = card.slice(0, -1);
    const suitKey = card.slice(-1);
    const suit = SUITS[suitKey] || { icon: '?', color: 'text-zinc-400' };

    return (
        <div className={cn("w-12 h-16 bg-white rounded-md flex flex-col items-center justify-between p-1 shadow-xl relative overflow-hidden", className)}>
            <div className={cn("text-xs font-bold self-start leading-none", suit.color)}>{value}</div>
            <div className={cn("text-xl leading-none", suit.color)}>{suit.icon}</div>
            <div className={cn("text-xs font-bold self-end rotate-180 leading-none", suit.color)}>{value}</div>

            {/* Subtle watermark */}
            <div className={cn("absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none text-4xl", suit.color)}>
                {suit.icon}
            </div>
        </div>
    );
};

export const PlayerPod = ({
                              player,
                              isCurrent,
                              blindLabel,
                              size = 'md',
                              disconnectSecondsRemaining,
                              className
                          }: {
    player: Player;
    isCurrent?: boolean;
    blindLabel?: 'SB' | 'BB';
    size?: 'sm' | 'md';
    isDealer?: boolean;
    disconnectSecondsRemaining?: number;
    className?: string;
}) => {
    const podSizeClass = size === 'sm' ? 'w-16 h-16' : 'w-20 h-20';
    const initialsClass = size === 'sm' ? 'text-base' : 'text-xl';
    const chipsClass = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
    const isDisconnected = player.status === 'DISCONNECTED';
    const formatDisconnectCountdown = (secondsRemaining: number) => {
        const clamped = Math.max(0, secondsRemaining);
        const minutes = Math.floor(clamped / 60).toString().padStart(2, '0');
        const seconds = (clamped % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    return (
        <div className={cn("flex flex-col items-center gap-2", className)}>
            <div className={cn(
                "relative rounded-full flex items-center justify-center transition-all duration-500",
                podSizeClass,
                isCurrent ? "ring-2 ring-emerald-primary ring-offset-4 ring-offset-surface scale-110" : "ring-1 ring-white/10",
                player.status === 'FOLDED' ? "opacity-40 grayscale" : "opacity-100",
                isDisconnected ? "ring-2 ring-amber-400/80 opacity-80" : ""
            )}>
                <div className="w-full h-full rounded-full bg-surface-highest flex items-center justify-center overflow-hidden border border-white/5">
           <span className={cn("font-headline font-bold text-emerald-primary/40", initialsClass)}>
             {player.name.slice(0, 2).toUpperCase()}
           </span>
                </div>

                {blindLabel && (
                    <div className={cn(
                        "absolute -left-2 -top-2 px-1.5 py-0.5 rounded-full border shadow-md",
                        blindLabel === 'BB'
                            ? "bg-gold-secondary text-surface border-gold-dim"
                            : "bg-emerald-primary text-surface border-emerald-dim"
                    )}>
                        <span className="text-[9px] font-headline font-extrabold tracking-wider">{blindLabel}</span>
                    </div>
                )}

                {/* Chips Badge */}
                <div className="absolute -bottom-2 bg-surface-high px-2 py-0.5 rounded-full border border-white/10 shadow-lg">
                    <span className={cn("font-bold text-gold-secondary", chipsClass)}>${player.chips.toLocaleString()}</span>
                </div>

                {/* Action Indicator */}
                {isCurrent && !isDisconnected && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(170,234,208,0.5)]" />
                )}

                {isDisconnected && (
                    <div className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-surface border border-amber-300 shadow-lg">
                        <span className="text-[8px] font-headline font-extrabold tracking-wider">OFF</span>
                    </div>
                )}
            </div>

            <div className="text-center">
                <p className="text-[10px] font-headline font-bold uppercase tracking-widest text-white/80">{player.name}</p>
                {player.currentBet > 0 && (
                    <p className="text-[9px] font-bold text-emerald-primary/60">BET: ${player.currentBet}</p>
                )}
                {isDisconnected && (
                    <p className="text-[9px] font-bold text-amber-300 uppercase tracking-wider">
                        {typeof disconnectSecondsRemaining === 'number'
                            ? `Reconnect in ${formatDisconnectCountdown(disconnectSecondsRemaining)}`
                            : 'Waiting to reconnect...'}
                    </p>
                )}
            </div>
        </div>
    );
};
