import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ShowdownModal } from './ShowdownModal';
import { NotificationBanner } from './NotificationBanner';
import { CompactPotDetails, PotBreakdown, TablePots } from './TablePots';
import { CommunityCardsArea } from './CommunityCardsArea';
import { TablePlayers } from './TablePlayers';
import { ReadyCountdownOverlay } from './ReadyCountdownOverlay';
import { useGameContext } from '../context/GameContext';
import type { PokerAction, SeatPosition, TableTier } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
} from '../constants/strings';
import type { ShowdownModalLayout, WsStatus } from '../types';

interface GameTableViewProps {
    tableTier: TableTier;
    isCompactTable: boolean;
    isMobileLandscape: boolean;
    scale: number;
    nowMs: number;
    raiseAmount: string;
    raiseError: string | null;
    showdownLayout: ShowdownModalLayout | null;
    showdownModalRef: React.RefObject<HTMLDivElement | null>;
    getSeatPosition: (index: number, total: number) => SeatPosition;
    onAction: (action: PokerAction, amount?: number) => void;
    onReady: () => void;
    onClaimWin: () => void;
    onLeaveGame: () => void;
    onRaiseChange: (val: string) => void;
    isActionPending: boolean;
    onShowdownDragPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onShowdownResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onShowdownPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onShowdownPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

export function GameTableView({
                                  tableTier,
                                  isCompactTable,
                                  isMobileLandscape,
                                  scale,
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
                                  isActionPending,
                                  onShowdownDragPointerDown,
                                  onShowdownResizePointerDown,
                                  onShowdownPointerMove,
                                  onShowdownPointerUp,
                              }: GameTableViewProps) {
    const { auth, gameState, privateState, showdown, showdownResult, claimPending, myPlayerId, notification, wsStatus } = useGameContext();

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

    const readyCountdownSecondsRemaining = isReadyCountdownActive && typeof gameState.readyCountdownDeadlineEpochMs === 'number'
        ? Math.max(0, Math.ceil((gameState.readyCountdownDeadlineEpochMs - nowMs) / 1000))
        : 0;

    const controlButtonSize: 'xs' | 'sm' | 'md' = isMobileLandscape ? 'xs' : isCompactTable ? 'sm' : 'md';
    const bottomCanvasWidthClass = 'w-full min-w-0';

    const uncalledAmount = gameState.uncalledAmount ?? 0;
    const potBreakdown = gameState.pots && gameState.pots.length > 0 ? gameState.pots : [gameState.pot];
    const displayedPot = Math.max(0, gameState.pot - uncalledAmount);
    const mainPot = potBreakdown[0] ?? gameState.pot;
    const sidePots = potBreakdown.slice(1);

    return (
        <div className={cn('h-dvh md:h-screen flex flex-col relative', 'overflow-hidden')}>
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

            {/* WebSocket connection status badge */}
            <WsStatusBadge status={wsStatus} />

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
                'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
                isMobileLandscape
                    ? 'min-w-0 min-h-0 items-center justify-center p-1.5'
                    : 'min-w-0 min-h-0 items-center justify-center',
                !isMobileLandscape &&
                (isCompactTable ? 'p-2' : 'p-3 sm:p-4 md:p-6 lg:p-8'),
            )}>
                <div className={cn(
                    'poker-table-gradient border-surface-high relative transition-all duration-300 overflow-visible',
                    tableTier === 'compact' && cn(
                        'w-full h-full aspect-[2.15/1] rounded-[72px] border-[8px] shadow-[0_0_48px_rgba(0,0,0,0.62)]',
                        isMobileLandscape && 'aspect-[2.35/1] rounded-[48px] border-[6px] min-w-0 min-h-0 max-h-[68dvh]',
                    ),
                    tableTier === 'standard' && 'w-full h-full aspect-[2.15/1] rounded-[170px] border-[10px] shadow-[0_0_76px_rgba(0,0,0,0.72)]',
                    tableTier === 'wide' && 'w-full h-full aspect-[2.35/1] rounded-[220px] border-[12px] shadow-[0_0_100px_rgba(0,0,0,0.8)]',
                )}
                    role="region"
                    aria-label="Poker table"
                >
                    {/* Community Cards & Pots */}
                    <section
                        aria-label="Board cluster"
                        className="absolute inset-0 flex flex-col items-center justify-center gap-2 md:gap-6"
                    >
                        <TablePots
                            displayedPot={displayedPot}
                            mainPot={mainPot}
                            sidePots={sidePots}
                            uncalledAmount={uncalledAmount}
                            phase={gameState.phase}
                        />
                        <CommunityCardsArea communityCards={gameState.communityCards} scale={scale} />
                        {isCompactTable ? (
                            (sidePots.length > 0 || uncalledAmount > 0) && (
                                <CompactPotDetails mainPot={mainPot} sidePots={sidePots} uncalledAmount={uncalledAmount} />
                            )
                        ) : (
                            <PotBreakdown mainPot={mainPot} sidePots={sidePots} uncalledAmount={uncalledAmount} />
                        )}
                    </section>

