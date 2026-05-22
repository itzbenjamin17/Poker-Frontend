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
}: ActionPanelProps) {
    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    const bottomWidthClass = isMobileLandscape ? 'w-full min-w-0' : 'w-full min-w-[800px]';

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
                    <Button variant="outline" size={controlButtonSize} onClick={() => onAction('FOLD')}>
                        {BTN_FOLD}
                    </Button>

                    {(!me || (me.currentBet ?? 0) >= (gameState.currentBet || 0)) ? (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('CHECK')}>
                            {BTN_CHECK}
                        </Button>
                    ) : callExceedsStack ? (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('ALL_IN')}>
                            {BTN_ALL_IN_PREFIX}{availableChips.toLocaleString()}
                        </Button>
                    ) : (
                        <Button variant="outline" size={controlButtonSize} onClick={() => onAction('CALL')}>
                            {BTN_CALL_PREFIX}{callAmount.toLocaleString()}
                        </Button>
                    )}

                    {/* Custom Bet / Raise Input */}
                    <div className={cn(
                        'flex items-center gap-2 bg-black/40 p-1 rounded-md border border-white/10',
                        isMobileLandscape ? 'w-full justify-center' : isCompactTable ? '' : 'ml-4',
                    )}>
                        <span className={cn('font-bold', isCompactTable ? 'text-zinc-400 text-xs pl-2' : 'text-zinc-400 pl-3')}>
                            $
                        </span>
                        <input
                            type="number"
                            aria-label={ARIA_RAISE_AMOUNT}
                            aria-describedby={activeRaiseError ? 'raise-amount-error' : undefined}
                            aria-invalid={!!activeRaiseError}
                            className={cn(
                                'bg-transparent text-white font-bold outline-none placeholder:text-zinc-600',
                                isMobileLandscape ? 'w-16 text-xs' : isCompactTable ? 'w-12 text-xs' : 'w-24',
                            )}
                            placeholder={minRaiseAmount.toString()}
                            value={raiseAmount}
                            onChange={e => {
                                onRaiseChange(e.target.value);
                            }}
                            min={minRaiseAmount}
                            step={1}
                        />
                        <Button
                            variant="primary"
                            disabled={!canSubmitRaise}
                            size={controlButtonSize}
                            onClick={() => {
                                if (!canSubmitRaise) return;
                                const amount = Number.parseInt(rawRaise, 10);
                                onAction(actionType, amount);
                                onRaiseChange('');
                            }}
                        >
                            {(gameState.currentBet || 0) === 0 ? BTN_BET : BTN_RAISE}
                        </Button>
                    </div>

                    {activeRaiseError && (
                        <p id="raise-amount-error" role="alert" className="w-full max-w-md mx-auto text-center text-[10px] md:text-[11px] text-red-400 font-bold uppercase tracking-wider line-clamp-2 md:line-clamp-3">
                            {activeRaiseError}
                        </p>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
