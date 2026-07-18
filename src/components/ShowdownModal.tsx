import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, useMotionValue } from 'motion/react';
import { ChevronDown, Maximize2, Trophy, X } from 'lucide-react';
import { cn } from '../lib/cn';
import type { GameState, Player } from '../types';
import { CardUI } from './GameUI';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_ROUND_OVER, SHOWDOWN_PROCESSING,
    SHOWDOWN_TIE_PREFIX, SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_POT_SPLIT, SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    SHOWDOWN_SHOW_DETAILS, SHOWDOWN_HIDE_DETAILS,
    SHOWDOWN_OPEN_FULL_REVIEW, SHOWDOWN_CLOSE_FULL_REVIEW, SHOWDOWN_FULL_REVIEW,
    SHOWDOWN_COMMUNITY_CARDS, SHOWDOWN_REVEALED_HOLE_CARDS, SHOWDOWN_PLAYER_OUTCOMES,
    SHOWDOWN_NO_REVEALED_HOLE_CARDS,
    LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX,
    ARIA_ROUND_RESULT,
} from '../constants/strings';

interface ShowdownModalProps {
    showdownResult: GameState | null;
}

import { getPotBreakdown } from '../lib/game';

type DetailState = 'collapsed' | 'expanded' | 'full';

function formatMoney(amount: number) {
    return `$${amount.toLocaleString()}`;
}

function formatHandRank(handRank?: string) {
    return handRank && handRank !== 'NO_HAND' ? handRank.replace(/_/g, ' ') : null;
}

function getPotRows(showdownResult: GameState) {
    const pots = getPotBreakdown(showdownResult);
    return pots.map((amount, index) => ({
        label: index === 0 ? LABEL_MAIN_POT : `${LABEL_SIDE_POT_PREFIX} ${index}`,
        amount,
    }));
}

function getPlayerOutcome(player: Player, winners: string[]) {
    if (winners.includes(player.name)) return 'Winner';
    if (player.status === 'FOLDED' || player.hasFolded) return 'Folded';
    if (player.status === 'OUT') return 'Out';
    if (player.status === 'ALL_IN') return 'All in';
    if (player.status === 'DISCONNECTED') return 'Disconnected';
    return 'In hand';
}

