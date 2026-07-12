import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Trophy } from 'lucide-react';
import { cn } from '../lib/cn';
import type { GameState } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_GAME_OVER, SHOWDOWN_ROUND_OVER, SHOWDOWN_PROCESSING,
    SHOWDOWN_TIE_PREFIX, SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_POT_SPLIT, SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    SHOWDOWN_SHOW_DETAILS, SHOWDOWN_HIDE_DETAILS,
    ARIA_ROUND_RESULT,
} from '../constants/strings';

interface ShowdownModalProps {
    showdownResult: GameState | null;
}

export function ShowdownModal({ showdownResult }: ShowdownModalProps) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    if (!showdownResult) return null;

    const winners = showdownResult.winners ?? [];
    const winningPlayer = showdownResult.players.find((player) => winners.includes(player.name));
    const isUncontested = winners.length === 1 && (
        showdownResult.players.length === 1 ||
        showdownResult.players
            .filter((player) => player.name !== winners[0])
            .every((player) => player.status === 'FOLDED' || player.status === 'OUT' || player.hasFolded)
    );
    const handText = !isUncontested && winningPlayer?.handRank && winningPlayer.handRank !== 'NO_HAND'
        ? winningPlayer.handRank.replace(/_/g, ' ')
        : null;
    const roundLabel = isUncontested ? SHOWDOWN_GAME_OVER : SHOWDOWN_ROUND_OVER;
    const outcomeText = winners.length > 1
        ? `${SHOWDOWN_TIE_PREFIX}${winners.join(', ')}`
        : winners.length === 1
                ? isUncontested
                ? `${winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: -12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="pointer-events-none fixed inset-x-0 top-2 z-[110] flex justify-end px-3 md:top-16 md:px-5"
            >
                <section
                    aria-label={ARIA_ROUND_RESULT}
                    aria-live="polite"
                    className="pointer-events-auto w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-surface-high/95 shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:w-[19rem]"
                >
                    <div className="h-1 bg-gradient-to-r from-transparent via-emerald-primary/70 to-transparent" />

                    <div className="px-4 py-3 sm:px-5 sm:py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="inline-flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-primary/10 text-emerald-primary">
                                    <Trophy aria-hidden="true" className="h-4 w-4" />
                                </span>
                                <span className="text-[10px] font-headline font-extrabold uppercase tracking-[0.18em] text-emerald-primary">
                                    {SHOWDOWN_ROUND_RESULT}
                                </span>
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                                {roundLabel}
                            </p>
                        </div>

                        <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">
                            <div className="min-w-0">
                                <p className="truncate text-lg font-headline font-extrabold leading-tight tracking-tight text-white sm:text-xl">
                                    {outcomeText}
                                </p>

                                {handText ? (
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                                        {SHOWDOWN_WON_WITH_PREFIX}<span className="font-semibold text-zinc-300">{handText}</span>
                                    </p>
                                ) : winners.length > 0 && !isUncontested ? (
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                                        {SHOWDOWN_WON_ROUND}
                                    </p>
                                ) : null}
                            </div>

                            {showdownResult.winningsPerPlayer != null && (
                                <div className="text-right">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">Payout</p>
                                    <p className="mt-0.5 whitespace-nowrap text-lg font-headline font-extrabold tabular-nums text-gold-secondary sm:text-xl">
                                        +${showdownResult.winningsPerPlayer.toLocaleString()}
                                    </p>
                                </div>
                            )}

                            {winners.length > 1 && (
                                <span className="col-span-2 text-[9px] uppercase tracking-widest text-zinc-600">
                                    {SHOWDOWN_POT_SPLIT}
                                </span>
                            )}
                        </div>

                        <button
                            type="button"
                            aria-expanded={detailsOpen}
                            aria-controls="round-result-details"
                            onClick={() => setDetailsOpen((open) => !open)}
                            className="mt-3 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[10px] font-headline font-bold uppercase tracking-[0.14em] text-emerald-primary hover:bg-emerald-primary/10"
                        >
                            {detailsOpen ? SHOWDOWN_HIDE_DETAILS : SHOWDOWN_SHOW_DETAILS}
                            <ChevronDown
                                aria-hidden="true"
                                className={cn('h-4 w-4 transition-transform duration-200', detailsOpen && 'rotate-180')}
                            />
                        </button>

                        <AnimatePresence>
                            {detailsOpen && (
                                <motion.div
                                    id="round-result-details"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeOut' }}
                                    className="mt-3 overflow-hidden border-t border-white/10 pt-3"
                                >
                                    <dl className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-[0.12em]">
                                        <div>
                                            <dt className="text-zinc-500">State</dt>
                                            <dd className="mt-0.5 font-bold text-zinc-200">{roundLabel}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-zinc-500">Pot</dt>
                                            <dd className="mt-0.5 font-bold text-gold-secondary">${showdownResult.pot.toLocaleString()}</dd>
                                        </div>
                                    </dl>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </section>
            </motion.div>
        </AnimatePresence>
    );
}
