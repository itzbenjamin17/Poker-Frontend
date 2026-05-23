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
}

export function TablePlayers({
    orderedPlayers,
    currentPlayerId,
    myPlayerId,
    showdown,
    privateState,
    getSeatPosition,
    isCompactTable,
    nowMs
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

                return (
                    <div
                        key={p.id}
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
                        />

                        {canRenderCards && (
                            <div className={cn(
                                'absolute z-10 flex flex-col items-center',
                                seat.cardPlacement === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-2',
                                seat.cardPlacement === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
                                seat.cardPlacement === 'below' && 'left-1/2 top-full -translate-x-1/2 mt-2',
                            )}>
                                <div className="flex gap-1 justify-center">
                                    {displayCards.length > 0
                                        ? displayCards.map((c: string, ci: number) => (
                                            <motion.div
                                                key={`cards-${p.id}-${ci}`}
                                                initial={{ scale: 0.9, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                transition={{ delay: ci * 0.08 }}
                                            >
                                                <CardUI card={c} className={cn(
                                                    isSelf
                                                        ? isCompactTable ? 'w-8 h-12' : 'w-11 h-16 md:w-12 md:h-16'
                                                        : isCompactTable ? 'w-5 h-8' : 'w-7 h-10 md:w-8 md:h-12',
                                                    isShowdownWinner && shouldReveal && 'ring-2 ring-gold-secondary shadow-[0_0_18px_rgba(252,192,37,0.45)]',
                                                    'shadow-md',
                                                )} />
                                            </motion.div>
                                        ))
                                        : !isSelf
                                            ? [0, 1].map((ci) => (
                                                <CardUI
                                                    key={`hidden-${p.id}-${ci}`}
                                                    card=""
                                                    hidden
                                                    className={cn(
                                                        isCompactTable ? 'w-5 h-8' : 'w-7 h-10 md:w-8 md:h-12',
                                                        'shadow-md opacity-90',
                                                    )}
                                                />
                                            ))
                                            : null}
                                </div>

                                {showdownPlayer?.handRank && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.25 }}
                                        className={cn(
                                            'mt-1 text-[9px] font-headline font-bold uppercase tracking-widest bg-black/80 px-2 py-0.5 rounded-full whitespace-nowrap border shadow-lg',
                                            isShowdownWinner
                                                ? 'text-gold-secondary border-gold-secondary/40'
                                                : 'text-emerald-primary border-emerald-primary/30',
                                        )}
                                    >
                                        {showdownPlayer.handRank.replace(/_/g, ' ')}
                                    </motion.div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
