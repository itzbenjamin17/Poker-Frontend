import { Button } from './UI';
import { formatHandRank } from '../lib/game';
import type { GameState } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_PROCESSING,
    SHOWDOWN_HAND_COMPLETE, SHOWDOWN_CARRY_OVER, SHOWDOWN_MULTIPLE_WINNERS,
    SHOWDOWN_FORFEIT_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_WON_WITH_PREFIX, SHOWDOWN_WON_ROUND,
    ARIA_ROUND_RESULT,
    BTN_LEAVE_TABLE,
    BTN_READY,
    BTN_UNREADY,
    LABEL_PLAYERS_READY_SUFFIX,
} from '../constants/strings';

interface ResultDockProps {
    showdownResult: GameState | null;
    isReady?: boolean;
    isReadyEligible?: boolean;
    isActionPending?: boolean;
    isReadyCountdownActive?: boolean;
    readyCountdownSecondsRemaining?: number;
    readyCount?: number;
    readyEligibleCount?: number;
    onReady?: () => void;
    onUnready?: () => void;
    isMobileLandscape?: boolean;
    onLeaveGame?: () => void;
}

export function ResultDock({
    showdownResult,
    isReady,
    isReadyEligible = true,
    isActionPending = false,
    isReadyCountdownActive = false,
    readyCountdownSecondsRemaining = 0,
    readyCount = 0,
    readyEligibleCount = 0,
    onReady,
    onUnready,
    isMobileLandscape,
    onLeaveGame,
}: ResultDockProps) {
    if (!showdownResult) return null;

    const winners = showdownResult.winners ?? [];
    const winningPlayer = showdownResult.players.find((player) => winners.includes(player.name));
    const isUncontested = winners.length === 1 && (
        showdownResult.players.length === 1 ||
        showdownResult.players
            .filter((player) => player.name !== winners[0])
            .every((player) => player.status === 'FOLDED' || player.status === 'OUT' || player.hasFolded)
    );

    const handText = winners.length === 1 && !isUncontested ? formatHandRank(winningPlayer?.handRank, winningPlayer?.bestHand) : null;
    const settledVoid = showdownResult.handSettled === true && winners.length === 0;
    const outcomeText = settledVoid
        ? `${SHOWDOWN_HAND_COMPLETE}${(showdownResult.carryOverAmount ?? 0) > 0 ? ` · ${showdownResult.carryOverAmount!.toLocaleString()} ${SHOWDOWN_CARRY_OVER}` : ''}`
        : winners.length > 1
        ? `${SHOWDOWN_MULTIPLE_WINNERS} ${winners.join(', ')}`
        : winners.length === 1
            ? isUncontested
                ? `${winners[0]}${SHOWDOWN_FORFEIT_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;
    const individualAwards = winners
        .map((name) => ({ name, amount: showdownResult.players.find((player) => player.name === name)?.chipsWon ?? 0 }))
        .filter(({ amount }) => amount > 0);

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
                        {winners.length === 1 && showdownResult.winningsPerPlayer != null && (
                            <span className="font-bold text-gold-secondary text-sm md:text-base whitespace-nowrap tabular-nums">
                                +{showdownResult.winningsPerPlayer.toLocaleString()} Chips
                            </span>
                        )}
                    </div>
                    {individualAwards.length > 1 && (
                        <div className="text-xs text-zinc-300" aria-label="Contested awards">
                            {individualAwards.map(({ name, amount }) => `${name}: +${amount.toLocaleString()} chips`).join(' · ')}
                        </div>
                    )}
                    {individualAwards.length === 0 && winners.length > 1 && showdownResult.winningsPerPlayer != null && (
                        <div className="text-xs text-zinc-300">{showdownResult.winningsPerPlayer.toLocaleString()} chips each</div>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {isReadyCountdownActive && (
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-white font-headline font-bold tabular-nums">
                                {readyCountdownSecondsRemaining}s
                            </span>
                            {readyEligibleCount > 0 && (
                                <span className="text-zinc-400 text-[10px] uppercase tracking-widest">
                                    ({readyCount}/{readyEligibleCount} {LABEL_PLAYERS_READY_SUFFIX})
                                </span>
                            )}
                        </div>
                    )}
                    {isMobileLandscape && onLeaveGame && (
                        <Button variant="ghost" size="xs" onClick={onLeaveGame} className="text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-1 short:py-0.5">
                            {BTN_LEAVE_TABLE}
                        </Button>
                    )}
                    {isReadyEligible && (
                        isReady ? (
                            <Button
                                variant="secondary"
                                size={isMobileLandscape ? 'xs' : 'sm'}
                                onClick={onUnready}
                                disabled={isActionPending}
                                className="bg-white/10 text-white/70 hover:bg-white/20 border-white/10 short:px-3 short:py-0.5 short:text-xs"
                            >
                                {BTN_UNREADY}
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                size={isMobileLandscape ? 'xs' : 'sm'}
                                onClick={onReady}
                                disabled={isActionPending}
                                className="short:px-3 short:py-0.5 short:text-xs"
                            >
                                {BTN_READY}
                            </Button>
                        )
                    )}
                </div>
            </div>
        </section>
    );
}
