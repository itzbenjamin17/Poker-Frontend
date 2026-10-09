import React from 'react';
import { Crown } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatHandRank, formatHandRankShort } from '../lib/game';
import {
    CARD_SIZE_MULTIPLIER,
    MIN_FONT_PX,
    avatarDiameter,
    cornerIndexMetrics,
    fontPx,
    statusMaxWidthPx,
    winnerDecoration,
} from '../lib/tableGeometry';
import type { AvatarSize, CardSize } from '../lib/tableGeometry';
import type { Player, TableTier } from '../types';

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

export interface CardUIProps {
    card: string;
    scale?: number;
    size?: CardSize;
    hidden?: boolean;
    /** Single centred rank + suit face for cards too small for corner indices. */
    compact?: boolean;
    /**
     * Opponent seat cards: the rank sits over a small suit at the top-left, so a card overlapped by its neighbour still
     * shows both glyphs in the strip the front card leaves uncovered. Hero and board cards leave this off.
     */
    cornerIndex?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

export const CardUI: React.FC<CardUIProps> = ({
    card,
    scale = 1,
    size = 'md',
    hidden,
    compact = false,
    cornerIndex = false,
    className,
    style,
}) => {
    const s = scale * CARD_SIZE_MULTIPLIER[size];

    const cardWidth = Math.round(s * 48);
    const cardHeight = Math.round(s * 64);
    const borderRadius = Math.round(s * 6);

    if (hidden) {
        const availableW = Math.max(0, cardWidth - 4);
        const availableH = Math.max(0, cardHeight - 4);
        const innerW = Math.min(Math.round(s * 32), availableW);
        const innerH = Math.min(Math.round(s * 48), availableH);
        const showInner = innerW >= 4 && innerH >= 4;

        return (
            <div
                data-testid="card"
                aria-label="Hidden Card"
                className={cn('bg-emerald-container rounded-md border-2 border-white/20 flex items-center justify-center shadow-lg shrink-0 overflow-hidden', className)}
                style={{
                    width: `${cardWidth}px`,
                    height: `${cardHeight}px`,
                    borderRadius: `${borderRadius}px`,
                    ...style,
                }}
            >
                {showInner && (
                    <div
                        className="border border-white/10 rounded-sm opacity-20"
                        style={{
                            width: `${innerW}px`,
                            height: `${innerH}px`,
                            borderRadius: `${Math.round(s * 4)}px`,
                        }}
                    />
                )}
            </div>
        );
    }

    const value = card.slice(0, -1);
    const suitKey = card.slice(-1);
    const suit = SUITS[suitKey] || { icon: '?', color: 'text-zinc-400', name: 'Unknown' };
    const rankName = RANKS[value] || value;
    const label = `${rankName} of ${suit.name}`;
    
    const displayValue = value === 'T' ? '10' : value;

    if (cornerIndex) {
        const index = cornerIndexMetrics(s, compact);
        const glyphs = (
            <div className={cn('self-start flex flex-col items-start leading-none', suit.color)}>
                <span data-testid="card-rank" className="font-bold leading-none" style={{ fontSize: `${index.rankFontPx}px` }}>{displayValue}</span>
                <span data-testid="card-suit" className="leading-none" style={{ fontSize: `${index.suitFontPx}px` }}>{suit.icon}</span>
            </div>
        );
        if (compact) {
            // Tiny cards: the corner index is the whole face.
            return (
                <div
                    data-testid="card"
                    data-compact="true"
                    role="img"
                    aria-label={label}
                    className={cn('bg-white rounded-md flex flex-col items-start shadow-xl relative overflow-hidden shrink-0 select-none', className)}
                    style={{
                        width: `${cardWidth}px`,
                        height: `${cardHeight}px`,
                        padding: `${index.paddingPx}px`,
                        borderRadius: `${borderRadius}px`,
                        ...style,
                    }}
                >
                    {glyphs}
                </div>
            );
        }

        // Regular face: corner index, plus the centre suit and the mirrored index so the front card still looks like a
        // full card. The centre suit shrinks (never below the font floor) when the card is too short for all of it.
        const room = cardHeight - 2 * index.paddingPx - 2 * index.rankFontPx - index.suitFontPx;
        const centreFont = Math.max(MIN_FONT_PX, Math.min(Math.round(s * 20), room));
        return (
            <div
                data-testid="card"
                role="img"
                aria-label={label}
                className={cn('bg-white rounded-md flex flex-col items-center justify-between shadow-xl relative overflow-hidden shrink-0 select-none', className)}
                style={{
                    width: `${cardWidth}px`,
                    height: `${cardHeight}px`,
                    padding: `${index.paddingPx}px`,
                    borderRadius: `${borderRadius}px`,
                    ...style,
                }}
            >
                {glyphs}
                <div className={cn('leading-none', suit.color)} style={{ fontSize: `${centreFont}px` }}>{suit.icon}</div>
                <div className={cn('font-bold self-end rotate-180 leading-none', suit.color)} style={{ fontSize: `${index.rankFontPx}px` }}>{displayValue}</div>

                {/* Subtle watermark */}
                <div className={cn('absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none text-4xl leading-none', suit.color)} style={{ fontSize: `${Math.round(s * 40)}px` }}>
                    {suit.icon}
                </div>
            </div>
        );
    }

    if (compact) {
        const faceFont = fontPx(14, s);
        return (
            <div
                data-testid="card"
                data-compact="true"
                role="img"
                aria-label={label}
                className={cn('bg-white rounded-md flex flex-col items-center justify-center shadow-xl relative overflow-hidden shrink-0 select-none', className)}
                style={{
                    width: `${cardWidth}px`,
                    height: `${cardHeight}px`,
                    padding: `${Math.round(s * 2)}px`,
                    borderRadius: `${borderRadius}px`,
                    ...style,
                }}
            >
                <span data-testid="card-rank" className={cn('font-bold leading-none', suit.color)} style={{ fontSize: `${faceFont}px` }}>{displayValue}</span>
                <span data-testid="card-suit" className={cn('leading-none', suit.color)} style={{ fontSize: `${faceFont}px` }}>{suit.icon}</span>
            </div>
        );
    }

    return (
        <div
            data-testid="card"
            role="img"
            aria-label={label}
            className={cn('bg-white rounded-md flex flex-col items-center justify-between shadow-xl relative overflow-hidden shrink-0 select-none', className)}
            style={{
                width: `${cardWidth}px`,
                height: `${cardHeight}px`,
                padding: `${Math.round(s * 4)}px`,
                borderRadius: `${borderRadius}px`,
                ...style,
            }}
        >
            <div data-testid="card-rank" className={cn('font-bold self-start leading-none', suit.color)} style={{ fontSize: `${Math.round(s * 12)}px` }}>{displayValue}</div>
            <div data-testid="card-suit" className={cn('leading-none', suit.color)} style={{ fontSize: `${Math.round(s * 20)}px` }}>{suit.icon}</div>
            <div className={cn('font-bold self-end rotate-180 leading-none', suit.color)} style={{ fontSize: `${Math.round(s * 12)}px` }}>{displayValue}</div>

            {/* Subtle watermark */}
            <div className={cn('absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none text-4xl leading-none', suit.color)} style={{ fontSize: `${Math.round(s * 40)}px` }}>
                {suit.icon}
            </div>
        </div>
    );
};

const BASE_INITIALS_FONT: Record<AvatarSize, number> = { xs: 14, sm: 16, md: 20 };

interface PlayerPartScale {
    /** Spacing / badge scale (follows the avatar). */
    scale: number;
    /** Font scale; every font is floored at MIN_FONT_PX. */
    textScale: number;
}

/** The avatar disc and everything pinned to it. Fills the pod root box. */
export function PlayerAvatar({
    player,
    isCurrent,
    isWinner,
    blindLabel,
    size,
    scale,
    textScale,
}: PlayerPartScale & {
    player: Player;
    isCurrent?: boolean;
    isWinner?: boolean;
    blindLabel?: 'SB' | 'BB';
    size: AvatarSize;
}) {
    const isDisconnected = player.status === 'DISCONNECTED';

    return (
        <div
            data-testid="player-avatar"
            className={cn(
                'w-full h-full relative rounded-full flex items-center justify-center transition-[box-shadow,opacity,filter] duration-500',
                // The winner's gold ring and glow are an inline box-shadow that scales with the table (see winnerDecoration).
                isWinner
                    ? ''
                    : isCurrent
                        ? 'ring-2 ring-emerald-primary ring-offset-3 ring-offset-surface'
                        : 'ring-1 ring-white/10',
                player.status === 'FOLDED' ? 'opacity-40 grayscale' : 'opacity-100',
                isDisconnected ? 'ring-2 ring-amber-400/80 opacity-80' : ''
            )}
            style={isWinner ? { boxShadow: winnerDecoration(scale).boxShadow } : undefined}
        >
            <div className="w-full h-full rounded-full bg-surface-highest flex items-center justify-center overflow-hidden border border-white/5">
                <span
                    className={cn(
                        'font-headline font-bold',
                        isWinner ? 'text-gold-secondary' : 'text-emerald-primary/40'
                    )}
                    style={{ fontSize: `${fontPx(BASE_INITIALS_FONT[size], textScale)}px` }}
                >
                    {player.name.slice(0, 2).toUpperCase()}
                </span>
                {isCurrent && <span className="sr-only">Active turn</span>}
                {isWinner && <span className="sr-only">Winner</span>}
                {player.status === 'FOLDED' && <span className="sr-only">Folded</span>}
            </div>

            {isWinner && (
                <span
                    data-testid="seat-winner-crown"
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 flex items-center justify-center rounded-full border border-surface bg-gold-secondary text-surface shadow-md"
                    style={{ width: `${scale * 18}px`, height: `${scale * 18}px` }}
                >
                    <Crown size={scale * 11} strokeWidth={3} />
                </span>
            )}

            {blindLabel && (
                <div
                    data-testid="seat-blind-badge"
                    className={cn(
                        'absolute border shadow-md flex items-center justify-center leading-none',
                        blindLabel === 'BB'
                            ? 'bg-gold-secondary text-surface border-gold-dim'
                            : 'bg-emerald-primary text-surface border-emerald-dim'
                    )}
                    style={{
                        left: `-${scale * 8}px`,
                        top: `-${scale * 8}px`,
                        paddingLeft: `${scale * 6}px`,
                        paddingRight: `${scale * 6}px`,
                        paddingTop: `${Math.max(1, Math.round(scale * 1.5))}px`,
                        paddingBottom: `${Math.max(1, Math.round(scale * 1.5))}px`,
                        borderRadius: `${scale * 999}px`,
                    }}
                >
                    <span className="font-headline font-extrabold tracking-wider leading-none" style={{ fontSize: `${fontPx(9, textScale)}px` }}>{blindLabel}</span>
                </div>
            )}

            {/* Chips Badge */}
            <div
                data-testid="seat-chip-badge"
                className="absolute bg-surface-high border border-white/10 shadow-lg flex items-center justify-center whitespace-nowrap leading-none"
                style={{
                    bottom: `-${scale * 6}px`,
                    paddingLeft: `${scale * 6}px`,
                    paddingRight: `${scale * 6}px`,
                    paddingTop: `${Math.max(1, Math.round(scale * 1.5))}px`,
                    paddingBottom: `${Math.max(1, Math.round(scale * 1.5))}px`,
                    borderRadius: `${scale * 999}px`,
                }}
            >
                <span className="font-bold text-gold-secondary leading-none" style={{ fontSize: `${fontPx(size === 'sm' ? 8 : 9, textScale)}px` }}>{player.chips.toLocaleString()}</span>
            </div>

            {/* Action Indicator */}
            {isCurrent && !isDisconnected && !isWinner && (
                <div
                    data-testid="seat-turn-indicator"
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
                    data-testid="seat-offline-badge"
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
                    <span className="font-headline font-extrabold tracking-wider" style={{ fontSize: `${fontPx(8, textScale)}px` }}>OFF</span>
                </div>
            )}
        </div>
    );
}

/**
 * Hand rank label. `hidden` keeps the text for screen readers only, so it never
 * takes space next to other seats; `compact` uses a narrower label.
 */
export function PlayerHandRank({
    label,
    title,
    scale,
    textScale,
    compact = false,
    hidden = false,
}: PlayerPartScale & { label: string; title?: string; compact?: boolean; hidden?: boolean }) {
    if (hidden) {
        return <span data-testid="seat-hand-rank" title={title} className="sr-only">{label}</span>;
    }
    return (
        <div 
            data-testid="seat-hand-rank"
            title={title}
            className="bg-surface-higher/90 backdrop-blur-md border border-emerald-primary/30 z-20 whitespace-nowrap shadow-lg flex items-center justify-center"
            style={{
                padding: compact ? `${scale * 2}px ${scale * 3}px` : `${scale * 4}px ${scale * 8}px`,
                borderRadius: `${scale * 6}px`,
            }}
        >
            <span 
                className={cn(
                    'font-bold text-emerald-primary/90 uppercase',
                    compact ? 'tracking-wider' : 'tracking-widest',
                )}
                style={{ fontSize: `${fontPx(9, textScale)}px` }}
            >
                {label}
            </span>
        </div>
    );
}

export function PlayerBet({
    amount,
    textScale,
    hidden = false,
}: { amount: number; textScale: number; hidden?: boolean }) {
    return (
        <p
            data-testid="seat-bet"
            className={cn('font-bold text-emerald-primary/60', hidden && 'sr-only')}
            style={hidden ? undefined : { fontSize: `${fontPx(9, textScale)}px` }}
        >
            BET: {amount.toLocaleString()}
        </p>
    );
}

const formatDisconnectCountdown = (secondsRemaining: number) => {
    const clamped = Math.max(0, secondsRemaining);
    const minutes = Math.floor(clamped / 60).toString().padStart(2, '0');
    const seconds = (clamped % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

export function PlayerStatus({
    isDisconnected,
    isReady,
    disconnectSecondsRemaining,
    textScale,
    maxWidthPx,
    hidden = false,
}: {
    isDisconnected: boolean;
    isReady: boolean;
    disconnectSecondsRemaining?: number;
    textScale: number;
    /** Bounds the text width: it wraps (at most two lines) instead of growing with the countdown. */
    maxWidthPx?: number;
    hidden?: boolean;
}) {
    const fontSize = `${fontPx(9, textScale)}px`;
    // `width: max-content` keeps short texts ("READY") as narrow as they are; the cap makes long ones wrap.
    const bounded = maxWidthPx === undefined
        ? undefined
        : { width: 'max-content', maxWidth: `${maxWidthPx}px` };
    return (
        <>
            {isDisconnected && (
                <p
                    data-testid="seat-status"
                    className={cn(
                        'font-bold text-amber-300 uppercase tracking-wider whitespace-normal text-center break-words',
                        hidden && 'sr-only',
                    )}
                    style={hidden ? undefined : { fontSize, ...bounded }}
                >
                    {typeof disconnectSecondsRemaining === 'number'
                        ? `Reconnect in ${formatDisconnectCountdown(disconnectSecondsRemaining)}`
                        : 'Waiting to reconnect...'}
                </p>
            )}
            {isReady && (
                <p
                    data-testid="seat-status"
                    className={cn(
                        'font-bold text-emerald-primary uppercase tracking-wider',
                        hidden && 'sr-only',
                    )}
                    style={hidden ? undefined : { fontSize }}
                >
                    READY
                </p>
            )}
        </>
    );
}

export const PlayerPod = ({
    player,
    isCurrent,
    isWinner,
    blindLabel,
    size = 'md',
    disconnectSecondsRemaining,
    className,
    scale = 1,
    textScale = scale,
    handRank,
    bestHand,
    hideBet = false,
    hideHandRank = false,
    hideStatus = false,
    compact = false,
    detailsPlacement = 'below',
    detailsOffsetTop = 0,
    handRankPlacement = 'details',
    handRankTier,
}: {
    player: Player;
    isCurrent?: boolean;
    isWinner?: boolean;
    blindLabel?: 'SB' | 'BB';
    size?: AvatarSize;
    disconnectSecondsRemaining?: number;
    className?: string;
    /** Avatar, badge and spacing scale. */
    scale?: number;
    /** Font scale (defaults to `scale`); rendered fonts never drop below 8px. */
    textScale?: number;
    handRank?: string;
    bestHand?: string[];
    /** Keep the bet text for screen readers only. */
    hideBet?: boolean;
    /** Keep the hand rank text for screen readers only. */
    hideHandRank?: boolean;
    /** Keep the status text for screen readers only. */
    hideStatus?: boolean;
    /** Narrower hand rank label for crowded tables. */
    compact?: boolean;
    /** Where rank, bet and status hang: below the avatar (default) or to its left. The anchor never moves. */
    detailsPlacement?: 'below' | 'left';
    /** Extra px between the avatar and details hanging below (room for cards placed below the avatar). */
    detailsOffsetTop?: number;
    /**
     * Where the hand rank label lives: in the details hanging off the avatar (default), or 'external', where the
     * caller renders it elsewhere (under the hole cards) and the pod renders none. The pod box stays the avatar box.
     */
    handRankPlacement?: 'details' | 'external';
    /** Seat label ladder tier. Given: the label shows the short category form and the full text goes to `title`. Omitted (hero): full text. */
    handRankTier?: TableTier;
}) => {
    const isDisconnected = player.status === 'DISCONNECTED';
    const diameter = avatarDiameter(size, scale);

    const handRankFormatted = formatHandRank(handRank, bestHand || player.bestHand);
    const handRankText = handRankTier ? formatHandRankShort(handRank, handRankTier) : handRankFormatted;
    const showHandRank = Boolean(handRankText) && handRankPlacement === 'details';
    const hasBottomDetails = Boolean(
        showHandRank ||
        player.currentBet > 0 ||
        isDisconnected ||
        player.isReadyForNextHand
    );

    return (
        /* Root container matches avatar diameter exactly so geometric center = avatar center */
        <div
            data-testid="player-pod"
            className={cn('relative flex items-center justify-center shrink-0', className)}
            style={{
                width: `${diameter}px`,
                height: `${diameter}px`,
            }}
        >
            <PlayerAvatar
                player={player}
                isCurrent={isCurrent}
                isWinner={isWinner}
                blindLabel={blindLabel}
                size={size}
                scale={scale}
                textScale={textScale}
            />

            {/* Extracted Bottom-Heavy Elements: Positioned absolutely so they do not alter the bounding box center */}
            {hasBottomDetails && (
                <div
                    data-testid="seat-details"
                    data-details-placement={detailsPlacement}
                    className={cn(
                        'absolute flex flex-col pointer-events-none whitespace-nowrap z-20',
                        detailsPlacement === 'left'
                            ? 'right-full top-1/2 -translate-y-1/2 items-end'
                            : 'top-full left-1/2 -translate-x-1/2 items-center',
                    )}
                    style={{
                        ...(detailsPlacement === 'left'
                            ? { marginRight: `${scale * 8}px` }
                            : { marginTop: `${scale * 8 + detailsOffsetTop}px` }),
                        gap: `${scale * 4}px`,
                    }}
                >
                    {showHandRank && handRankText && (
                        <PlayerHandRank
                            label={handRankText}
                            title={handRankTier ? handRankFormatted ?? undefined : undefined}
                            scale={scale}
                            textScale={textScale}
                            compact={compact}
                            hidden={hideHandRank}
                        />
                    )}

                    <div className="text-center flex flex-col items-center">
                        {player.currentBet > 0 && (
                            <PlayerBet amount={player.currentBet} textScale={textScale} hidden={hideBet} />
                        )}
                        <PlayerStatus
                            isDisconnected={isDisconnected}
                            isReady={Boolean(player.isReadyForNextHand)}
                            disconnectSecondsRemaining={disconnectSecondsRemaining}
                            textScale={textScale}
                            maxWidthPx={statusMaxWidthPx(diameter / 2, fontPx(9, textScale))}
                            hidden={hideStatus}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
