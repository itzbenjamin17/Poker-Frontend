import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { formatHandRank, formatHandRankShort } from '../lib/game';
import { CardUI, PlayerHandRank, PlayerPod } from './GameUI';
import {
    BASE_TABLE_HEIGHT,
    OPPONENT_RANK_MIN_SCALE,
    TABLE_ASPECT,
    avatarDiameter,
    fontPx,
    getSeatMetrics,
    isCompactCardScale,
    seatHandRankFits,
    seatStatusFitsFelt,
} from '../lib/tableGeometry';
import type { AvatarSize, TableDimensions, TableScale } from '../lib/tableGeometry';
import type { Player, SeatPosition, GameState } from '../types';
import { LABEL_PLAYER } from '../constants/strings';

/** Narrowest expanded panel (px); 176px at scale 1 would be unreadable at the scale floor. */
const MIN_PANEL_WIDTH_PX = 120;

export interface OpponentSeatsProps {
    orderedPlayers: Player[];
    currentPlayerId: string | undefined;
    myPlayerId: string | null;
    showdown: GameState | null;
    heroIndex: number;
    getSeatPosition: (playerIndex: number, totalPlayers: number, heroIndex: number) => SeatPosition;
    isCompactTable: boolean;
    isMobileLandscape?: boolean;
    nowMs: number;
    tableScale: TableScale;
    className?: string;
    tableDimensions?: TableDimensions;
}

