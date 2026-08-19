import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import {
    BTN_FOLD, BTN_CHECK, BTN_CALL_PREFIX, BTN_ALL_IN_PREFIX,
    BTN_BET, BTN_RAISE, ARIA_RAISE_AMOUNT,
    READY_PROMPT, BTN_READY, BTN_READY_CONFIRMED, LABEL_PLAYERS_READY_SUFFIX,
} from '../constants/strings';
import type { GameState, Player, PokerAction } from '../types';

type AmountAction = Extract<PokerAction, 'BET' | 'RAISE'>;

interface ActionPanelProps {
    gameState: GameState;
    me: Player | undefined;
    isMyTurn: boolean;
    isSelfDisconnected: boolean;
    isReadyCountdownActive: boolean;
    currentTurnPlayerName?: string;
    isMobileLandscape: boolean;
    isCompactTable: boolean;
    raiseAmount: string;
    raiseError: string | null;
    onRaiseChange: (val: string) => void;
    onAction: (action: PokerAction, amount?: number) => void;
    isActionPending: boolean;
    readyCountdownSecondsRemaining?: number;
    readyCount?: number;
    readyEligibleCount?: number;
    readyEligiblePlayers?: Player[];
    isReadyEligible?: boolean;
    amReadyForNextHand?: boolean;
    onReady?: () => void;
    bigBlind?: number;
}

