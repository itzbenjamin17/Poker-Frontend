import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { CardUI, PlayerPod } from './GameUI';
import type { Player, SeatPosition, GameState } from '../types';

interface TablePlayersProps {
    orderedPlayers: Player[];
    currentPlayerId: string | undefined;
    myPlayerId: string | null;
    showdown: GameState | null;
    privateState: { holeCards: string[] } | null;
    getSeatPosition: (index: number, total: number) => SeatPosition;
    isCompactTable: boolean;
    nowMs: number;
    scale: number;
}

export function TablePlayers({
                                 orderedPlayers,
                                 currentPlayerId,
                                 myPlayerId,
                                 showdown,
                                 privateState,
                                 getSeatPosition,
                                 isCompactTable,
                                 nowMs,
                                 scale
                             }: TablePlayersProps) {

    const getDisconnectSecondsRemaining = (player: Player) => {
        if (player.status !== 'DISCONNECTED') return undefined;
        const deadline = typeof player.disconnectDeadlineEpochMs === 'number'
            ? player.disconnectDeadlineEpochMs
            : undefined;
        if (deadline === undefined) return undefined;
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    };

    return (
        <>
            {orderedPlayers.map((p, i) => {
                const seat = getSeatPosition(i, orderedPlayers.length);
                const showdownPlayer = showdown?.players.find((sp) => sp.id === p.id);
                const isShowdownWinner = Boolean(showdownPlayer?.isWinner);
                const isSelf = p.id === myPlayerId;
                const canRenderCards = p.status === 'ACTIVE' || p.status === 'ALL_IN' || p.status === 'DISCONNECTED';
                const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
                const playerPrivateCards = isSelf ? privateState?.holeCards ?? [] : [];
                const displayCards = shouldReveal ? showdownPlayer!.holeCards! : playerPrivateCards;

                const baseCardWidth = isSelf ? (isCompactTable ? 32 : 48) : (isCompactTable ? 20 : 32);
                const baseCardHeight = isSelf ? (isCompactTable ? 48 : 64) : (isCompactTable ? 32 : 48);

                return (
                    <div
                        key={p.id}
                        role="group"
                        aria-label={isSelf ? `${p.name} hero seat` : `${p.name} seat`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20"
                        style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                    >
                        <PlayerPod
                            player={p}
                            isCurrent={currentPlayerId === p.id}
                            isWinner={isShowdownWinner}
                            blindLabel={p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : undefined}
                            disconnectSecondsRemaining={getDisconnectSecondsRemaining(p)}
                            size={isCompactTable ? 'sm' : 'md'}
                            scale={scale}
                            handRank={showdownPlayer?.handRank}
                        />

                        {canRenderCards && (
                            <div
                                className={cn(
                                    'absolute z-10 flex flex-col items-center',
                                    seat.cardPlacement === 'left' && 'right-full',
                                    seat.cardPlacement === 'right' && 'left-full',
                                    seat.cardPlacement === 'below' && 'left-1/2 top-full -translate-x-1/2',
                                )}
                                style={{
                                    // For left/right: target the circle center, not the mid-point of the
                                    // full pod height (which includes name + bet labels below the circle).
                                    // ~35% from top approximates the circle center for a circle+text pod.
                                    top: seat.cardPlacement !== 'below' ? '35%' : undefined,
                                    transform: seat.cardPlacement !== 'below' ? 'translateY(-50%)' : undefined,
                                    // Minimum gap of 12px so the timer ring / blind badge never clips into cards
                                    marginRight: seat.cardPlacement === 'left' ? `${Math.max(12, scale * 16)}px` : undefined,
                                    marginLeft: seat.cardPlacement === 'right' ? `${Math.max(12, scale * 16)}px` : undefined,
                                    marginTop: seat.cardPlacement === 'below' ? `${Math.max(8, scale * 12)}px` : undefined,
                                }}
                            >
                                <div className="flex justify-center" style={{ gap: `${scale * 4}px` }}>
                                    {displayCards.length > 0
                                        ? displayCards.map((c: string, ci: number) => (
                                            <motion.div
                                                key={`cards-${p.id}-${ci}`}
                                                initial={{ scale: 0.9, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                transition={{ delay: ci * 0.08 }}
                                            >
                                                <CardUI
                                                    card={c}
                                                    scale={scale}
                                                    className={cn(
                                                        isShowdownWinner && shouldReveal && 'ring-2 ring-emerald-primary/70 shadow-[0_0_16px_rgba(170,234,208,0.24)]',
                                                        'shadow-md',
                                                    )}
                                                    style={{
                                                        width: `${scale * baseCardWidth}px`,
                                                        height: `${scale * baseCardHeight}px`
                                                    }}
                                                />
                                            </motion.div>
                                        ))
                                        : !isSelf
                                            ? [0, 1].map((ci) => (
                                                <CardUI
                                                    key={`hidden-${p.id}-${ci}`}
                                                    card=""
                                                    scale={scale}
                                                    hidden
                                                    className={cn(
                                                        'shadow-md opacity-90',
                                                    )}
                                                    style={{
                                                        width: `${scale * baseCardWidth}px`,
                                                        height: `${scale * baseCardHeight}px`
                                                    }}
                                                />
                                            ))
                                            : null}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
