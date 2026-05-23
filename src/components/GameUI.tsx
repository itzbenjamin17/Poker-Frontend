import React from 'react';
import { cn } from '../lib/cn';
import type { Player } from '../types';

const SUITS: Record<string, { icon: string; color: string; name: string }> = {
    'H': { icon: '♥', color: 'text-red-500', name: 'Hearts' },
    'D': { icon: '♦', color: 'text-red-500', name: 'Diamonds' },
    'C': { icon: '♣', color: 'text-zinc-800', name: 'Clubs' },
    'S': { icon: '♠', color: 'text-zinc-800', name: 'Spades' },
};

const RANKS: Record<string, string> = {
    'A': 'Ace', 'K': 'King', 'Q': 'Queen', 'J': 'Jack', 'T': 'Ten',
    '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
};

export const CardUI: React.FC<{ card: string; scale?: number; hidden?: boolean; className?: string; style?: React.CSSProperties }> = ({ card, scale = 1, hidden, className, style }) => {
    if (hidden) {
        return (
            <div
                aria-label="Hidden Card"
                className={cn('bg-emerald-container rounded-md border-2 border-white/20 flex items-center justify-center shadow-lg', className)}
                style={{
                    width: `${scale * 48}px`,
                    height: `${scale * 64}px`,
                    borderRadius: `${scale * 6}px`,
                    ...style
                }}
            >
                <div
                    className="border border-white/10 rounded-sm opacity-20"
                    style={{
                        width: `${scale * 32}px`,
                        height: `${scale * 48}px`,
                        borderRadius: `${scale * 4}px`,
                    }}
                />
            </div>
        );
    }

    const value = card.slice(0, -1);
    const suitKey = card.slice(-1);
    const suit = SUITS[suitKey] || { icon: '?', color: 'text-zinc-400', name: 'Unknown' };
    const rankName = RANKS[value] || value;
    const label = `${rankName} of ${suit.name}`;
    
    const displayValue = value === 'T' ? '10' : value;

    return (
        <div
            role="img"
            aria-label={label}
            className={cn('bg-white rounded-md flex flex-col items-center justify-between shadow-xl relative overflow-hidden', className)}
            style={{
                width: `${scale * 48}px`,
                height: `${scale * 64}px`,
                padding: `${scale * 4}px`,
                borderRadius: `${scale * 6}px`,
                ...style
            }}
        >
            <div className={cn('font-bold self-start leading-none', suit.color)} style={{ fontSize: `${scale * 12}px` }}>{displayValue}</div>
            <div className={cn('leading-none', suit.color)} style={{ fontSize: `${scale * 20}px` }}>{suit.icon}</div>
            <div className={cn('font-bold self-end rotate-180 leading-none', suit.color)} style={{ fontSize: `${scale * 12}px` }}>{displayValue}</div>

            {/* Subtle watermark */}
            <div className={cn('absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none text-4xl leading-none', suit.color)} style={{ fontSize: `${scale * 40}px` }}>
                {suit.icon}
            </div>
        </div>
    );
};

