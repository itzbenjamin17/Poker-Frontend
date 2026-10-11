import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { CardUI, PlayerPod } from './GameUI';
import { avatarDiameter, isCompactCardScale } from '../lib/tableGeometry';
import type { AvatarSize, TableScale } from '../lib/tableGeometry';
import type { Player, GameState } from '../types';

export interface HeroSeatProps {
    player: Player;
    currentPlayerId?: string;
    showdown?: GameState | null;
    privateCards?: string[];
    isCompactTable: boolean;
    isMobileLandscape?: boolean;
    nowMs: number;
    tableScale: TableScale;
    className?: string;
    seatIndex?: number;
}

export function HeroSeat({
    player,
    currentPlayerId,
    showdown,
    privateCards = [],
    isCompactTable,
    isMobileLandscape,
    nowMs,
    tableScale,
    className,
    seatIndex,
}: HeroSeatProps) {
    const showdownPlayer = showdown?.players.find((sp) => sp.id === player.id);
    const isShowdownWinner = Boolean(showdownPlayer?.isWinner || player.isWinner);
    const isActiveTurn = currentPlayerId === player.id;
    const canRenderCards = player.status === 'ACTIVE' || player.status === 'ALL_IN' || player.status === 'DISCONNECTED';
    const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
    const displayCards = shouldReveal ? showdownPlayer!.holeCards! : privateCards;

    // The hero is never thinned out by table density, so the avatar follows the overall scale.
    const avatarScale = tableScale.overall;
    const avatarSize: AvatarSize = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    // Anchor = avatar centre: cards sit at the avatar radius plus a scaled gap.
    const circleRadius = avatarDiameter(avatarSize, avatarScale) / 2;
    const xOffset = circleRadius + tableScale.spacing * 16 + 4;
    const cardScale = tableScale.heroCard;
    const compactCards = isCompactCardScale(cardScale, 'lg');

    const getDisconnectSecondsRemaining = () => {
        if (player.status !== 'DISCONNECTED') return undefined;
        const deadline = typeof player.disconnectDeadlineEpochMs === 'number'
            ? player.disconnectDeadlineEpochMs
            : undefined;
        if (deadline === undefined) return undefined;
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    };

    return (
        <div
            role="group"
            aria-label={`${player.name} hero seat`}
            data-testid="hero-seat"
            data-seat-index={seatIndex ?? 0}
            data-is-active-turn={isActiveTurn}
            data-is-winner={isShowdownWinner}
            className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20',
                className,
            )}
            style={{ left: '50%', top: '86%' }}
        >
            <PlayerPod
                player={player}
                isCurrent={currentPlayerId === player.id}
                isWinner={isShowdownWinner}
                blindLabel={player.isBigBlind ? 'BB' : player.isSmallBlind ? 'SB' : undefined}
                disconnectSecondsRemaining={getDisconnectSecondsRemaining()}
                size={avatarSize}
                scale={avatarScale}
                textScale={tableScale.text}
                detailsPlacement="left"
                handRank={showdownPlayer?.handRank ?? player.handRank}
                bestHand={showdownPlayer?.bestHand ?? player.bestHand}
            />

            {canRenderCards && (
                <div
                    data-testid="hero-cards"
                    className="absolute z-10 flex flex-col items-center"
                    style={{
                        top: `${circleRadius}px`,
                        left: '50%',
                        transform: `translate(${xOffset}px, -50%)`,
                    }}
                >
                    <div className="flex justify-center" style={{ gap: `${cardScale * 4}px` }}>
                        {displayCards.map((c: string, ci: number) => {
                            const isPartOfBestHand = isShowdownWinner && shouldReveal && showdownPlayer?.bestHand?.includes(c);
                            const shouldDim = isShowdownWinner && shouldReveal && !isPartOfBestHand;
                            return (
                                <motion.div
                                    key={`hero-cards-${player.id}-${ci}`}
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: ci * 0.08 }}
                                >
                                    <CardUI
                                        card={c}
                                        scale={cardScale}
                                        size="lg"
                                        compact={compactCards}
                                        className={cn(
                                            isPartOfBestHand && 'ring-2 ring-gold-secondary/70 shadow-[0_0_16px_rgba(252,211,77,0.3)]',
                                            shouldDim && 'opacity-40 grayscale-[50%]',
                                            'shadow-md',
                                        )}
                                    />
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
