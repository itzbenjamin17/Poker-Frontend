import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';
import { Trophy } from 'lucide-react';
import type { GameState } from '../types';
import type { ShowdownModalLayout } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
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
                    initial={{ y: -24, opacity: 0, scale: 0.96 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: -24, opacity: 0, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    className={cn(
                        'fixed z-[110] rounded-2xl overflow-hidden max-h-[82dvh]',
                        layout
                            ? 'left-0 top-0'
                            : cn(
                                'top-3 left-1/2 -translate-x-1/2 w-[min(94vw,19rem)]',
                                isMobileLandscape && 'top-2 w-[min(90vw,18rem)]',
                                'md:left-auto md:right-5 md:top-4 md:translate-x-0 md:w-[min(92vw,300px)]',
                            ),
                    )}
                    style={layout ? { left: layout.x, top: layout.y, width: layout.width, height: layout.height } : undefined}
                >
                    {/* Subtle glass background */}
                    <div className="absolute inset-0 bg-[#0f1a14]/90 backdrop-blur-xl" />
                    <div className="absolute inset-0 border border-white/8 rounded-2xl pointer-events-none" />
                    {/* Very subtle gold top glow line */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-gold-secondary/50 to-transparent" />

                    {/* Drag grip — centered at top, subtle */}
                    <div
                        aria-label={ARIA_DRAG_HANDLE}
                        className="relative flex justify-center pt-2.5 pb-1 cursor-move select-none touch-none"
                        onPointerDown={onDragPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    >
                        <div className="flex gap-[3px]">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="w-[3px] h-[3px] rounded-full bg-white/20" />
                            ))}
                        </div>
                    </div>

                    {/* Content */}
                    <div className={cn('relative px-5 pb-5', layout && 'overflow-y-auto pr-1')}>
                        {/* Badge */}
                        <div className="flex justify-center mb-3">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-gold-secondary/30 bg-gold-secondary/8">
                                <Trophy aria-hidden="true" className="w-3 h-3 text-gold-secondary" />
                                <span className="text-[9px] font-headline font-extrabold uppercase tracking-[0.2em] text-gold-secondary">
                                    {SHOWDOWN_ROUND_RESULT}
                                </span>
                            </div>
                        </div>

                        {/* Round label */}
                        <p className="text-center text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">
                            {showdownResult.players?.length === 1 ? SHOWDOWN_GAME_OVER : SHOWDOWN_ROUND_OVER}
                        </p>

                        {showdownResult.winners && showdownResult.winners.length > 0 ? (
                            <div className="space-y-3">
                                {/* Winner name */}
                                <p className="text-center text-xl md:text-2xl font-headline font-extrabold text-emerald-primary leading-tight tracking-tight">
                                    {showdownResult.winners.length > 1
                                        ? `${SHOWDOWN_TIE_PREFIX}${showdownResult.winners.join(', ')}`
                                        : showdownResult.players?.length === 1
                                            ? `${showdownResult.winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                                            : `${showdownResult.winners[0]}${SHOWDOWN_WIN_SUFFIX}`}
                                </p>

                                {/* Winnings pill */}
                                {showdownResult.winningsPerPlayer != null && (
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gold-secondary/12 border border-gold-secondary/25 shadow-[0_0_16px_rgba(252,192,37,0.12)]">
                                            <span className="text-gold-secondary font-extrabold text-base md:text-lg tracking-tight">
                                                +${showdownResult.winningsPerPlayer.toLocaleString()}
                                            </span>
                                        </div>
                                        {showdownResult.winners.length > 1 && (
                                            <span className="text-zinc-600 text-[9px] uppercase tracking-widest">
                                                {SHOWDOWN_POT_SPLIT}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Hand rank */}
                                {(() => {
                                    const isForfeit = showdownResult.players?.length === 1;
                                    if (isForfeit) return null;
                                    const winningPlayer = showdownResult.players.find(p => showdownResult.winners?.includes(p.name));
                                    const handText = winningPlayer?.handRank && winningPlayer.handRank !== 'NO_HAND'
                                        ? winningPlayer.handRank.replace(/_/g, ' ')
                                        : null;
                                    return (
                                        <p className="text-center text-[10px] uppercase tracking-[0.15em] text-zinc-500 mt-1">
                                            {handText
                                                ? <>{SHOWDOWN_WON_WITH_PREFIX}<span className="text-zinc-300 font-semibold">{handText}</span></>
                                                : SHOWDOWN_WON_ROUND
                                            }
                                        </p>
                                    );
                                })()}
                            </div>
                        ) : (
                            <p className="text-center text-zinc-500 text-xs">{SHOWDOWN_PROCESSING}</p>
                        )}
                    </div>

                    {/* Resize handle — tiny corner pip */}
                    <div
                        aria-label={ARIA_RESIZE_HANDLE}
                        className="absolute bottom-1.5 right-1.5 cursor-se-resize touch-none opacity-30 hover:opacity-70 transition-opacity"
                        onPointerDown={onResizePointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    >
                        {/* Small diagonal lines like a classic resize grip */}
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <line x1="2" y1="8" x2="8" y2="2" stroke="currentColor" strokeWidth="1.2" className="text-zinc-400" />
                            <line x1="5" y1="8" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" className="text-zinc-400" />
                        </svg>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}