import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';
import { Trophy } from 'lucide-react';
import type { GameState } from '../types';
import type { ShowdownModalLayout } from '../types';
import {
    SHOWDOWN_DRAG_LABEL, SHOWDOWN_RESIZE_LABEL, SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_GAME_OVER, SHOWDOWN_ROUND_OVER, SHOWDOWN_PROCESSING,
    SHOWDOWN_TIE_PREFIX, SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_POT_SPLIT, SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    ARIA_DRAG_HANDLE, ARIA_RESIZE_HANDLE, ARIA_ROUND_RESULT,
} from '../constants/strings';

interface ShowdownModalProps {
    showdownResult: GameState | null;
    layout: ShowdownModalLayout | null;
    modalRef: React.RefObject<HTMLDivElement | null>;
    isMobileLandscape: boolean;
    onDragPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

export function ShowdownModal({
    showdownResult,
    layout,
    modalRef,
    isMobileLandscape,
    onDragPointerDown,
    onResizePointerDown,
    onPointerMove,
    onPointerUp,
}: ShowdownModalProps) {
    return (
        <AnimatePresence>
            {showdownResult && (
                <motion.div
                    ref={modalRef}
                    role="dialog"
                    aria-label={ARIA_ROUND_RESULT}
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    className={cn(
                        'fixed z-[110] bg-surface-highest/95 backdrop-blur border border-gold-secondary/40 rounded-xl p-3 sm:p-4 md:p-5 shadow-[0_0_40px_rgba(252,192,37,0.18)] text-center max-h-[82dvh] overflow-hidden',
                        layout
                            ? 'left-0 top-0 overflow-hidden'
                            : cn(
                                'top-3 left-1/2 -translate-x-1/2 w-[min(94vw,22rem)]',
                                isMobileLandscape && 'top-2 w-[min(90vw,20rem)]',
                                'md:left-auto md:right-6 md:top-4 md:translate-x-0 md:w-[min(92vw,320px)]',
                            ),
                    )}
                    style={layout ? { left: layout.x, top: layout.y, width: layout.width, height: layout.height } : undefined}
                >
                    {/* Drag handle */}
                    <div
                        aria-label={ARIA_DRAG_HANDLE}
                        className="-mx-3 -mt-3 sm:-mx-4 sm:-mt-4 md:-mx-5 md:-mt-5 mb-2 md:mb-3 px-2 py-1.5 md:px-3 md:py-2 border-b border-white/10 bg-black/25 rounded-t-xl cursor-move select-none touch-none"
                        onPointerDown={onDragPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[8px] md:text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400">{SHOWDOWN_DRAG_LABEL}</span>
                            <span className="text-[8px] md:text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">{SHOWDOWN_RESIZE_LABEL}</span>
                        </div>
                    </div>

                    <div className={cn(layout && 'h-full overflow-y-auto pr-1')}>
                        <div className="inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1 rounded-full border border-gold-secondary/35 bg-gold-secondary/10 mb-2 md:mb-3">
                            <Trophy aria-hidden="true" className="w-3.5 h-3.5 text-gold-secondary" />
                            <span className="text-[9px] md:text-[10px] font-headline font-extrabold uppercase tracking-[0.18em] text-gold-secondary">
                                {SHOWDOWN_ROUND_RESULT}
                            </span>
                        </div>

                        <h2 className="text-base sm:text-lg md:text-xl font-headline font-bold text-white mb-2">
                            {showdownResult.players?.length === 1 ? SHOWDOWN_GAME_OVER : SHOWDOWN_ROUND_OVER}
                        </h2>

                        {showdownResult.winners && showdownResult.winners.length > 0 ? (
                            <div className="space-y-3 md:space-y-4">
                                <p className="text-emerald-primary text-lg sm:text-xl md:text-2xl font-headline font-extrabold leading-tight">
                                    {showdownResult.winners.length > 1
                                        ? `${SHOWDOWN_TIE_PREFIX}${showdownResult.winners.join(', ')}`
                                        : showdownResult.players?.length === 1
                                            ? `${showdownResult.winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                                            : `${showdownResult.winners[0]}${SHOWDOWN_WIN_SUFFIX}`}
                                </p>

                                {showdownResult.winningsPerPlayer ? (
                                    <div className="space-y-1 bg-gold-secondary/10 border border-gold-secondary/25 rounded-xl py-1.5 md:py-2 px-2.5 md:px-3">
                                        <p className="text-gold-secondary font-extrabold text-sm md:text-base">
                                            +${showdownResult.winningsPerPlayer.toLocaleString()}
                                        </p>
                                        {showdownResult.winners.length > 1 && (
                                            <p className="text-zinc-500 text-[9px] md:text-[10px] uppercase tracking-widest">
                                                {SHOWDOWN_POT_SPLIT}
                                            </p>
                                        )}
                                    </div>
                                ) : null}

                                {(() => {
                                    const isForfeit = showdownResult.players?.length === 1;
                                    if (isForfeit) return null;
                                    const winningPlayer = showdownResult.players.find(p => showdownResult.winners?.includes(p.name));
                                    if (winningPlayer?.handRank && winningPlayer.handRank !== 'NO_HAND') {
                                        return (
                                            <p className="text-zinc-400 text-[10px] md:text-xs uppercase tracking-widest mt-2">
                                                {SHOWDOWN_WON_WITH_PREFIX}<span className="text-zinc-200">{winningPlayer.handRank.replace(/_/g, ' ')}</span>
                                            </p>
                                        );
                                    }
                                    return (
                                        <p className="text-zinc-400 text-[10px] md:text-xs uppercase tracking-widest mt-2">
                                            {SHOWDOWN_WON_ROUND}
                                        </p>
                                    );
                                })()}
                            </div>
                        ) : (
                            <p className="text-zinc-400 text-xs md:text-sm">{SHOWDOWN_PROCESSING}</p>
                        )}
                    </div>

                    {/* Resize handle */}
                    <div
                        aria-label={ARIA_RESIZE_HANDLE}
                        className="absolute bottom-1 right-1 h-4 w-4 rounded-sm border border-gold-secondary/40 bg-gold-secondary/20 cursor-se-resize touch-none"
                        onPointerDown={onResizePointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
