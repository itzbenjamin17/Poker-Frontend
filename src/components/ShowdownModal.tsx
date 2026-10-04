import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, useMotionValue } from 'motion/react';
import { Trophy } from 'lucide-react';
import type { GameState } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_PROCESSING,
    SHOWDOWN_TIE_PREFIX, SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_POT_SPLIT, SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    ARIA_ROUND_RESULT,
} from '../constants/strings';

interface ShowdownModalProps {
    showdownResult: GameState | null;
    viewerPlayerId?: string | null;
}

import { formatHandRank } from '../lib/game';

export function ShowdownModal({ showdownResult }: ShowdownModalProps) {
    const prefersReducedMotion = useReducedMotion();

    // Unconditionally instantiate motion values at the top to satisfy hook rules
    const savedPos = (() => {
        try {
            const saved = localStorage.getItem('poker-showdown-modal-position');
            return saved ? JSON.parse(saved) : { x: 0, y: 0 };
        } catch {
            return { x: 0, y: 0 };
        }
    })();
    const x = useMotionValue(savedPos.x);
    const y = useMotionValue(savedPos.y);

    const [prevGameId, setPrevGameId] = useState(showdownResult?.gameId);
    if (showdownResult?.gameId !== prevGameId) {
        setPrevGameId(showdownResult?.gameId);
    }

    if (!showdownResult) return null;

    const winners = showdownResult.winners ?? [];
    const winningPlayer = showdownResult.players.find((player) => winners.includes(player.name));
    const isUncontested = winners.length === 1 && (
        showdownResult.players.length === 1 ||
        showdownResult.players
            .filter((player) => player.name !== winners[0])
            .every((player) => player.status === 'FOLDED' || player.status === 'OUT' || player.hasFolded)
    );
    const handText = !isUncontested ? formatHandRank(winningPlayer?.handRank) : null;
    const outcomeText = winners.length > 1
        ? `${SHOWDOWN_TIE_PREFIX}${winners.join(', ')}`
        : winners.length === 1
                ? isUncontested
                ? `${winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;
    const motionTransition = { duration: prefersReducedMotion ? 0 : 0.22, ease: 'easeOut' as const };

    return (
        <>
        <AnimatePresence>
            <motion.div
                initial={prefersReducedMotion ? false : { y: -12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { y: -8, opacity: 0 }}
                transition={motionTransition}
                className="pointer-events-none fixed inset-x-0 top-2 z-[110] flex justify-end px-3 md:top-16 md:px-5"
            >
                <motion.section
                    drag
                    dragMomentum={false}
                    dragElastic={0.1}
                    style={{ x, y }}
                    onDragEnd={() => {
                        try {
                            localStorage.setItem('poker-showdown-modal-position', JSON.stringify({ x: x.get(), y: y.get() }));
                        } catch {
                            // ignore
                        }
                    }}
                    aria-label={ARIA_ROUND_RESULT}
                    aria-live="polite"
                    className="pointer-events-auto w-[min(13rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-white/10 bg-surface-high/95 shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:w-[19rem] sm:rounded-2xl cursor-grab active:cursor-grabbing select-none"
                >
                    <div className="h-1 bg-gradient-to-r from-transparent via-emerald-primary/70 to-transparent" />

                    <div className="px-3 py-2 sm:px-5 sm:py-4">
                        <div className="flex items-center justify-between gap-2 sm:gap-3">
                            <div className="inline-flex items-center gap-1.5 sm:gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-primary/10 text-emerald-primary sm:h-7 sm:w-7">
                                    <Trophy aria-hidden="true" className="h-3 w-3 sm:h-4 sm:w-4" />
                                </span>
                                <span className="text-[8px] font-headline font-extrabold uppercase tracking-[0.15em] text-emerald-primary sm:text-[10px] sm:tracking-[0.18em]">
                                    {SHOWDOWN_ROUND_RESULT}
                                </span>
                            </div>
                        </div>

                        <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:mt-3 sm:gap-x-4 sm:gap-y-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-headline font-extrabold leading-tight tracking-tight text-white sm:text-xl">
                                    {outcomeText}
                                </p>

                                {handText ? (
                                    <p className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-zinc-500 sm:mt-1 sm:text-[10px] sm:tracking-[0.14em]">
                                        {SHOWDOWN_WON_WITH_PREFIX}<span className="font-semibold text-zinc-300">{handText}</span>
                                    </p>
                                ) : winners.length > 0 && !isUncontested ? (
                                    <p className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-zinc-500 sm:mt-1 sm:text-[10px] sm:tracking-[0.14em]">
                                        {SHOWDOWN_WON_ROUND}
                                    </p>
                                ) : null}
                            </div>

                            {showdownResult.winningsPerPlayer != null && (
                                <div className="text-right">
                                    <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-zinc-500 sm:text-[9px] sm:tracking-[0.15em]">Payout</p>
                                    <p className="mt-0.5 whitespace-nowrap text-sm font-headline font-extrabold tabular-nums text-gold-secondary sm:text-xl">
                                        +${showdownResult.winningsPerPlayer.toLocaleString()}
                                    </p>
                                </div>
                            )}

                            {winners.length > 1 && (
                                <span className="col-span-2 text-[8px] uppercase tracking-widest text-zinc-600 sm:text-[9px]">
                                    {SHOWDOWN_POT_SPLIT}
                                </span>
                            )}
                        </div>

                    </div>
                </motion.section>
            </motion.div>
        </AnimatePresence>
        </>
    );
}