                    {/* Players */}
                    <TablePlayers
                        orderedPlayers={orderedPlayers}
                        currentPlayerId={gameState.currentPlayerId}
                        myPlayerId={myPlayerId}
                        showdown={showdown}
                        privateState={privateState}
                        getSeatPosition={getSeatPosition}
                        isCompactTable={isCompactTable}
                        nowMs={nowMs}
                        scale={scale}
                    />
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
            <ReadyCountdownOverlay
                isReadyCountdownActive={isReadyCountdownActive}
                readyCountdownSecondsRemaining={readyCountdownSecondsRemaining}
                readyCount={readyCount}
                readyEligibleCount={readyEligibleCount}
                readyEligiblePlayers={readyEligiblePlayers}
                myPlayerId={myPlayerId}
                isReadyEligible={isReadyEligible}
                amReadyForNextHand={amReadyForNextHand}
                isMobileLandscape={isMobileLandscape}
                bottomCanvasWidthClass={bottomCanvasWidthClass}
                controlButtonSize={controlButtonSize}
                onReady={onReady}
            />

            {/* Stable action slot - the table keeps the same height as turns change */}
            <div className={cn(
                'w-full shrink-0 overflow-hidden',
                isMobileLandscape ? 'h-20' : isCompactTable ? 'h-24' : 'h-28',
            )}>
                <ActionPanel
                    gameState={gameState}
                    me={me}
                    isMyTurn={isMyTurn}
                    isSelfDisconnected={isSelfDisconnected}
                    isReadyCountdownActive={isReadyCountdownActive}
                    currentTurnPlayerName={currentTurnPlayer?.name}
                    isMobileLandscape={isMobileLandscape}
                    isCompactTable={isCompactTable}
                    raiseAmount={raiseAmount}
                    raiseError={raiseError}
                    onRaiseChange={onRaiseChange}
                    onAction={onAction}
                    isActionPending={isActionPending}
                />
            </div>
        </div>
    );
}

// ─── Connection Status Badge ──────────────────────────────────────────────────

const WS_STATUS_CONFIG: Record<WsStatus, { dot: string; label: string; labelClass: string }> = {
    connected: {
        dot: 'bg-emerald-primary shadow-[0_0_8px_rgba(170,234,208,0.8)]',
        label: 'Connected',
        labelClass: 'text-emerald-primary/80',
    },
    reconnecting: {
        dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse',
        label: 'Reconnecting…',
        labelClass: 'text-amber-300/90',
    },
    disconnected: {
        dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse',
        label: 'Disconnected',
        labelClass: 'text-red-400/90',
    },
};

function WsStatusBadge({ status }: { status: WsStatus }) {
    const { dot, label, labelClass } = WS_STATUS_CONFIG[status];
    // Only show the full label on non-connected states (don't clutter the UI when all is fine)
    const showLabel = status !== 'connected';
    return (
        <div
            className="absolute top-4 right-3 md:top-5 md:right-5 z-40 flex items-center gap-1.5"
            role="status"
            aria-label={`Connection status: ${label}`}
        >
            {showLabel && (
                <span className={cn('text-[10px] font-bold uppercase tracking-wider hidden sm:inline', labelClass)}>
                    {label}
                </span>
            )}
            <span
                className={cn('w-2 h-2 rounded-full inline-block flex-shrink-0', dot)}
                aria-hidden="true"
            />
        </div>
    );
}
