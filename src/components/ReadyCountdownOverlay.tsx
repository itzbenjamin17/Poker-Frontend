import { cn } from '../lib/cn';
import { Button } from './UI';
import { BTN_READY, BTN_READY_CONFIRMED, READY_PROMPT } from '../constants/strings';
import type { Player } from '../types';

interface ReadyCountdownOverlayProps {
    isReadyCountdownActive: boolean;
    readyCountdownSecondsRemaining: number;
    readyCount: number;
    readyEligibleCount: number;
    readyEligiblePlayers: Player[];
    myPlayerId: string | null;
    isReadyEligible: boolean;
    amReadyForNextHand: boolean;
    isMobileLandscape: boolean;
    bottomCanvasWidthClass: string;
    controlButtonSize: 'xs' | 'sm' | 'md';
    onReady: () => void;
}

export function ReadyCountdownOverlay({
    isReadyCountdownActive,
    readyCountdownSecondsRemaining,
    readyCount,
    readyEligibleCount,
    readyEligiblePlayers,
    myPlayerId,
    isReadyEligible,
    amReadyForNextHand,
    isMobileLandscape,
    bottomCanvasWidthClass,
    controlButtonSize,
    onReady,
}: ReadyCountdownOverlayProps) {
    if (!isReadyCountdownActive) return null;

    return (
        <div className={cn(
            'pb-2 md:pb-3',
            bottomCanvasWidthClass,
            isMobileLandscape ? 'px-2' : 'px-3 sm:px-4 md:px-8',
        )}>
            <div className={cn(
                'mx-auto bg-emerald-primary/15 border border-emerald-primary/40 rounded-lg text-center backdrop-blur-md',
                isMobileLandscape
                    ? 'max-w-full px-2.5 py-2 space-y-1.5'
                    : 'max-w-3xl px-3 py-2 sm:px-4 sm:py-3 space-y-2',
            )}>
                <p className="text-emerald-primary font-headline font-bold uppercase tracking-wider text-[10px] sm:text-xs md:text-sm">
                    {READY_PROMPT}
                </p>
                <p className="text-white font-headline font-bold text-base sm:text-lg md:text-xl">
                    {readyCountdownSecondsRemaining}s
                </p>
                <p className="text-zinc-300 text-[9px] sm:text-[10px] uppercase tracking-widest">
                    {readyCount}/{readyEligibleCount} players ready
                </p>

                <div className={cn(
                    'grid mx-auto pt-1',
                    isMobileLandscape
                        ? 'grid-cols-2 gap-1 max-w-full'
                        : 'grid-cols-2 md:grid-cols-3 gap-1.5 sm:gap-2 max-w-2xl',
                )}>
                    {readyEligiblePlayers.map((player) => {
                        const isSelf = player.id === myPlayerId;
                        const isReady = Boolean(player.isReadyForNextHand);
                        return (
                            <div
                                key={player.id}
                                className={cn(
                                    'flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[9px] sm:text-[10px] uppercase tracking-wider font-bold',
                                    isReady
                                        ? 'bg-emerald-primary/15 border-emerald-primary/35 text-emerald-primary'
                                        : 'bg-amber-500/10 border-amber-300/35 text-amber-200',
                                    isSelf && 'ring-1 ring-white/40',
                                )}
                            >
                                <span className={cn('w-2 h-2 rounded-full shrink-0', isReady ? 'bg-emerald-primary' : 'bg-amber-300')} />
                                <span className="truncate">{player.name}</span>
                                <span className="ml-auto text-[8px] sm:text-[9px]">{isReady ? 'READY' : 'WAIT'}</span>
                            </div>
                        );
                    })}
                </div>

                {isReadyEligible && (
                    <div className="pt-1">
                        <Button
                            variant="primary"
                            size={controlButtonSize}
                            onClick={onReady}
                            disabled={amReadyForNextHand}
                        >
                            {amReadyForNextHand ? BTN_READY_CONFIRMED : BTN_READY}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