export const PlayerPod = ({
    player,
    isCurrent,
    isWinner,
    blindLabel,
    size = 'md',
    disconnectSecondsRemaining,
    className,
    scale = 1,
    handRank,
}: {
    player: Player;
    isCurrent?: boolean;
    isWinner?: boolean;
    blindLabel?: 'SB' | 'BB';
    size?: 'sm' | 'md';
    disconnectSecondsRemaining?: number;
    className?: string;
    scale?: number;
    handRank?: string;
}) => {
    const isDisconnected = player.status === 'DISCONNECTED';

    const formatDisconnectCountdown = (secondsRemaining: number) => {
        const clamped = Math.max(0, secondsRemaining);
        const minutes = Math.floor(clamped / 60).toString().padStart(2, '0');
        const seconds = (clamped % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    const baseDiameter = size === 'sm' ? 64 : 80;
    const baseInitialsFontSize = size === 'sm' ? 16 : 20;
    const baseChipsFontSize = size === 'sm' ? 9 : 10;

    return (
        <div className={cn('flex flex-col items-center', className)} style={{ gap: `${scale * 8}px` }}>
            <div className={cn(
                'relative rounded-full flex items-center justify-center transition-all duration-500',
                isWinner
                    ? 'ring-2 ring-gold-secondary ring-offset-4 ring-offset-surface scale-110 shadow-[0_0_24px_rgba(252,192,37,0.4)] animate-pulse'
                    : isCurrent
                        ? 'ring-2 ring-emerald-primary ring-offset-4 ring-offset-surface scale-110'
                        : 'ring-1 ring-white/10',
                player.status === 'FOLDED' ? 'opacity-40 grayscale' : 'opacity-100',
                isDisconnected ? 'ring-2 ring-amber-400/80 opacity-80' : ''
            )}
            style={{
                width: `${scale * baseDiameter}px`,
                height: `${scale * baseDiameter}px`,
            }}>
                <div className={cn(
                    'w-full h-full rounded-full bg-surface-highest flex items-center justify-center overflow-hidden border',
                    isWinner ? 'border-gold-secondary/70 bg-gold-secondary/10' : 'border-white/5'
                )}>
                    <span
                        className={cn(
                            'font-headline font-bold',
                            isWinner ? 'text-gold-secondary/85' : 'text-emerald-primary/40'
                        )}
                        style={{ fontSize: `${scale * baseInitialsFontSize}px` }}
                    >
                        {player.name.slice(0, 2).toUpperCase()}
                    </span>
                    {isCurrent && <span className="sr-only">Active turn</span>}
                    {isWinner && <span className="sr-only">Winner</span>}
                    {player.status === 'FOLDED' && <span className="sr-only">Folded</span>}
                </div>

                {blindLabel && (
                    <div
                        className={cn(
                            'absolute border shadow-md flex items-center justify-center',
                            blindLabel === 'BB'
                                ? 'bg-gold-secondary text-surface border-gold-dim'
                                : 'bg-emerald-primary text-surface border-emerald-dim'
                        )}
                        style={{
                            left: `-${scale * 8}px`,
                            top: `-${scale * 8}px`,
                            paddingLeft: `${scale * 6}px`,
                            paddingRight: `${scale * 6}px`,
                            paddingTop: `${scale * 2}px`,
                            paddingBottom: `${scale * 2}px`,
                            borderRadius: `${scale * 999}px`,
                        }}
                    >
                        <span className="font-headline font-extrabold tracking-wider" style={{ fontSize: `${scale * 9}px` }}>{blindLabel}</span>
                    </div>
                )}

                {/* Chips Badge */}
                <div
                    className="absolute bg-surface-high border border-white/10 shadow-lg flex items-center justify-center whitespace-nowrap"
                    style={{
                        bottom: `-${scale * 8}px`,
                        paddingLeft: `${scale * 8}px`,
                        paddingRight: `${scale * 8}px`,
                        paddingTop: `${scale * 2}px`,
                        paddingBottom: `${scale * 2}px`,
                        borderRadius: `${scale * 999}px`,
                    }}
                >
                    <span className="font-bold text-gold-secondary" style={{ fontSize: `${scale * baseChipsFontSize}px` }}>${player.chips.toLocaleString()}</span>
                </div>

                {/* Action Indicator */}
                {isCurrent && !isDisconnected && !isWinner && (
                    <div
                        className="absolute bg-emerald-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(170,234,208,0.5)]"
                        style={{
                            top: `-${scale * 4}px`,
                            right: `-${scale * 4}px`,
                            width: `${scale * 16}px`,
                            height: `${scale * 16}px`,
                        }}
                    />
                )}

                {isDisconnected && (
                    <div
                        className="absolute bg-amber-500 text-surface border border-amber-300 shadow-lg flex items-center justify-center"
                        style={{
                            top: `-${scale * 4}px`,
                            right: `-${scale * 4}px`,
                            paddingLeft: `${scale * 6}px`,
                            paddingRight: `${scale * 6}px`,
                            paddingTop: `${scale * 2}px`,
                            paddingBottom: `${scale * 2}px`,
                            borderRadius: `${scale * 999}px`,
                        }}
                    >
                        <span className="font-headline font-extrabold tracking-wider" style={{ fontSize: `${scale * 8}px` }}>OFF</span>
                    </div>
                )}
            </div>

            {handRank && (
                <div
                    className={cn(
                        'font-headline font-bold uppercase tracking-widest bg-black/80 rounded-full whitespace-nowrap border shadow-lg',
                        isWinner
                            ? 'text-gold-secondary border-gold-secondary/40'
                            : 'text-emerald-primary border-emerald-primary/30',
                    )}
                    style={{
                        fontSize: `${scale * 9}px`,
                        paddingLeft: `${scale * 8}px`,
                        paddingRight: `${scale * 8}px`,
                        paddingTop: `${scale * 2}px`,
                        paddingBottom: `${scale * 2}px`,
                    }}
                >
                    {handRank.replace(/_/g, ' ')}
                </div>
            )}

            <div className="text-center flex flex-col items-center">
                <h3 className="font-headline font-bold uppercase tracking-widest text-white/80" style={{ fontSize: `${scale * 10}px` }}>{player.name}</h3>
                {player.currentBet > 0 && (
                    <p className="font-bold text-emerald-primary/60" style={{ fontSize: `${scale * 9}px` }}>BET: ${player.currentBet}</p>
                )}
                {isDisconnected && (
                    <p className="font-bold text-amber-300 uppercase tracking-wider" style={{ fontSize: `${scale * 9}px` }}>
                        {typeof disconnectSecondsRemaining === 'number'
                            ? `Reconnect in ${formatDisconnectCountdown(disconnectSecondsRemaining)}`
                            : 'Waiting to reconnect...'}
                    </p>
                )}
                {player.isReadyForNextHand && (
                    <p className="font-bold text-emerald-primary uppercase tracking-wider" style={{ fontSize: `${scale * 9}px` }}>READY</p>
                )}
            </div>
        </div>
    );
};

