import { Button } from './UI';
import { formatHandRank } from '../lib/game';
import type { GameState } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_PROCESSING,
    SHOWDOWN_TIE_PREFIX, SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_POT_SPLIT, SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    ARIA_ROUND_RESULT,
    BTN_LEAVE_TABLE,
} from '../constants/strings';

interface ResultDockProps {
    showdownResult: GameState | null;
    isReady?: boolean;
    onReady?: () => void;
    onUnready?: () => void;
    isMobileLandscape?: boolean;
    onLeaveGame?: () => void;
}

export function ResultDock({ showdownResult, isReady, onReady, onUnready, isMobileLandscape, onLeaveGame }: ResultDockProps) {
    if (!showdownResult) return null;

    const winners = showdownResult.winners ?? [];
    const winningPlayer = showdownResult.players.find((player) => winners.includes(player.name));
    const isUncontested = winners.length === 1 && (
        showdownResult.players.length === 1 ||
        showdownResult.players
            .filter((player) => player.name !== winners[0])
            .every((player) => player.status === 'FOLDED' || player.status === 'OUT' || player.hasFolded)
    );

    const handText = !isUncontested ? formatHandRank(winningPlayer?.handRank, winningPlayer?.bestHand) : null;
    const outcomeText = winners.length > 1
        ? `${SHOWDOWN_TIE_PREFIX}${winners.join(', ')}`
        : winners.length === 1
            ? isUncontested
                ? `${winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;

    return (
        <section
            aria-label={ARIA_ROUND_RESULT}
            className="flex h-full w-full min-w-0 flex-col items-center border-t border-white/5 bg-surface-high relative"
        >
            <div className="flex w-full h-full items-center justify-between px-4 py-2 md:px-6 short:py-1">
                <div className="flex-1 min-w-0 mr-4">
                    <div className="text-[10px] font-headline font-extrabold uppercase tracking-[0.15em] text-emerald-primary mb-0.5">
                        {SHOWDOWN_ROUND_RESULT}
                    </div>
                    <div className="flex items-baseline gap-2 truncate">
                        <span className="font-bold text-white text-sm md:text-base truncate">
                            {outcomeText}
                        </span>
                        {handText ? (
                            <span className="text-sm text-zinc-400 truncate">
                                <span className="sr-only">, </span>
                                {SHOWDOWN_WON_WITH_PREFIX}<span className="text-zinc-300 font-semibold">{handText}</span>
                            </span>
                        ) : winners.length > 0 && !isUncontested ? (
                            <span className="text-sm text-zinc-400 truncate">
                                {SHOWDOWN_WON_ROUND}
                            </span>
                        ) : null}
                        {winners.length > 1 && (
                            <span className="text-sm text-zinc-400 truncate">
                                {SHOWDOWN_POT_SPLIT}
                            </span>
                        )}
                        {showdownResult.winningsPerPlayer != null && (
                            <span className="font-bold text-gold-secondary text-sm md:text-base whitespace-nowrap tabular-nums">
                                +{showdownResult.winningsPerPlayer.toLocaleString()} Chips
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {isMobileLandscape && onLeaveGame && (
                        <Button variant="ghost" size="xs" onClick={onLeaveGame} className="text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-1 short:py-0.5">
                            {BTN_LEAVE_TABLE}
                        </Button>
                    )}
                    {isReady ? (
                        <Button
                            variant="secondary"
                            size={isMobileLandscape ? 'xs' : 'sm'}
                            onClick={onUnready}
                            className="bg-white/10 text-white/70 hover:bg-white/20 border-white/10 short:px-3 short:py-0.5 short:text-xs"
                        >
                            WAITING... (UNREADY)
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            size={isMobileLandscape ? 'xs' : 'sm'}
                            onClick={onReady}
                            className="short:px-3 short:py-0.5 short:text-xs"
                        >
                            READY
                        </Button>
                    )}
                </div>
            </div>
        </section>
    );
}
