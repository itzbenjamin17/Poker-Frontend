import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ShowdownModal } from './ShowdownModal';
import { NotificationBanner } from './NotificationBanner';
import { CompactPotDetails, PotBreakdown, TablePots } from './TablePots';
import { CommunityCardsArea } from './CommunityCardsArea';
import { TablePlayers } from './TablePlayers';
import { getPotBreakdown } from '../lib/game';
import { useGameContext } from '../context/GameContext';
import { pokerApi } from '../services/api';
import { Trophy } from 'lucide-react';
import type { PokerAction, SeatPosition, TableTier } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
} from '../constants/strings';
import type { WsStatus } from '../types';

interface GameTableViewProps {
    tableTier: TableTier;
    isCompactTable: boolean;
    isMobileLandscape: boolean;
    scale: number;
    nowMs: number;
    raiseAmount: string;
    raiseError: string | null;
    getSeatPosition: (index: number, total: number) => SeatPosition;
    onAction: (action: PokerAction, amount?: number) => void;
    onReady: () => void;
    onClaimWin: () => void;
    onLeaveGame: () => void;
    onRaiseChange: (val: string) => void;
    isActionPending: boolean;
}

export function GameTableView({
                                  tableTier,
                                  isCompactTable,
                                  isMobileLandscape,
                                  scale,
                                  nowMs,
                                  raiseAmount,
                                  raiseError,
                                  getSeatPosition,
                                  onAction,
                                  onReady,
                                  onClaimWin,
                                  onLeaveGame,
                                  onRaiseChange,
                                  isActionPending,
                              }: GameTableViewProps) {
    const { auth, roomState, gameState, privateState, showdown, showdownResult, claimPending, myPlayerId, notification, wsStatus, gameEndResult, dispatch, clearShowdownTimers, onLeave } = useGameContext();

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

    const bottomCanvasWidthClass = 'w-full min-w-0';

    const uncalledAmount = gameState.uncalledAmount ?? 0;
    const potBreakdown = getPotBreakdown(gameState);
    const displayedPot = Math.max(0, gameState.pot - uncalledAmount);
    const mainPot = potBreakdown[0] ?? gameState.pot;
    const sidePots = potBreakdown.slice(1);

    const handleReturnToLobby = () => {
        dispatch({ type: 'CLEAR_GAME_STATE' });
        dispatch({ type: 'SET_NOTIFICATION', payload: null });
        dispatch({ type: 'SET_GAME_END_RESULT', payload: null });
        clearShowdownTimers();

        pokerApi.getRoomInfo(auth.roomId, auth.token)
            .then((r) => {
                dispatch({
                    type: 'SET_ROOM',
                    payload: {
                        roomId: r.roomId,
                        roomName: r.roomName,
                        players: r.players.map((pl: { name: string; isHost: boolean; joinedAt?: string }) => ({
                            name: pl.name,
                            isHost: pl.isHost,
                            joinedAt: pl.joinedAt,
                        })),
                        maxPlayers: r.maxPlayers,
                        buyIn: r.buyIn,
                        smallBlind: r.smallBlind,
                        bigBlind: r.bigBlind,
                        canStartGame: r.canStartGame,
                        gameStarted: r.gameStarted,
                    },
                });
            })
            .catch(() => onLeave?.());
    };

    return (
        <main
            aria-label="Live poker table"
            className={cn(
            'isolate flex h-[100svh] min-h-0 w-full max-w-full flex-col relative overflow-hidden overscroll-none',
            'md:h-screen',
        )}
        >
            <NotificationBanner notification={notification} />

            {gameEndResult && (
                <div className="absolute inset-0 bg-surface z-[100] flex flex-col items-center justify-center p-6 text-center select-none pointer-events-auto" role="dialog" aria-modal="true" aria-labelledby="game-over-title">
                    <div className="w-full max-w-md bg-surface-high border border-white/5 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="w-20 h-20 rounded-full bg-gold-secondary/10 flex items-center justify-center border border-gold-secondary/20">
                            <Trophy className="w-10 h-10 text-gold-secondary" />
                        </div>
                        <h2 id="game-over-title" className="font-headline text-4xl font-bold text-white tracking-tight uppercase">
                            Game Over
                        </h2>
                        <div className="space-y-2">
                            <p className="text-zinc-200 text-lg font-body">
                                {gameEndResult.message}
                            </p>
                            {gameEndResult.winnerName && (
                                <p className="text-emerald-primary font-headline text-sm font-bold tracking-widest uppercase">
                                    Winner: {gameEndResult.winnerName}
                                </p>
                            )}
                            {typeof gameEndResult.winnerChips === 'number' && (
                                <p className="text-zinc-400 text-xs uppercase tracking-widest">
                                    Winnings: ${gameEndResult.winnerChips.toLocaleString()} chips
                                </p>
                            )}
                        </div>
                        <Button
                            variant="primary"
                            size="lg"
                            className="w-full mt-4"
                            onClick={handleReturnToLobby}
                        >
                            Return to Menu
                        </Button>
                    </div>
                </div>
            )}

            {wsStatus !== 'connected' && (
                <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4 text-center select-none pointer-events-auto" role="alert" aria-live="assertive">
                    <div className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    <h2 className="font-headline text-2xl font-bold text-white tracking-tight">Connection lost</h2>
                    <p className="text-zinc-400 text-sm uppercase tracking-widest animate-pulse">Reconnecting&hellip;</p>
                </div>
            )}

            {/* Showdown Modal */}
            <ShowdownModal
                showdownResult={showdownResult}
                isReadyCountdownActive={isReadyCountdownActive}
            />

            {/* Leave Button */}
            <div className="absolute top-4 left-3 md:top-24 md:left-8 z-40">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        if (window.confirm('Are you sure you want to leave the table? This will abandon your seat.')) {
                            onLeaveGame();
                        }
                    }}
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                >
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
                    readyCountdownSecondsRemaining={readyCountdownSecondsRemaining}
                    readyCount={readyCount}
                    readyEligibleCount={readyEligibleCount}
                    readyEligiblePlayers={readyEligiblePlayers}
                    isReadyEligible={isReadyEligible}
                    amReadyForNextHand={amReadyForNextHand}
                    onReady={onReady}
                    bigBlind={roomState?.bigBlind ?? 20}
                />
            </div>
        </main>
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