export function ActionPanel({
    gameState,
    me,
    isMyTurn,
    isSelfDisconnected,
    isReadyCountdownActive,
    currentTurnPlayerName,
    isMobileLandscape,
    isCompactTable,
    raiseAmount,
    raiseError,
    onRaiseChange,
    onAction,
    isActionPending,
    readyCountdownSecondsRemaining = 0,
    readyCount = 0,
    readyEligibleCount = 0,
    readyEligiblePlayers = [],
    isReadyEligible = false,
    amReadyForNextHand = false,
    onReady,
    bigBlind = 50,
}: ActionPanelProps) {
    const prefersReducedMotion = useReducedMotion();
    const [amountAction, setAmountAction] = useState<AmountAction | null>(null);
    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    const legalActions = useMemo(() => {
        if (gameState.legalActions !== undefined && gameState.legalActions !== null) {
            return new Set<PokerAction>(gameState.legalActions);
        }
        const actions = new Set<PokerAction>();
        if (!me) return actions;

        actions.add('FOLD');

        const callAmount = Math.max(0, (gameState.currentBet || 0) - (me.currentBet ?? 0));
        const availableChips = me.chips ?? 0;

        if (callAmount === 0) {
            actions.add('CHECK');
            if (availableChips > 0) {
                if ((gameState.currentBet || 0) === 0) {
                    actions.add('BET');
                } else {
                    actions.add('RAISE');
                }
            }
        } else {
            if (availableChips > 0) {
                actions.add('CALL');
                if (availableChips > callAmount) {
                    actions.add('RAISE');
                }
            }
        }

        if (availableChips > 0) {
            actions.add('ALL_IN');
        }

        return actions;
    }, [gameState.legalActions, gameState.currentBet, me]);

    const actionType: AmountAction = legalActions.has('BET') ? 'BET' : 'RAISE';
    const minBetAmount = bigBlind;
    const minRaiseAmount = actionType === 'BET'
        ? minBetAmount
        : Math.max(minBetAmount, (gameState.currentBet || 0) - (me?.currentBet ?? 0) + 1);
    const availableChips = me?.chips ?? 0;
    const callAmount = Math.max(0, (gameState.currentBet || 0) - (me?.currentBet ?? 0));
    const callExceedsStack = callAmount > availableChips;

    const rawRaise = raiseAmount.trim();
    const parsedRaiseAmount = rawRaise === '' ? NaN : Number.parseInt(rawRaise, 10);
    let computedRaiseError: string | null = null;

    if (rawRaise !== '') {
        if (!/^\d+$/.test(rawRaise)) {
            computedRaiseError = 'Enter a whole number.';
        } else if (!Number.isFinite(parsedRaiseAmount) || parsedRaiseAmount <= 0) {
            computedRaiseError = 'Amount must be greater than 0.';
        } else if (parsedRaiseAmount < minRaiseAmount) {
            if (actionType === 'RAISE' && parsedRaiseAmount === availableChips) {
                computedRaiseError = `Minimum raise is ${minRaiseAmount.toLocaleString()} chips. Your full stack is smaller, use All In${callExceedsStack ? '' : ' or Call'}.`;
            } else {
                computedRaiseError = actionType === 'BET'
                    ? `Bet amount must be at least ${minBetAmount.toLocaleString()} chips.`
                    : `Minimum raise is ${minRaiseAmount.toLocaleString()} chips.`;
            }
        } else if (parsedRaiseAmount > availableChips) {
            computedRaiseError = `You only have ${availableChips.toLocaleString()} chips.`;
        } else if (parsedRaiseAmount > 10_000_000) {
            computedRaiseError = 'Amount cannot exceed 10,000,000 chips.';
        }
    }

    const activeRaiseError = raiseError ?? computedRaiseError;
    const canSubmitRaise = rawRaise !== '' && !activeRaiseError;
    const hasError = Boolean(activeRaiseError);

    const isAutoAdvancing = Boolean(gameState.isAutoAdvancing);
    const isShowdown = gameState.phase === 'SHOWDOWN';
    const showControls = isMyTurn && !isSelfDisconnected && !isReadyCountdownActive
        && !isAutoAdvancing && !isShowdown && legalActions.size > 0;
    const waitingName = currentTurnPlayerName || gameState.currentPlayerName || 'another player';
    const canCheck = legalActions.has('CHECK');
    const canCall = legalActions.has('CALL');
    const canAllIn = legalActions.has('ALL_IN');
    const canBetOrRaise = legalActions.has(actionType);
    const amountControlsOpen = showControls && canBetOrRaise && amountAction === actionType;

    const sectionMotion = prefersReducedMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease: 'easeOut' as const } };
    const fadeMotion = prefersReducedMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18, ease: 'easeOut' as const } };

    return (
        <motion.section
            role="region"
            aria-label="Action dock"
            {...sectionMotion}
            className={cn(
                'flex h-full w-full min-w-0 flex-wrap items-center justify-center border-t border-white/5 bg-surface-high',
                isMobileLandscape ? 'gap-2 p-1.5' : 'gap-3 md:gap-4',
                !isMobileLandscape && (isCompactTable ? 'p-2' : 'p-4 md:p-6'),
            )}
        >
            <AnimatePresence mode="wait">
                {showControls ? (
                    <motion.div
                        key="turn-controls"
                        {...fadeMotion}
                        className={cn(
                            'flex w-full flex-wrap items-center justify-center',
                            isMobileLandscape ? 'gap-2' : 'gap-3 md:gap-4',
                        )}
                    >
                        {legalActions.has('FOLD') && (
                            <Button variant="outline" size={controlButtonSize} onClick={() => onAction('FOLD')} disabled={isActionPending}>
                                {isActionPending ? 'Submitting...' : BTN_FOLD}
                            </Button>
                        )}

                        {canCheck ? (
                            <Button variant="primary" size={controlButtonSize} onClick={() => onAction('CHECK')} disabled={isActionPending}>
                                {isActionPending ? 'Submitting...' : BTN_CHECK}
                            </Button>
                        ) : canCall ? (
                            <Button variant="primary" size={controlButtonSize} onClick={() => onAction('CALL')} disabled={isActionPending}>
                                {isActionPending ? 'Submitting...' : `${BTN_CALL_PREFIX}${callAmount.toLocaleString()}`}
                            </Button>
                        ) : null}

                        {legalActions.has('BET') && !amountControlsOpen && (
                            <Button
                                variant="outline"
                                size={controlButtonSize}
                                aria-expanded="false"
                                aria-controls="amount-action-controls"
                                onClick={() => setAmountAction('BET')}
                                disabled={isActionPending}
                            >
                                {BTN_BET}
                            </Button>
                        )}

                        {legalActions.has('RAISE') && !amountControlsOpen && (
                            <Button
                                variant="outline"
                                size={controlButtonSize}
                                aria-expanded="false"
                                aria-controls="amount-action-controls"
                                onClick={() => setAmountAction('RAISE')}
                                disabled={isActionPending}
                            >
                                {BTN_RAISE}
                            </Button>
                        )}

                        {canAllIn && (
                            <Button variant="outline" size={controlButtonSize} onClick={() => onAction('ALL_IN')} disabled={isActionPending}>
                                {isActionPending ? 'Submitting...' : `${BTN_ALL_IN_PREFIX}${availableChips.toLocaleString()}`}
                            </Button>
                        )}

                        <AnimatePresence>
                            {amountControlsOpen && (
                                <motion.div
                                    id="amount-action-controls"
                                    key="amount-controls"
                                    {...fadeMotion}
                                    className={cn(
                                        'flex flex-wrap items-center justify-center gap-2',
                                        'w-auto',
                                    )}
                                >
                                    <div className={cn(
                                        'flex items-stretch overflow-hidden rounded-xl border transition-colors duration-150',
                                        hasError
                                            ? 'border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]'
                                            : 'border-white/10 focus-within:border-white/25',
                                    )}>
                                        <div className={cn(
                                            'flex select-none items-center border-r border-white/10 bg-white/5',
                                            isCompactTable || isMobileLandscape ? 'px-2' : 'px-3',
                                        )}>
                                            <span className="text-sm font-bold text-zinc-400">$</span>
                                        </div>

                                        <input
                                            type="number"
                                            aria-label={ARIA_RAISE_AMOUNT}
                                            aria-describedby={activeRaiseError ? 'raise-amount-error' : undefined}
                                            aria-invalid={hasError}
                                            className={cn(
                                                'bg-black/30 font-bold tabular-nums text-white outline-none placeholder:text-zinc-600',
                                                '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                                                isMobileLandscape ? 'w-20 px-2 py-1.5 text-xs'
                                                    : isCompactTable ? 'w-14 px-2 py-1.5 text-xs'
                                                        : 'w-24 px-3 py-2 text-sm',
                                            )}
                                            placeholder={minRaiseAmount.toString()}
                                            value={raiseAmount}
                                            onChange={e => onRaiseChange(e.target.value)}
                                            min={minRaiseAmount}
                                            step={1}
                                        />

                                        <button
                                            type="button"
                                            disabled={!canSubmitRaise || isActionPending}
                                            onClick={() => {
                                                if (!canSubmitRaise || isActionPending) return;
                                                const amount = Number.parseInt(rawRaise, 10);
                                                onAction(actionType, amount);
                                                onRaiseChange('');
                                                setAmountAction(null);
                                            }}
                                            className={cn(
                                                'select-none border-l border-white/10 font-headline font-extrabold uppercase tracking-wider transition-all duration-150',
                                                isCompactTable || isMobileLandscape ? 'px-2.5 py-1.5 text-[10px]' : 'px-4 py-2 text-xs',
                                                canSubmitRaise && !isActionPending
                                                    ? 'cursor-pointer bg-gold-secondary text-black hover:brightness-110 active:brightness-95'
                                                    : 'cursor-not-allowed bg-white/5 text-zinc-600',
                                            )}
                                        >
                                            {isActionPending ? 'Submitting...' : actionType === 'BET' ? BTN_BET : BTN_RAISE}
                                        </button>
                                    </div>

                                    <Button
                                        variant="ghost"
                                        size={controlButtonSize}
                                        onClick={() => {
                                            setAmountAction(null);
                                            onRaiseChange('');
                                        }}
                                        disabled={isActionPending}
                                    >
                                        Cancel
                                    </Button>

                                    {activeRaiseError && (
                                        <motion.p
                                            id="raise-amount-error"
                                            role="alert"
                                            {...fadeMotion}
                                            className="mx-auto line-clamp-2 w-full max-w-md text-center text-[10px] font-bold uppercase tracking-wider text-red-400 md:text-[11px] md:line-clamp-3"
                                        >
                                            {activeRaiseError}
                                        </motion.p>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                ) : isReadyCountdownActive ? (
                    <motion.div
                        key="ready-controls"
                        {...fadeMotion}
                        className="flex w-full flex-col items-center justify-center gap-1.5 text-center px-4"
                    >
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                            <p className="text-emerald-primary font-headline font-bold uppercase tracking-wider text-[10px] sm:text-xs">
                                {READY_PROMPT}
                            </p>
                            <span className="text-white font-headline font-bold text-sm sm:text-base">
                                {readyCountdownSecondsRemaining}s
                            </span>
                            <span className="text-zinc-400 text-[9px] sm:text-[10px] uppercase tracking-widest">
                                ({readyCount}/{readyEligibleCount} {LABEL_PLAYERS_READY_SUFFIX})
                            </span>
                        </div>

                        <div className="flex flex-wrap justify-center gap-1 max-w-full">
                            {readyEligiblePlayers.map((player) => {
                                const isSelf = player.id === me?.id || player.name === me?.name;
                                const isReady = Boolean(player.isReadyForNextHand);
                                return (
                                    <div
                                        key={player.id}
                                        className={cn(
                                            'flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[8px] sm:text-[9px] uppercase tracking-wider font-bold',
                                            isReady
                                                ? 'bg-emerald-primary/15 border-emerald-primary/35 text-emerald-primary'
                                                : 'bg-amber-500/10 border-amber-300/35 text-amber-200',
                                            isSelf && 'ring-1 ring-white/40',
                                        )}
                                    >
                                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isReady ? 'bg-emerald-primary' : 'bg-amber-300')} />
                                        <span className="truncate max-w-[4.5rem]">{player.name}</span>
                                        <span className="ml-auto text-[7px] sm:text-[8px]">{isReady ? 'READY' : 'WAIT'}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {isReadyEligible && (
                            <div className="pt-0.5">
                                <Button
                                    variant="primary"
                                    size={controlButtonSize === 'xs' ? 'xs' : 'sm'}
                                    onClick={onReady}
                                    disabled={amReadyForNextHand || isActionPending}
                                >
                                    {amReadyForNextHand ? BTN_READY_CONFIRMED : BTN_READY}
                                </Button>
                            </div>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="waiting-status"
                        role="status"
                        aria-live="polite"
                        {...fadeMotion}
                        className="flex min-h-11 w-full items-center justify-center px-3 text-center"
                    >
                        <p className="text-xs font-headline font-bold uppercase tracking-[0.16em] text-amber-200">
                            {isAutoAdvancing
                                ? (gameState.autoAdvanceMessage || 'Auto-advancing...')
                                : gameState.phase === 'SHOWDOWN'
                                ? 'Final hand complete — reviewing board'
                                : `Waiting for ${waitingName} to act`}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.section>
    );
}
