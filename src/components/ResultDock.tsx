import { Button } from './UI';
import { formatHandRank } from '../lib/game';
import type { GameState } from '../types';
import {
    SHOWDOWN_ROUND_RESULT,
    SHOWDOWN_PROCESSING,
    SHOWDOWN_HAND_COMPLETE, SHOWDOWN_CARRY_OVER, SHOWDOWN_MULTIPLE_WINNERS,
    SHOWDOWN_EVERYONE_FOLDED_SUFFIX, SHOWDOWN_WIN_SUFFIX,
    SHOWDOWN_WON_WITH_PREFIX,
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
    readyGateState?: GameState['readyGateState'];
    readyCountdownSecondsRemaining?: number;
    readyCount?: number;
    readyEligibleCount?: number;
    onReady?: () => void;
    onUnready?: () => void;
    isMobileLandscape?: boolean;
    onLeaveGame?: () => void;
    /** 'corner' places a compact result pill in the bottom-right dead corner on short landscape screens. */
    layout?: 'dock' | 'corner';
}

export function ResultDock({
    showdownResult,
    isReady,
    isReadyEligible = false,
    isActionPending = false,
    isReadyCountdownActive = false,
    readyGateState,
    readyCountdownSecondsRemaining = 0,
    readyCount = 0,
    readyEligibleCount = 0,
    onReady,
    onUnready,
    isMobileLandscape,
    onLeaveGame,
    layout = 'dock',
}: ResultDockProps) {
    if (!showdownResult) return null;
    const isCorner = layout === 'corner';

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
                ? `${winners[0]}${SHOWDOWN_EVERYONE_FOLDED_SUFFIX}`
                : `${winners[0]}${SHOWDOWN_WIN_SUFFIX}`
            : SHOWDOWN_PROCESSING;
    const individualAwards = winners
        .map((name) => ({ name, amount: showdownResult.players.find((player) => player.name === name)?.chipsWon ?? 0 }))
        .filter(({ amount }) => amount > 0);
    const winnerHands = winners.map(name => {
        const player = showdownResult.players.find(candidate => candidate.name === name);
        return { name, hand: formatHandRank(player?.handRank, player?.bestHand) };
    }).filter((entry): entry is { name: string; hand: string } => Boolean(entry.hand));
    const countdownVisible = isReadyCountdownActive && readyGateState !== 'WAITING_FOR_PLAYERS'
        && readyCountdownSecondsRemaining > 0;
    const waitingForPlayers = readyGateState === 'WAITING_FOR_PLAYERS'
        || (isReadyCountdownActive && readyCountdownSecondsRemaining <= 0);

    if (isCorner) {
        return (
            <section
                aria-label={ARIA_ROUND_RESULT}
                data-layout="corner"
                data-testid="corner-dock"
                className="pointer-events-auto absolute right-1.5 bottom-1.5 z-20 flex max-w-[216px] min-[710px]:max-w-[240px] flex-col gap-1 rounded-xl border border-white/10 bg-surface-high/95 px-2 py-1.5 shadow-lg backdrop-blur-md"
            >
                <div className="min-w-0">
                    <div className="truncate text-[0.6875rem] leading-tight">
                        <span className="font-bold text-white">{outcomeText}</span>
                        {handText ? (
                            <span className="text-zinc-400">
                                <span className="sr-only">, </span>
                                {SHOWDOWN_WON_WITH_PREFIX}<span className="text-zinc-300 font-semibold">{handText}</span>
                            </span>
                        ) : null}
                    </div>
                    {individualAwards.length > 0 && (
                        <div className="truncate text-[0.625rem] leading-tight text-zinc-300" aria-label="Contested awards">
                            {individualAwards.map(({ name, amount }) => `${name}: +${amount.toLocaleString()} chips`).join(' · ')}
                        </div>
                    )}
                    {/* Single winner's hand is already shown above; keep explicit list for split pots. */}
                    {winnerHands.length > 0 && !handText && (
                        <div className="truncate text-[0.625rem] leading-tight text-zinc-400" aria-label="Winning hands">
                            {winnerHands.map(({ name, hand }) => `${name}: ${hand}`).join(' · ')}
                        </div>
                    )}
                </div>

                {(countdownVisible || waitingForPlayers) && (
                    <div className="flex items-center justify-between gap-1.5">
                        {countdownVisible && (
                            <div className="flex items-center gap-1 text-[0.625rem] shrink-0">
                                <span className="text-white font-headline font-bold tabular-nums">
                                    {readyCountdownSecondsRemaining}s
                                </span>
                                {readyEligibleCount > 0 && (
                                    <span className="text-zinc-400 text-[0.5625rem] uppercase tracking-wider">
                                        ({readyCount}/{readyEligibleCount})
                                    </span>
                                )}
                            </div>
                        )}
                        {countdownVisible && isReadyEligible && (
                            isReady ? (
                                <Button
                                    variant="secondary"
                                    size="xs"
                                    onClick={onUnready}
                                    disabled={isActionPending}
                                    className="bg-white/10 text-white/70 hover:bg-white/20 border-white/10"
                                >
                                    {BTN_UNREADY}
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    size="xs"
                                    onClick={onReady}
                                    disabled={isActionPending}
                                >
                                    {BTN_READY}
                                </Button>
                            )
                        )}
                        {waitingForPlayers && (
                            <span className="text-zinc-300 text-[0.625rem]">Waiting for players</span>
                        )}
                    </div>
                )}
            </section>
        );
    }

    return (
        <section
            aria-label={ARIA_ROUND_RESULT}
            className="flex h-full w-full min-w-0 flex-col items-center relative border-t border-white/5 bg-surface-high"
        >
            <div className="flex w-full h-full items-center justify-between px-4 py-2 md:px-6 short:py-1">
                <div className="flex-1 min-w-0 mr-4">
                    <div className="text-[0.625rem] font-headline font-extrabold uppercase tracking-[0.15em] text-emerald-primary mb-0.5">
                        {SHOWDOWN_ROUND_RESULT}
                    </div>
                    <div className="flex gap-2 items-baseline truncate">
                        <span className="font-bold text-white text-sm md:text-base truncate">
                            {outcomeText}
                        </span>
                        {handText ? (
                            <span className="text-zinc-400 text-sm truncate">
                                <span className="sr-only">, </span>
                                {SHOWDOWN_WON_WITH_PREFIX}<span className="text-zinc-300 font-semibold">{handText}</span>
                            </span>
                        ) : null}
                    </div>
                    {individualAwards.length > 0 && (
                        <div className="text-xs text-zinc-300" aria-label="Contested awards">
                            {individualAwards.map(({ name, amount }) => `${name}: +${amount.toLocaleString()} chips`).join(' · ')}
                        </div>
                    )}
                    {winnerHands.length > 0 && (
                        <div className="text-xs text-zinc-400" aria-label="Winning hands">
                            {winnerHands.map(({ name, hand }) => `${name}: ${hand}`).join(' · ')}
                        </div>
                    )}
                </div>

                <div className="flex gap-2 shrink-0 items-center">
                    {countdownVisible && (
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-white font-headline font-bold tabular-nums">
                                {readyCountdownSecondsRemaining}s
                            </span>
                            {readyEligibleCount > 0 && (
                                <span className="text-zinc-400 text-[0.625rem] uppercase tracking-widest">
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
                    {countdownVisible && isReadyEligible && (
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
                    {waitingForPlayers && (
                        <span className="text-zinc-300 text-xs">Hand complete — waiting for players</span>
                    )}
                </div>
            </div>
        </section>
    );
}
