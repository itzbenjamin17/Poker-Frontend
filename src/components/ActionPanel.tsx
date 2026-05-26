import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import {
    BTN_FOLD, BTN_CHECK, BTN_CALL_PREFIX, BTN_ALL_IN_PREFIX,
    BTN_BET, BTN_RAISE, ARIA_RAISE_AMOUNT,
} from '../constants/strings';
import type { GameState, Player } from '../types';

interface ActionPanelProps {
    gameState: GameState;
    me: Player | undefined;
    isMyTurn: boolean;
    isSelfDisconnected: boolean;
    isReadyCountdownActive: boolean;
    isMobileLandscape: boolean;
    isCompactTable: boolean;
    raiseAmount: string;
    raiseError: string | null;
    onRaiseChange: (val: string) => void;
    onAction: (action: string, amount?: number) => void;
    scale: number;
    isActionPending: boolean;
}

export function ActionPanel({
                                gameState,
                                me,
                                isMyTurn,
                                isSelfDisconnected,
                                isReadyCountdownActive,
                                isMobileLandscape,
                                isCompactTable,
                                raiseAmount,
                                raiseError,
                                onRaiseChange,
                                onAction,
                                scale,
                                isActionPending,
                            }: ActionPanelProps) {
    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    const bottomWidthClass = 'w-full min-w-0';

    const actionType = (gameState.currentBet || 0) === 0 ? 'BET' : 'RAISE';
    const minRaiseAmount = actionType === 'BET'
        ? 1
        : Math.max(1, (gameState.currentBet || 0) - (me?.currentBet ?? 0) + 1);
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
                    ? 'Bet amount must be at least 1 chip.'
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

    const show = isMyTurn && !isSelfDisconnected && !isReadyCountdownActive;

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    exit={{ y: 100 }}
                    className={cn(
                        'bg-surface-high border-t border-white/5 flex flex-wrap items-center justify-center',
                        bottomWidthClass,
                        isMobileLandscape ? 'gap-2 p-1.5' : 'gap-3 md:gap-4',
                        !isMobileLandscape && (isCompactTable ? 'p-2' : 'p-4 md:p-6'),
                    )}
                >
                    <Button variant="outline" size={controlButtonSize} onClick={() => onAction('FOLD')} disabled={isActionPending}>
                        {BTN_FOLD}
                    </Button>

                    {(!me || (me.currentBet ?? 0) >= (gameState.currentBet || 0)) ? (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('CHECK')} disabled={isActionPending}>
                            {BTN_CHECK}
                        </Button>
                    ) : callExceedsStack ? (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('ALL_IN')} disabled={isActionPending}>
                            {BTN_ALL_IN_PREFIX}{availableChips.toLocaleString()}
                        </Button>
                    ) : (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('CALL')} disabled={isActionPending}>
                            {BTN_CALL_PREFIX}{callAmount.toLocaleString()}
                        </Button>
                    )}

                    {/* Custom Bet / Raise Input */}
                    <div className={cn(
                        'flex items-stretch rounded-xl overflow-hidden border transition-colors duration-150',
                        hasError
                            ? 'border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]'
                            : 'border-white/10 focus-within:border-white/25',
                        isMobileLandscape ? 'w-full' : isCompactTable ? '' : 'ml-2',
                    )}>
                        {/* Currency label */}
                        <div className={cn(
                            'flex items-center bg-white/5 border-r border-white/10 select-none',
                            isCompactTable || isMobileLandscape ? 'px-2' : 'px-3',
                        )}>
                            <span className="text-zinc-400 font-bold text-sm">$</span>
                        </div>

                        {/* Number input */}
                        <input
                            type="number"
                            aria-label={ARIA_RAISE_AMOUNT}
                            aria-describedby={activeRaiseError ? 'raise-amount-error' : undefined}
                            aria-invalid={hasError}
                            className={cn(
                                'bg-black/30 text-white font-bold outline-none placeholder:text-zinc-600 tabular-nums',
                                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                isMobileLandscape ? 'w-20 text-xs px-2 py-1.5'
                                    : isCompactTable ? 'w-14 text-xs px-2 py-1.5'
                                        : 'w-24 text-sm px-3 py-2',
                            )}
                            placeholder={minRaiseAmount.toString()}
                            value={raiseAmount}
                            onChange={e => onRaiseChange(e.target.value)}
                            min={minRaiseAmount}
                            step={1}
                        />

                        {/* Raise / Bet submit button — flush inside the group */}
                        <button
                            type="button"
                            disabled={!canSubmitRaise || isActionPending}
                            onClick={() => {
                                if (!canSubmitRaise || isActionPending) return;
                                const amount = Number.parseInt(rawRaise, 10);
                                onAction(actionType, amount);
                                onRaiseChange('');
                            }}
                            className={cn(
                                'font-headline font-extrabold uppercase tracking-wider transition-all duration-150 select-none border-l border-white/10',
                                isCompactTable || isMobileLandscape ? 'text-[10px] px-2.5 py-1.5' : 'text-xs px-4 py-2',
                                canSubmitRaise && !isActionPending
                                    ? 'bg-gold-secondary text-black hover:brightness-110 active:brightness-95 cursor-pointer'
                                    : 'bg-white/5 text-zinc-600 cursor-not-allowed',
                            )}
                        >
                            {(gameState.currentBet || 0) === 0 ? BTN_BET : BTN_RAISE}
                        </button>
                    </div>

                    {/* Error message */}
                    <AnimatePresence>
                        {activeRaiseError && (
                            <motion.p
                                id="raise-amount-error"
                                role="alert"
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="w-full max-w-md mx-auto text-center text-[10px] md:text-[11px] text-red-400 font-bold uppercase tracking-wider line-clamp-2 md:line-clamp-3"
                            >
                                {activeRaiseError}
                            </motion.p>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
        </AnimatePresence>
    );
}