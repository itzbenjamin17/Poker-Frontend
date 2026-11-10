import { useMemo, useRef, useState } from 'react';
import type { ComponentProps, ComponentType, RefAttributes } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import {
    BTN_FOLD, BTN_CHECK, BTN_CALL_PREFIX, BTN_ALL_IN_PREFIX,
    BTN_BET, BTN_RAISE, ARIA_RAISE_AMOUNT,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
    READY_PROMPT, BTN_READY, LABEL_PLAYERS_READY_SUFFIX,
    RAISE_VALIDATION_WHOLE_NUMBER, RAISE_VALIDATION_POSITIVE, RAISE_VALIDATION_MAX,
    formatBetMinError, formatRaiseMinError, formatAvailableChipsError,
} from '../constants/strings';
import type { ActionError, GameState, Player, PokerAction, ReadyGateState } from '../types';

type AmountAction = Extract<PokerAction, 'BET' | 'RAISE'>;
const ButtonWithRef = Button as ComponentType<
    ComponentProps<typeof Button> & RefAttributes<HTMLButtonElement>
>;

export type DockState = 'ready_countdown' | 'waiting' | 'raising' | 'betting';

interface ActionPanelProps {
    gameState: GameState;
    me: Player | undefined;
    isMyTurn: boolean;
    isSelfDisconnected: boolean;
    isReadyCountdownActive: boolean;
    readyGateState?: ReadyGateState;
    currentTurnPlayerName?: string;
    reconnectingPlayerName?: string;
    isMobileLandscape: boolean;
    isCompactTable: boolean;
    raiseAmount?: string;
    raiseError: string | null;
    actionError?: ActionError | null;
    onRaiseChange?: (val: string) => void;
    onClearRaiseError?: () => void;
    onAction: (action: PokerAction, amount?: number) => void;
    isActionPending: boolean;
    readyCountdownSecondsRemaining?: number;
    readyCount?: number;
    readyEligibleCount?: number;
    readyEligiblePlayers?: Player[];
    isReadyEligible?: boolean;
    amReadyForNextHand?: boolean;
    onReady?: () => void;
    onUnready?: () => void;
    bigBlind?: number;
    onLeaveGame?: () => void;
    turnSecondsRemaining?: number;
}

