import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { Coins } from 'lucide-react';
import { Button } from './UI';
import { CardUI, PlayerPod } from './GameUI';
import { ActionPanel } from './ActionPanel';
import { ShowdownModal } from './ShowdownModal';
import { NotificationBanner } from './NotificationBanner';
import { useGameContext } from '../context/GameContext';
import type { SeatPosition, TableTier } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    BTN_READY, BTN_READY_CONFIRMED, READY_PROMPT,
    LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
    CARD_PLACEHOLDER_TURN, CARD_PLACEHOLDER_RIVER,
} from '../constants/strings';
import type { ShowdownModalLayout } from '../types';

interface GameTableViewProps {
    tableTier: TableTier;
    isCompactTable: boolean;
    isMobileLandscape: boolean;
    nowMs: number;
    raiseAmount: string;
    raiseError: string | null;
    showdownLayout: ShowdownModalLayout | null;
    showdownModalRef: React.RefObject<HTMLDivElement | null>;
    getSeatPosition: (index: number, total: number) => SeatPosition;
    onAction: (action: string, amount?: number) => void;
    onReady: () => void;
    onClaimWin: () => void;
    onLeaveGame: () => void;
    onRaiseChange: (val: string) => void;
    onShowdownDragPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onShowdownResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onShowdownPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onShowdownPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

export function GameTableView({
    tableTier,
    isCompactTable,
    isMobileLandscape,
    nowMs,
    raiseAmount,
    raiseError,
    showdownLayout,
    showdownModalRef,
    getSeatPosition,
    onAction,
    onReady,
    onClaimWin,
    onLeaveGame,
    onRaiseChange,
    onShowdownDragPointerDown,
    onShowdownResizePointerDown,
    onShowdownPointerMove,
    onShowdownPointerUp,
}: GameTableViewProps) {
    const { auth, gameState, privateState, showdown, showdownResult, claimPending, myPlayerId, notification } = useGameContext();

    if (!gameState) return null;

    const me = gameState.players.find((p) => p.id === myPlayerId);
    const orderedPlayers = (() => {
        const myIndex = gameState.players.findIndex((p) => p.id === myPlayerId || p.name === auth.playerName);
        if (myIndex <= 0) return gameState.players;
        return [...gameState.players.slice(myIndex), ...gameState.players.slice(0, myIndex)];
    })();

    const isMyTurn = gameState.currentPlayerId === myPlayerId;
    const isSelfDisconnected = me?.status === 'DISCONNECTED';
    const isReadyCountdownActive = Boolean(gameState.isReadyCountdownActive);
    const isWaitingForReconnect = Boolean(gameState.players.some((p) => p.status === 'DISCONNECTED'));
    const currentTurnPlayer = gameState.players.find((p) => p.id === gameState.currentPlayerId);

    const canClaimWin = Boolean(
        gameState.claimWinAvailable &&
        (gameState.claimWinPlayerName === auth.playerName || gameState.claimWinPlayerName === me?.name)
    );

    const isReadyEligible = Boolean(me && me.status !== 'OUT' && me.status !== 'DISCONNECTED');
    const amReadyForNextHand = Boolean(me?.isReadyForNextHand);

    const readyEligiblePlayers = gameState.players.filter(
        (player) => player.status !== 'OUT' && player.status !== 'DISCONNECTED'
    );
    const readyCount = readyEligiblePlayers.filter((player) => player.isReadyForNextHand).length;
    const readyEligibleCount = readyEligiblePlayers.length;

    const getDisconnectSecondsRemaining = (player: (typeof orderedPlayers)[number]) => {
        if (player.status !== 'DISCONNECTED') return undefined;
        const deadline = typeof player.disconnectDeadlineEpochMs === 'number'
            ? player.disconnectDeadlineEpochMs
            : undefined;
        if (deadline === undefined) return undefined;
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    };

    const readyCountdownSecondsRemaining = isReadyCountdownActive && typeof gameState.readyCountdownDeadlineEpochMs === 'number'
        ? Math.max(0, Math.ceil((gameState.readyCountdownDeadlineEpochMs - nowMs) / 1000))
        : 0;

    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    const bottomCanvasWidthClass = isMobileLandscape ? 'w-full min-w-0' : 'w-full min-w-[800px]';

    const uncalledAmount = gameState.uncalledAmount ?? 0;
    const potBreakdown = gameState.pots && gameState.pots.length > 0 ? gameState.pots : [gameState.pot];
    const displayedPot = Math.max(0, gameState.pot - uncalledAmount);
    const mainPot = potBreakdown[0] ?? gameState.pot;
    const sidePots = potBreakdown.slice(1);

    return (
        <div className={cn('h-dvh md:h-screen flex flex-col relative', 'overflow-auto')}>
            <NotificationBanner notification={notification} />

            {/* Showdown Modal */}
            <ShowdownModal
                showdownResult={showdownResult}
                layout={showdownLayout}
                modalRef={showdownModalRef}
                isMobileLandscape={isMobileLandscape}
                onDragPointerDown={onShowdownDragPointerDown}
                onResizePointerDown={onShowdownResizePointerDown}
                onPointerMove={onShowdownPointerMove}
                onPointerUp={onShowdownPointerUp}
            />

            {/* Leave Button */}
            <div className="absolute top-4 left-3 md:top-24 md:left-8 z-40">
                <Button variant="outline" size="sm" onClick={onLeaveGame} className="border-red-500/50 text-red-500 hover:bg-red-500/10">
                    {BTN_LEAVE_TABLE}
                </Button>
            </div>

            {canClaimWin && (
                <div className="absolute bottom-6 left-4 md:bottom-6 md:left-8 z-40">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onClaimWin}
                        disabled={claimPending}
                        className="shadow-[0_0_24px_rgba(170,234,208,0.35)]"
                    >
                        {claimPending ? BTN_CLAIMING : BTN_CLAIM_WIN}
                    </Button>
                </div>
            )}

            {/* Table Area */}
            <div className={cn(
                'relative flex flex-1',
                isMobileLandscape
                    ? 'min-w-0 min-h-0 items-center justify-center p-1.5'
                    : 'min-w-[800px] min-h-[600px]',
                !isMobileLandscape &&
                (isCompactTable ? 'items-center justify-center p-2' : 'items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10'),
            )}>
                <div className={cn(
                    'poker-table-gradient border-surface-high shadow-[0_0_100px_rgba(0,0,0,0.8)] relative transition-all duration-300 overflow-visible',
                    tableTier === 'compact' && cn(
                        'w-full h-full aspect-[2.15/1] rounded-[72px] border-[8px] min-w-[800px] min-h-[600px]',
                        isMobileLandscape && 'aspect-[2.35/1] rounded-[48px] border-[6px] min-w-0 min-h-0 max-h-[68dvh]',
                    ),
                    tableTier === 'standard' && 'w-full h-full aspect-[2.15/1] rounded-[170px] border-[10px]',
                    tableTier === 'wide' && 'w-full h-full aspect-[2.35/1] rounded-[220px] border-[12px]',
                )}>
                    {/* Community Cards */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 md:gap-6">
                        <div className="flex flex-col items-center gap-1 md:gap-2">
                            <div aria-label="Total Pot" className="bg-black/40 px-3 md:px-6 py-2 rounded-full border border-white/5 backdrop-blur-md flex items-center gap-2 md:gap-3">
                                <Coins aria-hidden="true" className="w-3 h-3 md:w-4 md:h-4 text-gold-secondary" />
                                <span className="font-headline font-bold text-lg md:text-2xl tracking-tight text-white">
                                    ${displayedPot.toLocaleString()}
                                </span>
                            </div>
                            <span className="text-[9px] md:text-[10px] text-emerald-primary/60 font-bold uppercase tracking-[0.2em] animate-in fade-in duration-500">
                                {gameState.phase.replace(/_/g, ' ')}
                            </span>
                        </div>

                        {!isCompactTable && (
                            <div className="flex flex-wrap items-center justify-center gap-2 px-4">
                                <div className="bg-black/35 px-3 py-1 rounded-full border border-white/10">
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_MAIN_POT}</span>
                                    <span className="ml-2 text-sm font-bold text-gold-secondary">${mainPot.toLocaleString()}</span>
                                </div>
                                {sidePots.map((amount, index) => (
                                    <div key={`side-pot-${index}`} className="bg-black/35 px-3 py-1 rounded-full border border-emerald-primary/30">
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">
                                            {LABEL_SIDE_POT_PREFIX} {index + 1}
                                        </span>
                                        <span className="ml-2 text-sm font-bold text-emerald-primary">${amount.toLocaleString()}</span>
                                    </div>
                                ))}
                                {uncalledAmount > 0 && (
                                    <div className="bg-black/35 px-3 py-1 rounded-full border border-red-400/40">
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_UNCALLED}</span>
                                        <span className="ml-2 text-sm font-bold text-red-300">${uncalledAmount.toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex gap-3">
                            {gameState.communityCards.map((card, i) => (
                                <motion.div key={i} initial={{ scale: 0, rotateY: 90 }} animate={{ scale: 1, rotateY: 0 }}>
                                    <CardUI card={card} />
                                </motion.div>
                            ))}
                            {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                                <div key={i} className="w-12 h-16 border-2 border-white/5 rounded-md border-dashed flex items-center justify-center">
                                    <span className="text-[8px] text-white/10 font-bold uppercase tracking-widest">
                                        {i === 0 && gameState.communityCards.length === 3
                                            ? CARD_PLACEHOLDER_TURN
                                            : i === 1 && gameState.communityCards.length === 4
                                                ? CARD_PLACEHOLDER_RIVER
                                                : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Players */}
                    {orderedPlayers.map((p, i) => {
                        const seat = getSeatPosition(i, orderedPlayers.length);
                        const showdownPlayer = showdown?.players.find(sp => sp.id === p.id);
                        const isShowdownWinner = Boolean(showdownPlayer?.isWinner);
                        const isSelf = p.id === myPlayerId;
                        const canRenderCards = p.status === 'ACTIVE' || p.status === 'ALL_IN' || p.status === 'DISCONNECTED';
                        const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
                        const playerPrivateCards = isSelf ? privateState?.holeCards ?? [] : [];
                        const displayCards = shouldReveal ? showdownPlayer!.holeCards! : playerPrivateCards;

                        return (
                            <div
                                key={p.id}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20"
                                style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                            >
                                <PlayerPod
                                    player={p}
                                    isCurrent={gameState.currentPlayerId === p.id}
                                    isWinner={isShowdownWinner}
                                    blindLabel={p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : undefined}
                                    disconnectSecondsRemaining={getDisconnectSecondsRemaining(p)}
                                    size={isCompactTable ? 'sm' : 'md'}
                                />

                                {canRenderCards && (
                                    <div className={cn(
                                        'absolute z-10 flex flex-col items-center',
                                        seat.cardPlacement === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-2',
                                        seat.cardPlacement === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
                                        seat.cardPlacement === 'below' && 'left-1/2 top-full -translate-x-1/2 mt-2',
                                    )}>
                                        <div className="flex gap-1 justify-center">
                                            {displayCards.length > 0
                                                ? displayCards.map((c, ci) => (
                                                    <motion.div
                                                        key={`cards-${p.id}-${ci}`}
                                                        initial={{ scale: 0.9, opacity: 0 }}
                                                        animate={{ scale: 1, opacity: 1 }}
                                                        transition={{ delay: ci * 0.08 }}
                                                    >
                                                        <CardUI card={c} className={cn(
                                                            isSelf
                                                                ? isCompactTable ? 'w-8 h-12' : 'w-11 h-16 md:w-12 md:h-16'
                                                                : isCompactTable ? 'w-5 h-8' : 'w-7 h-10 md:w-8 md:h-12',
                                                            isShowdownWinner && shouldReveal && 'ring-2 ring-gold-secondary shadow-[0_0_18px_rgba(252,192,37,0.45)]',
                                                            'shadow-md',
                                                        )} />
                                                    </motion.div>
                                                ))
                                                : !isSelf
                                                    ? [0, 1].map((ci) => (
                                                        <CardUI
                                                            key={`hidden-${p.id}-${ci}`}
                                                            card=""
                                                            hidden
                                                            className={cn(
                                                                isCompactTable ? 'w-5 h-8' : 'w-7 h-10 md:w-8 md:h-12',
                                                                'shadow-md opacity-90',
                                                            )}
                                                        />
                                                    ))
                                                    : null}
                                        </div>

                                        {showdownPlayer?.handRank && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.25 }}
                                                className={cn(
                                                    'mt-1 text-[9px] font-headline font-bold uppercase tracking-widest bg-black/80 px-2 py-0.5 rounded-full whitespace-nowrap border shadow-lg',
                                                    isShowdownWinner
                                                        ? 'text-gold-secondary border-gold-secondary/40'
                                                        : 'text-emerald-primary border-emerald-primary/30',
                                                )}
                                            >
                                                {showdownPlayer.handRank.replace(/_/g, ' ')}
                                            </motion.div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Waiting for reconnect banner */}
            {isWaitingForReconnect && currentTurnPlayer && !isCompactTable && (
                <div className={cn('px-4 md:px-8 pb-3', bottomCanvasWidthClass)}>
                    <div className="mx-auto max-w-3xl bg-amber-500/20 border border-amber-300/40 rounded-xl px-4 py-3 text-center backdrop-blur-md">
                        <p className="text-amber-200 font-headline font-bold uppercase tracking-wider text-xs md:text-sm">
                            {WAITING_RECONNECT_PREFIX}{currentTurnPlayer.name}{WAITING_RECONNECT_SUFFIX}
                        </p>
                    </div>
                </div>
            )}

            {/* Ready Countdown Panel */}
            {isReadyCountdownActive && (
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
            )}

            {/* Action Panel */}
            <ActionPanel
                gameState={gameState}
                me={me}
                isMyTurn={isMyTurn}
                isSelfDisconnected={isSelfDisconnected}
                isReadyCountdownActive={isReadyCountdownActive}
                isMobileLandscape={isMobileLandscape}
                isCompactTable={isCompactTable}
                raiseAmount={raiseAmount}
                raiseError={raiseError}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
            />
        </div>
    );
}