export function ShowdownModal({ showdownResult }: ShowdownModalProps) {
    const [detailState, setDetailState] = useState<DetailState>('collapsed');
    const prefersReducedMotion = useReducedMotion();
    const fullReviewTriggerRef = useRef<HTMLButtonElement | null>(null);
    const fullReviewCloseRef = useRef<HTMLButtonElement | null>(null);
    const wasFullReviewOpenRef = useRef(false);
    const effectiveDetailState = detailState;
    const isFullReviewOpen = effectiveDetailState === 'full';

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
        setDetailState('collapsed');
    }

    useEffect(() => {
        if (isFullReviewOpen) {
            fullReviewCloseRef.current?.focus();
        } else if (wasFullReviewOpenRef.current) {
            fullReviewTriggerRef.current?.focus();
        }
        wasFullReviewOpenRef.current = isFullReviewOpen;
    }, [isFullReviewOpen]);

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
    const roundLabel = SHOWDOWN_ROUND_OVER;
    const outcomeText = winners.length > 1
        ? `${SHOWDOWN_TIE_PREFIX}${winners.join(', ')}`
        : winners.length === 1
                ? isUncontested
                ? `${winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;
    const isExpanded = effectiveDetailState !== 'collapsed';
    const potRows = getPotRows(showdownResult);
    const revealedPlayers = showdownResult.players.filter((player) => player.holeCards && player.holeCards.length > 0);
    const motionTransition = { duration: prefersReducedMotion ? 0 : 0.22, ease: 'easeOut' as const };

    const closeFullReview = () => setDetailState('expanded');

    const onFullReviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFullReview();
            return;
        }

        if (event.key !== 'Tab') return;
        const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
        ).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const fullReview = (
        <AnimatePresence>
            {isFullReviewOpen && (
                <motion.div
                    className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-3 pb-3 pt-20 backdrop-blur-[2px] sm:px-4 sm:pb-4"
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={motionTransition}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={SHOWDOWN_FULL_REVIEW}
                        onKeyDown={onFullReviewKeyDown}
                        className="max-h-[78dvh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border border-white/10 bg-surface-high/98 p-4 shadow-[0_-24px_80px_rgba(0,0,0,0.48)] outline-none sm:max-h-[82dvh] sm:rounded-2xl sm:p-5"
                        initial={prefersReducedMotion ? false : { y: 32, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={prefersReducedMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
                        transition={motionTransition}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-headline font-extrabold uppercase tracking-[0.18em] text-emerald-primary">
                                    {SHOWDOWN_FULL_REVIEW}
                                </p>
                                <h2 className="mt-1 font-headline text-2xl font-extrabold text-white">
                                    {outcomeText}
                                </h2>
                                {handText && (
                                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                                        {SHOWDOWN_WON_WITH_PREFIX}<span className="font-semibold text-zinc-200">{handText}</span>
                                    </p>
                                )}
                            </div>
                            <button
                                ref={fullReviewCloseRef}
                                type="button"
                                onClick={closeFullReview}
                                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 text-emerald-primary hover:bg-emerald-primary/10"
                            >
                                <span className="sr-only">{SHOWDOWN_CLOSE_FULL_REVIEW}</span>
                                <X aria-hidden="true" className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
                            <section aria-label="Result totals" className="space-y-3 rounded-xl border border-white/10 p-3">
                                <dl className="grid grid-cols-2 gap-3 text-xs uppercase tracking-[0.12em]">
                                    <div>
                                        <dt className="text-zinc-500">State</dt>
                                        <dd className="mt-1 font-bold text-zinc-200">{roundLabel}</dd>
                                    </div>
                                    {showdownResult.winningsPerPlayer != null && (
                                        <div>
                                            <dt className="text-zinc-500">Payout</dt>
                                            <dd className="mt-1 font-bold text-gold-secondary">{formatMoney(showdownResult.winningsPerPlayer)}</dd>
                                        </div>
                                    )}
                                    {potRows.map((pot) => (
                                        <div key={pot.label}>
                                            <dt className="text-zinc-500">{pot.label}</dt>
                                            <dd className="mt-1 font-bold text-gold-secondary">{formatMoney(pot.amount)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>

                            <section aria-label={SHOWDOWN_COMMUNITY_CARDS} className="rounded-xl border border-white/10 p-3">
                                <h3 className="text-[10px] font-headline font-extrabold uppercase tracking-[0.16em] text-zinc-500">
                                    {SHOWDOWN_COMMUNITY_CARDS}
                                </h3>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {showdownResult.communityCards.map((card) => (
                                        <CardUI key={card} card={card} scale={0.76} />
                                    ))}
                                </div>
                            </section>

                            <section aria-label={SHOWDOWN_REVEALED_HOLE_CARDS} className="rounded-xl border border-white/10 p-3">
                                <h3 className="text-[10px] font-headline font-extrabold uppercase tracking-[0.16em] text-zinc-500">
                                    {SHOWDOWN_REVEALED_HOLE_CARDS}
                                </h3>
                                {revealedPlayers.length > 0 ? (
                                    <div className="mt-3 space-y-3">
                                        {revealedPlayers.map((player, index) => (
                                            <div key={`${player.id || player.name || 'player'}-${index}`} className="flex items-center justify-between gap-3">
                                                <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-300">{player.name}</span>
                                                <div className="flex gap-1.5">
                                                    {player.holeCards?.map((card) => (
                                                        <CardUI key={`${player.id || player.name}-${card}`} card={card} scale={0.56} />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-3 text-xs text-zinc-500">{SHOWDOWN_NO_REVEALED_HOLE_CARDS}</p>
                                )}
                            </section>

                            <section aria-label={SHOWDOWN_PLAYER_OUTCOMES} className="rounded-xl border border-white/10 p-3">
                                <h3 className="text-[10px] font-headline font-extrabold uppercase tracking-[0.16em] text-zinc-500">
                                    {SHOWDOWN_PLAYER_OUTCOMES}
                                </h3>
                                <ul className="mt-3 space-y-2">
                                    {showdownResult.players.map((player, index) => (
                                        <li
                                            key={`${player.id || player.name || 'player'}-${index}`}
                                            className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-black/18 px-3 py-2 text-xs"
                                        >
                                            <div>
                                                <p className="font-bold text-zinc-100">{player.name}</p>
                                                <p className="mt-0.5 uppercase tracking-[0.12em] text-zinc-500">
                                                    {getPlayerOutcome(player, winners)}
                                                    {formatHandRank(player.handRank) ? ` - ${formatHandRank(player.handRank)}` : ''}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-gold-secondary">{formatMoney(player.chips)}</p>
                                                {typeof player.chipsWon === 'number' && (
                                                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold-secondary">
                                                        +{formatMoney(player.chipsWon)}
                                                    </p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

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
                            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-zinc-500 sm:text-[10px] sm:tracking-[0.15em]">
                                {roundLabel}
                            </p>
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

                        <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-controls="round-result-details"
                            onClick={() => setDetailState((state) => state === 'collapsed' ? 'expanded' : 'collapsed')}
                            className="mt-2 flex min-h-8 sm:min-h-11 items-center justify-center gap-1 sm:gap-2 rounded-lg sm:rounded-xl border border-white/10 px-2 py-1 sm:px-3 sm:py-2 text-[8px] sm:text-[10px] font-headline font-bold uppercase tracking-[0.12em] sm:tracking-[0.14em] text-emerald-primary hover:bg-emerald-primary/10"
                        >
                            {isExpanded ? SHOWDOWN_HIDE_DETAILS : SHOWDOWN_SHOW_DETAILS}
                            <ChevronDown
                                aria-hidden="true"
                                className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform duration-200', isExpanded && 'rotate-180')}
                            />
                        </button>

                        <AnimatePresence>
                            {isExpanded && (
                                <motion.div
                                    id="round-result-details"
                                    initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                    transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
                                    className="mt-3 overflow-hidden border-t border-white/10 pt-3"
                                >
                                    <dl className="grid grid-cols-2 gap-1.5 sm:gap-2 text-[8px] sm:text-[10px] uppercase tracking-[0.12em]">
                                        <div>
                                            <dt className="text-zinc-500">State</dt>
                                            <dd className="mt-0.5 font-bold text-zinc-200">{roundLabel}</dd>
                                        </div>
                                        {showdownResult.winningsPerPlayer != null && (
                                            <div>
                                                <dt className="text-zinc-500">Payout</dt>
                                                <dd className="mt-0.5 font-bold text-gold-secondary">{formatMoney(showdownResult.winningsPerPlayer)}</dd>
                                            </div>
                                        )}
                                        {handText && (
                                            <div className="col-span-2">
                                                <dt className="text-zinc-500">Winning hand</dt>
                                                <dd className="mt-0.5 font-bold text-zinc-200">{handText}</dd>
                                            </div>
                                        )}
                                        {potRows.map((pot) => (
                                            <div key={pot.label}>
                                                <dt className="text-zinc-500">{pot.label}</dt>
                                                <dd className="mt-0.5 font-bold text-gold-secondary">{formatMoney(pot.amount)}</dd>
                                            </div>
                                        ))}
                                    </dl>

                                    <button
                                        ref={fullReviewTriggerRef}
                                        type="button"
                                        onClick={() => setDetailState('full')}
                                        className="mt-2.5 sm:mt-3 flex min-h-8 sm:min-h-11 items-center justify-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl bg-emerald-primary px-2.5 py-1.5 sm:px-3 sm:py-2 text-[8px] sm:text-[10px] font-headline font-extrabold uppercase tracking-[0.12em] sm:tracking-[0.14em] text-surface hover:bg-emerald-dim"
                                    >
                                        {SHOWDOWN_OPEN_FULL_REVIEW}
                                        <Maximize2 aria-hidden="true" className="h-3 w-3 sm:h-4 sm:w-4" />
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.section>
            </motion.div>
        </AnimatePresence>
        {createPortal(fullReview, document.body)}
        </>
    );
}