export function ActionPanel({
    gameState,
    me,
    isMyTurn,
    isSelfDisconnected,
    isReadyCountdownActive,
    readyGateState,
    currentTurnPlayerName,
    reconnectingPlayerName,
    isMobileLandscape,
    isCompactTable,
    raiseAmount: controlledRaiseAmount,
    raiseError,
    actionError,
    onRaiseChange,
    onClearRaiseError,
    onAction,
    isActionPending,
    readyCountdownSecondsRemaining = 0,
    readyCount = 0,
    readyEligibleCount = 0,
    readyEligiblePlayers = [],
    isReadyEligible = false,
    amReadyForNextHand = false,
    onReady,
    onUnready,
    bigBlind = 50,
    onLeaveGame,
    turnSecondsRemaining,
}: ActionPanelProps) {
    const prefersReducedMotion = useReducedMotion();
    const restoreAmountTriggerFocus = useRef(false);
    const amountTriggerRef = (node: HTMLButtonElement | null) => {
        if (node && restoreAmountTriggerFocus.current) {
            restoreAmountTriggerFocus.current = false;
            node.focus();
        }
    };
    const [internalRaiseAmount, setInternalRaiseAmount] = useState('');
    const [amountAction, setAmountAction] = useState<AmountAction | null>(
        actionError?.action === 'BET' || actionError?.action === 'RAISE' ? actionError.action : null,
    );
    const [pendingAction, setPendingAction] = useState<PokerAction | null>(null);
    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';

    const raiseAmount = controlledRaiseAmount ?? internalRaiseAmount;
    const handleRaiseChange = (val: string) => {
        if (controlledRaiseAmount === undefined) {
            setInternalRaiseAmount(val);
        }
        onRaiseChange?.(val);
        onClearRaiseError?.();
    };

    const [prevTurn, setPrevTurn] = useState(isMyTurn);
    const [prevPhase, setPrevPhase] = useState(gameState.phase);
    const [prevHandNumber, setPrevHandNumber] = useState(gameState.handNumber);
    if (prevTurn !== isMyTurn || prevPhase !== gameState.phase || prevHandNumber !== gameState.handNumber) {
        setPrevTurn(isMyTurn);
        setPrevPhase(gameState.phase);
        setPrevHandNumber(gameState.handNumber);
        setInternalRaiseAmount('');
        if (!isMyTurn || prevPhase !== gameState.phase || prevHandNumber !== gameState.handNumber) {
            setAmountAction(null);
            setPendingAction(null);
        }
    }

    const isControlsDisabled = isActionPending;
    const activePendingAction = isActionPending ? pendingAction : null;

    const handleAction = (action: PokerAction, amount?: number) => {
        if (isControlsDisabled) {
            return;
        }
        setPendingAction(action);
        if (amount !== undefined) {
            onAction(action, amount);
        } else {
            onAction(action);
        }
    };

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
                if (availableChips > callAmount) actions.add('CALL');
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
    const minBetAmount = gameState.minimumBetAmount ?? bigBlind;
    const minRaiseAmount = gameState.minimumRaiseAmount ?? (actionType === 'BET'
        ? minBetAmount
        : Math.max(0, (gameState.currentBet || 0) - (me?.currentBet ?? 0)) + minBetAmount);
    const availableChips = me?.chips ?? 0;
    const callAmount = Math.max(0, (gameState.currentBet || 0) - (me?.currentBet ?? 0));
    const presetOffset = actionType === 'RAISE' ? callAmount : 0;
    const clamp = (val: number) => Math.min(availableChips, Math.max(minRaiseAmount, val));

    const defaultRaiseAmount = availableChips > 0 ? Math.min(minRaiseAmount, availableChips) : minRaiseAmount;
    const rawRaise = raiseAmount.trim();
    const parsedRaiseAmount = rawRaise === '' ? defaultRaiseAmount : Number.parseInt(rawRaise, 10);
    let computedRaiseError: string | null = null;

    if (rawRaise !== '' && !/^\d+$/.test(rawRaise)) {
        computedRaiseError = RAISE_VALIDATION_WHOLE_NUMBER;
    } else if (!Number.isFinite(parsedRaiseAmount) || parsedRaiseAmount <= 0) {
        computedRaiseError = RAISE_VALIDATION_POSITIVE;
    } else if (parsedRaiseAmount < minRaiseAmount && parsedRaiseAmount < availableChips) {
        computedRaiseError = actionType === 'BET'
            ? formatBetMinError(minBetAmount)
            : formatRaiseMinError(minRaiseAmount);
    } else if (parsedRaiseAmount > availableChips) {
        computedRaiseError = formatAvailableChipsError(availableChips);
    } else if (parsedRaiseAmount > 10_000_000) {
        computedRaiseError = RAISE_VALIDATION_MAX;
    }

    const activeRaiseError = (actionError?.action === actionType ? actionError.message : null) ?? raiseError ?? computedRaiseError;
    const displayedError = actionError?.message ?? (amountAction === actionType ? activeRaiseError : null);
    const canSubmitRaise = !activeRaiseError;
    const hasError = Boolean(activeRaiseError);

    const isAutoAdvancing = Boolean(gameState.isAutoAdvancing);
    const isShowdown = gameState.phase === 'SHOWDOWN';

    // Fallback: If we somehow retained isReadyCountdownActive: true, but the countdown is 0
    // and we've already transitioned out of SHOWDOWN, don't freeze the controls.
    const isEffectivelyReadyCountdownActive = isReadyCountdownActive &&
        readyCountdownSecondsRemaining > 0;

    const showControls = isMyTurn && !isSelfDisconnected && !isEffectivelyReadyCountdownActive
        && !isAutoAdvancing && !isShowdown && legalActions.size > 0;
    const waitingName = currentTurnPlayerName || gameState.currentPlayerName || 'another player';
    const turnStatus = reconnectingPlayerName
        ? `${WAITING_RECONNECT_PREFIX}${reconnectingPlayerName}${WAITING_RECONNECT_SUFFIX}`
        : `Waiting for ${waitingName} to act`;
    const canCheck = legalActions.has('CHECK');
    const canCall = legalActions.has('CALL');
    const canAllIn = legalActions.has('ALL_IN');
    const canBetOrRaise = legalActions.has(actionType);

    const [prevActionError, setPrevActionError] = useState(actionError);
    if (prevActionError !== actionError) {
        setPrevActionError(actionError);
        if (actionError && canBetOrRaise && actionError.action === actionType) {
            setAmountAction(actionError.action);
        }
    }
    const [prevRaiseError, setPrevRaiseError] = useState(raiseError);
    if (prevRaiseError !== raiseError) {
        setPrevRaiseError(raiseError);
        if (raiseError && canBetOrRaise) setAmountAction(actionType);
    }

    const isRaising = showControls && canBetOrRaise && amountAction === actionType;
    const isUrgentTurn = showControls && typeof turnSecondsRemaining === 'number' && turnSecondsRemaining <= 10;

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
            data-is-active-turn={isMyTurn}
            {...sectionMotion}
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
            className={cn(
                'flex h-full w-full min-w-0 items-center justify-center border-t border-white/5 bg-surface-high relative transition-all duration-200',
                isUrgentTurn && 'border-amber-400/80 shadow-[0_0_20px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/50',
                isMobileLandscape ? 'px-2 py-1' : isCompactTable ? 'px-3 py-1.5' : 'px-4 py-2 md:px-6',
            )}
        >
            <AnimatePresence mode="wait">
                {showControls ? (
                    <motion.div
                        key="turn-controls"
                        {...fadeMotion}
                        exit={{ opacity: 0, transition: { duration: 0 } }}
                        className={cn(
                            'flex w-full flex-col items-center justify-center gap-1',
                            isMobileLandscape && 'pr-12',
                        )}
                    >
                        {isUrgentTurn && (
                            <div
                                data-testid="turn-warning"
                                className="flex items-center justify-center gap-1.5 text-xs font-headline font-bold text-amber-300 uppercase tracking-wider"
                            >
                                <span className="sr-only" role="alert" aria-live="polite">
                                    Warning: 10 seconds or less remaining to act.
                                </span>
                                <span aria-hidden="true">⚠️ {turnSecondsRemaining}s left</span>
                            </div>
                        )}
                        {isRaising ? (
                            <div
                                id="amount-action-controls"
                                className={cn(
                                    'flex w-full flex-col items-center justify-center gap-1.5 px-2 max-w-xl',
                                    isMobileLandscape ? 'gap-1' : 'gap-1.5',
                                )}
                            >
                                <div className="flex w-full flex-wrap sm:flex-nowrap items-center justify-center gap-2">
                                    {/* Presets */}
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={() => handleRaiseChange(String(clamp(presetOffset + bigBlind * 3)))}
                                            disabled={isControlsDisabled}
                                        >
                                            3BB
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={() => handleRaiseChange(String(clamp(presetOffset + Math.floor((gameState.pot || 0) / 2))))}
                                            disabled={isControlsDisabled}
                                        >
                                            1/2 POT
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={() => handleRaiseChange(String(clamp(presetOffset + (gameState.pot || 0))))}
                                            disabled={isControlsDisabled}
                                        >
                                            POT
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={() => handleRaiseChange(String(clamp(availableChips)))}
                                            disabled={isControlsDisabled}
                                        >
                                            MAX
                                        </Button>
                                    </div>

                                    {/* Current Amount & Slider */}
                                    <div
                                        className={cn(
                                            'flex items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors duration-150',
                                            hasError
                                                ? 'border-red-500/50 bg-red-500/5 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]'
                                                : 'border-white/10 bg-black/30 focus-within:border-white/25',
                                        )}
                                    >
                                        <span className="text-zinc-400 text-xs font-bold">$</span>
                                        <span className="text-white tabular-nums text-xs sm:text-sm font-bold min-w-[3rem]">
                                            {parsedRaiseAmount.toLocaleString()}
                                        </span>
                                        {/* eslint-disable jsx-a11y/no-autofocus */}
                                        <input
                                            type="range"
                                            aria-label={ARIA_RAISE_AMOUNT}
                                            aria-describedby={activeRaiseError ? 'raise-amount-error' : undefined}
                                            aria-invalid={hasError}
                                            className="w-24 sm:w-32 md:w-36 cursor-pointer accent-gold-secondary h-1.5"
                                            value={parsedRaiseAmount}
                                            onChange={e => handleRaiseChange(e.target.value)}
                                            min={defaultRaiseAmount}
                                            max={Math.max(defaultRaiseAmount, availableChips)}
                                            step={1}
                                            autoFocus
                                            disabled={isControlsDisabled}
                                        />
                                        {/* eslint-enable jsx-a11y/no-autofocus */}
                                    </div>

                                    {/* Cancel & Submit */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size={controlButtonSize}
                                            onClick={() => {
                                                restoreAmountTriggerFocus.current = true;
                                                setAmountAction(null);
                                                handleRaiseChange('');
                                            }}
                                            disabled={isActionPending}
                                        >
                                            Cancel
                                        </Button>

                                        <button
                                            type="button"
                                            disabled={!canSubmitRaise || isControlsDisabled}
                                            onClick={() => {
                                                if (!canSubmitRaise || isControlsDisabled) return;
                                                handleAction(actionType, parsedRaiseAmount);
                                            }}
                                            className={cn(
                                                'select-none rounded-xl font-headline font-extrabold uppercase tracking-wider transition-all duration-150 flex items-center justify-center',
                                                controlButtonSize === 'xs' ? 'px-3 py-1 text-[10px]' : controlButtonSize === 'sm' ? 'px-4 py-1.5 text-xs' : 'px-5 py-2 text-xs',
                                                canSubmitRaise && !isControlsDisabled
                                                    ? 'cursor-pointer bg-gold-secondary text-surface shadow-[0_12px_24px_rgba(252,192,37,0.2)] hover:brightness-110 active:brightness-95'
                                                    : 'cursor-not-allowed bg-white/5 text-zinc-600',
                                            )}
                                        >
                                            {activePendingAction === actionType
                                                ? 'Submitting...'
                                                : actionType === 'BET'
                                                ? BTN_BET
                                                : BTN_RAISE}
                                        </button>
                                    </div>
                                </div>

                            </div>
                        ) : (
                            <div className={cn(
                                'flex w-full flex-wrap items-center justify-center',
                                isMobileLandscape ? 'gap-2' : 'gap-3 md:gap-4',
                            )}>
                                {legalActions.has('FOLD') && (
                                    <Button variant="outline" size={controlButtonSize} onClick={() => handleAction('FOLD')} disabled={isControlsDisabled}>
                                        {activePendingAction === 'FOLD' ? 'Submitting...' : BTN_FOLD}
                                    </Button>
                                )}

                                {canCheck ? (
                                    <Button variant="primary" size={controlButtonSize} onClick={() => handleAction('CHECK')} disabled={isControlsDisabled}>
                                        {activePendingAction === 'CHECK' ? 'Submitting...' : BTN_CHECK}
                                    </Button>
                                ) : canCall ? (
                                    <Button variant="primary" size={controlButtonSize} onClick={() => handleAction('CALL')} disabled={isControlsDisabled}>
                                        {activePendingAction === 'CALL' ? 'Submitting...' : `${BTN_CALL_PREFIX}${Math.min(callAmount, availableChips).toLocaleString()}`}
                                    </Button>
                                ) : null}

                                {legalActions.has('BET') && (
                                    <ButtonWithRef
                                        variant="outline"
                                        size={controlButtonSize}
                                        ref={amountTriggerRef}
                                        aria-expanded="false"
                                        aria-controls="amount-action-controls"
                                        onClick={() => {
                                            handleRaiseChange(raiseAmount);
                                            setAmountAction('BET');
                                        }}
                                        disabled={isControlsDisabled}
                                    >
                                        {BTN_BET}
                                    </ButtonWithRef>
                                )}

                                {legalActions.has('RAISE') && (
                                    <ButtonWithRef
                                        variant="outline"
                                        size={controlButtonSize}
                                        ref={amountTriggerRef}
                                        aria-expanded="false"
                                        aria-controls="amount-action-controls"
                                        onClick={() => {
                                            handleRaiseChange(raiseAmount);
                                            setAmountAction('RAISE');
                                        }}
                                        disabled={isControlsDisabled}
                                    >
                                        {BTN_RAISE}
                                    </ButtonWithRef>
                                )}

                                {canAllIn && (
                                    <Button variant="outline" size={controlButtonSize} onClick={() => handleAction('ALL_IN')} disabled={isControlsDisabled}>
                                        {activePendingAction === 'ALL_IN' ? 'Submitting...' : `${BTN_ALL_IN_PREFIX}${availableChips.toLocaleString()}`}
                                    </Button>
                                )}
                            </div>
                        )}
                    </motion.div>
                ) : isEffectivelyReadyCountdownActive ? (
                    <motion.div
                        key="ready-controls"
                        {...fadeMotion}
                        className={cn(
                            "flex w-full flex-col items-center justify-center gap-1.5 text-center px-4",
                            isMobileLandscape && 'pr-12'
                        )}
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

                        {isReadyEligible && readyCountdownSecondsRemaining > 0 && (
                            <div className="pt-0.5">
                                <Button
                                    variant={amReadyForNextHand ? 'secondary' : 'primary'}
                                    size={controlButtonSize === 'xs' ? 'xs' : 'sm'}
                                    onClick={isControlsDisabled ? undefined : (amReadyForNextHand ? onUnready : onReady)}
                                    disabled={isControlsDisabled}
                                >
                                    {amReadyForNextHand ? 'Unready' : BTN_READY}
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
                        className={cn(
                            "flex min-h-11 w-full items-center justify-center px-3 text-center",
                            isMobileLandscape && 'pr-12'
                        )}
                    >
                        <p className="text-xs font-headline font-bold uppercase tracking-[0.16em] text-amber-200">
                            {isAutoAdvancing
                                ? (gameState.autoAdvanceMessage || 'Auto-advancing...')
                                : gameState.phase === 'SHOWDOWN'
                                ? readyGateState === 'WAITING_FOR_PLAYERS'
                                    ? 'Hand complete — waiting for players'
                                    : 'Hand complete — reviewing board'
                                : turnStatus}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
            {displayedError && (
                <p
                    id="raise-amount-error"
                    role="alert"
                    className="absolute bottom-0 left-1/2 w-[calc(100%-1rem)] min-w-0 -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[10px] font-bold text-red-400"
                >
                    {displayedError}
                </p>
            )}
            {isMobileLandscape && onLeaveGame && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Button variant="ghost" size="xs" onClick={onLeaveGame} className="text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-1">
                        Leave
                    </Button>
                </div>
            )}
        </motion.section>
    );
}