export function OpponentSeats({
    orderedPlayers,
    currentPlayerId,
    myPlayerId,
    showdown,
    heroIndex,
    getSeatPosition,
    isCompactTable,
    isMobileLandscape,
    nowMs,
    tableScale,
    tableDimensions,
}: OpponentSeatsProps) {
    const [expandedOpponentId, setExpandedOpponentId] = useState<string | null>(null);

    const getDisconnectSecondsRemaining = (player: Player) => {
        if (player.status !== 'DISCONNECTED') return undefined;
        const deadline = typeof player.disconnectDeadlineEpochMs === 'number'
            ? player.disconnectDeadlineEpochMs
            : undefined;
        if (deadline === undefined) return undefined;
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    };

    const getPlayerKey = (player: Player, index: number) => player.id || `${player.name}-${index}`;

    const avatarSize: AvatarSize = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    // Anchor = avatar centre: cards sit at the avatar radius plus a scaled gap.
    const circleRadius = avatarDiameter(avatarSize, tableScale.avatar) / 2;
    const cardScale = tableScale.opponentCard;
    const compactCards = isCompactCardScale(cardScale);
    // Every offset below comes from the same helper as the seat footprint the ellipse is fitted with.
    const metrics = getSeatMetrics({
        avatarRadius: circleRadius,
        avatarScale: tableScale.avatar,
        spacingScale: tableScale.spacing,
        cardScale,
        compactFace: compactCards,
    });
    const xOffset = metrics.xOffset;
    const cardOverlap = metrics.cardWidth - metrics.strip;
    // Tiny tables: the rank label is sr-only on the seat and shown in the expanded panel.
    const hideHandRank = tableScale.overall < OPPONENT_RANK_MIN_SCALE;
    const labelTier = isCompactTable ? 'compact' : 'standard';

    // Expanded panel: fixed sizes scale with the table, with a legibility floor for the width.
    const { spacing } = tableScale;
    const panelWidth = Math.max(MIN_PANEL_WIDTH_PX, Math.round(spacing * 176));
    const panelFont = fontPx(10, tableScale.text);
    const ddStyle = { marginTop: `${Math.round(spacing * 2)}px` };

    const getBlindText = (player: Player) => {
        if (player.isBigBlind) return 'Big blind';
        if (player.isSmallBlind) return 'Small blind';
        return null;
    };

    const resolvedTableHeight = tableDimensions?.height ?? tableScale.overall * BASE_TABLE_HEIGHT;
    const resolvedTableWidth = tableDimensions?.width ?? resolvedTableHeight * TABLE_ASPECT;
    const effectiveTable: TableDimensions = { width: resolvedTableWidth, height: resolvedTableHeight };

    return (
        <>
            {orderedPlayers.map((p, i) => {
                if (p.id === myPlayerId) return null;

                const playerKey = getPlayerKey(p, i);
                const seat = getSeatPosition(i, orderedPlayers.length, heroIndex);
                const showdownPlayer = showdown?.players.find((sp) => sp.id === p.id);
                const isShowdownWinner = Boolean(showdownPlayer?.isWinner || p.isWinner);
                const isActiveTurn = currentPlayerId === p.id;
                const isExpanded = expandedOpponentId === playerKey;
                const canRenderCards = p.status === 'ACTIVE' || p.status === 'ALL_IN' || p.status === 'DISCONNECTED';
                const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
                const displayCards = shouldReveal ? showdownPlayer!.holeCards! : [];
                const blindText = getBlindText(p);
                const cardsBelow = canRenderCards && seat.cardPlacement === 'below';
                // Side seats put the label in its own row under the cards; everyone else keeps it under the avatar.
                const labelUnderCards = seat.labelPlacement === 'cards'
                    && (seat.cardPlacement === 'left' || seat.cardPlacement === 'right');
                const handRankText = formatHandRankShort(showdownPlayer?.handRank, labelTier);
                const handRankFull = formatHandRank(showdownPlayer?.handRank, showdownPlayer?.bestHand);
                // Cards placed below the avatar: the details start under the cards (upright height plus the face-down tilt).
                const detailsOffsetTop = cardsBelow ? metrics.belowDetailsOffsetTop : 0;
                const cardsGap = metrics.belowGap;
                const rowLeft = seat.cardPlacement === 'left';
                // The hand label has priority: it is tested alone, while bet/status lines must fit as well.
                const fitsLabel = seatHandRankFits(seat, effectiveTable, tableScale, labelTier, 0);
                // The status text can wrap to two lines (see statusBoxSize), so it reserves two.
                const extraLines = (p.currentBet > 0 ? 1 : 0) + (p.status === 'DISCONNECTED' || p.isReadyForNextHand ? 2 : 0);
                const fitsBoard = extraLines === 0 ? fitsLabel : seatHandRankFits(seat, effectiveTable, tableScale, labelTier, extraLines);
                const statusFitsFelt = seatStatusFitsFelt(seat, effectiveTable, tableScale, labelTier);
                const seatHideHandRank = hideHandRank || !fitsLabel;
                const seatHideBet = !fitsBoard || (isCompactTable && labelUnderCards && Boolean(handRankText));
                const seatHideStatus = !fitsBoard || !statusFitsFelt || (labelUnderCards && Boolean(handRankText));

                return (
                    <div
                        key={playerKey}
                        role="group"
                        aria-label={`${p.name} seat`}
                        data-testid={`opponent-seat-${playerKey}`}
                        data-seat-index={i}
                        data-is-active-turn={isActiveTurn}
                        data-is-winner={isShowdownWinner}
                        className={cn(
                            'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center',
                            isExpanded ? 'z-30' : 'z-20',
                        )}
                        style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                    >
                        <div className="relative">
                            <PlayerPod
                                player={p}
                                isCurrent={currentPlayerId === p.id}
                                isWinner={isShowdownWinner}
                                blindLabel={p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : undefined}
                                disconnectSecondsRemaining={getDisconnectSecondsRemaining(p)}
                                size={avatarSize}
                                scale={tableScale.avatar}
                                textScale={tableScale.text}
                                compact={isCompactTable || seat.cardPlacement === 'below'}
                                detailsOffsetTop={detailsOffsetTop}
                                hideBet={seatHideBet}
                                hideHandRank={seatHideHandRank}
                                hideStatus={seatHideStatus}
                                handRank={showdownPlayer?.handRank}
                                bestHand={showdownPlayer?.bestHand}
                                handRankTier={labelTier}
                                handRankPlacement={labelUnderCards ? 'external' : 'details'}
                            />
                            <button
                                type="button"
                                aria-label={`${p.name} seat details`}
                                aria-expanded={isExpanded}
                                aria-controls={`opponent-seat-details-${playerKey}`}
                                onClick={() => setExpandedOpponentId((current) => current === playerKey ? null : playerKey)}
                                className="absolute inset-0 z-30 rounded-full text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                            />
                        </div>

                        {canRenderCards && (
                            <div
                                data-testid="seat-cards"
                                className="absolute z-10 flex flex-col items-center"
                                style={cardsBelow
                                    ? {
                                        top: `${circleRadius * 2 + cardsGap}px`,
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                    }
                                    : {
                                        top: `${circleRadius}px`,
                                        left: '50%',
                                        transform: seat.cardPlacement === 'left'
                                            ? `translate(calc(-100% - ${xOffset}px), -50%)`
                                            : `translate(${xOffset}px, -50%)`,
                                    }}
                            >
                                {/* Fan: the front card is offset by `strip`, so the rear card's corner index (rank over suit) stays uncovered. */}
                                <div className="flex justify-start">
                                    {displayCards.length > 0
                                        ? displayCards.map((c: string, ci: number) => {
                                            const isPartOfBestHand = isShowdownWinner && shouldReveal && showdownPlayer?.bestHand?.includes(c);
                                            const shouldDim = isShowdownWinner && shouldReveal && !isPartOfBestHand;
                                            const coveredOnLeft = Boolean(
                                                shouldDim && ci > 0 && showdownPlayer?.bestHand?.includes(displayCards[ci - 1]),
                                            );
                                            return (
                                                <motion.div
                                                    key={`cards-${p.id}-${ci}`}
                                                    initial={{ scale: 0.9, opacity: 0 }}
                                                    animate={{ scale: 1, opacity: 1 }}
                                                    transition={{ delay: ci * 0.08 }}
                                                    style={{
                                                        marginLeft: ci > 0 ? `-${cardOverlap}px` : '0',
                                                        zIndex: isPartOfBestHand ? ci + displayCards.length : ci,
                                                    }}
                                                >
                                                    <CardUI
                                                        card={c}
                                                        scale={cardScale}
                                                        compact={compactCards}
                                                        cornerIndex={coveredOnLeft ? 'right' : 'left'}
                                                        className={cn(
                                                            isPartOfBestHand && 'ring-2 ring-gold-secondary/70 shadow-[0_0_16px_rgba(252,211,77,0.3)]',
                                                            shouldDim && 'opacity-55 grayscale-[50%]',
                                                            'shadow-md',
                                                        )}
                                                    />
                                                </motion.div>
                                            );
                                        })
                                        : [0, 1].map((ci) => (
                                            <div
                                                key={`hidden-${p.id}-${ci}`}
                                                style={{
                                                    marginLeft: ci > 0 ? `-${cardOverlap}px` : '0',
                                                    transform: ci > 0 ? `rotate(6deg) translateY(${cardScale * 3}px)` : `rotate(-6deg)`,
                                                    zIndex: ci,
                                                }}
                                            >
                                                <CardUI
                                                    card=""
                                                    scale={cardScale}
                                                    hidden
                                                    className="shadow-md opacity-90"
                                                />
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        {labelUnderCards && handRankText && (
                            /* Hand rank under the cards, centred on the stack; it aligns to the avatar-side edge (and grows outward) when wider. */
                            <div
                                className="absolute z-20 flex pointer-events-none"
                                style={{
                                    top: `${metrics.labelRowTop}px`,
                                    width: `${metrics.labelRowWidth}px`,
                                    ...(rowLeft
                                        ? { right: `calc(50% + ${metrics.labelRowStart}px)`, flexDirection: 'row-reverse' as const }
                                        : { left: `calc(50% + ${metrics.labelRowStart}px)` }),
                                }}
                            >
                                <div style={{ marginInline: 'auto' }}>
                                    <PlayerHandRank
                                        label={handRankText}
                                        title={handRankFull ?? undefined}
                                        scale={tableScale.avatar}
                                        textScale={tableScale.text}
                                        compact={isCompactTable}
                                        hidden={seatHideHandRank}
                                    />
                                </div>
                            </div>
                        )}

                        {isExpanded && (() => {
                            const openUpward = seat.verticalZone === 'bottom' || seat.top > 55;
                            return (
                            <motion.div
                                id={`opponent-seat-details-${playerKey}`}
                                role="region"
                                aria-label={`${p.name} expanded details`}
                                data-placement={openUpward ? 'top' : 'bottom'}
                                initial={{ opacity: 0, y: openUpward ? -6 : 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: openUpward ? -4 : 4 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                className={cn(
                                    'absolute rounded-lg border border-white/10 bg-surface-high/95 text-left shadow-[0_14px_45px_rgba(0,0,0,0.35)] backdrop-blur-md',
                                    openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
                                    seat.panelPlacement === 'right' && 'right-0',
                                    seat.panelPlacement === 'left' && 'left-0',
                                )}
                                style={{
                                    ...(openUpward
                                        ? { marginBottom: `${Math.round(spacing * 8)}px` }
                                        : { marginTop: `${Math.round(spacing * 8)}px` }),
                                    width: `${panelWidth}px`,
                                    padding: `${Math.round(spacing * 12)}px`,
                                }}
                            >
                                <dl
                                    className="grid grid-cols-2 uppercase tracking-[0.12em]"
                                    style={{ gap: `${Math.round(spacing * 8)}px`, fontSize: `${panelFont}px` }}
                                >
                                    <div className="col-span-2">
                                        <dt className="text-zinc-500">{LABEL_PLAYER}</dt>
                                        <dd style={ddStyle} className="font-bold text-white break-words normal-case">{p.name}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-zinc-500">Stack</dt>
                                        <dd style={ddStyle} className="font-bold text-gold-secondary">{p.chips.toLocaleString()}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-zinc-500">Status</dt>
                                        <dd style={ddStyle} className="font-bold text-zinc-200">{p.status.replace(/_/g, ' ')}</dd>
                                    </div>
                                    {p.currentBet > 0 && (
                                        <div className="col-span-2">
                                            <dt className="text-zinc-500">Current bet</dt>
                                            <dd style={ddStyle} className="font-bold text-emerald-primary">Bet {p.currentBet.toLocaleString()}</dd>
                                        </div>
                                    )}
                                    {handRankFull && (
                                        <div className="col-span-2">
                                            <dt className="text-zinc-500">Hand</dt>
                                            <dd style={ddStyle} className="font-bold text-emerald-primary">{handRankFull}</dd>
                                        </div>
                                    )}
                                    {blindText && (
                                        <div className="col-span-2">
                                            <dt className="text-zinc-500">Position</dt>
                                            <dd style={ddStyle} className="font-bold text-zinc-200">{blindText}</dd>
                                        </div>
                                    )}
                                </dl>
                            </motion.div>
                            );
                        })()}
                    </div>
                );
            })}
        </>
    );
}
