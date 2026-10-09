import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ResultDock } from './ResultDock';
import { NotificationBanner } from './NotificationBanner';
import { RoomStage, RoomDock } from './PokerRoomLayout';
import { LiveTableStage } from './LiveTableStage';

import type { GameState, PokerAction, RoomState, WsStatus } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
} from '../constants/strings';

export interface GameTableViewProps {
    /** Domain & session state */
    gameState: GameState | null;
    roomState: RoomState | null;
    auth?: { playerName: string } | null;
    playerName?: string;
    myPlayerId?: string | null;
    privateState?: { holeCards: string[] } | null;
    showdown?: GameState | null;
    showdownResult?: GameState | null;
    claimPending?: boolean;
    notification?: string | null;
    wsStatus?: WsStatus;

    /** Chrome-density flags for ActionPanel/ResultDock only; the table layout never reads them. */
    isCompactTable?: boolean;
    isMobileLandscape?: boolean;
    nowMs: number;
    raiseAmount: string;
    raiseError: string | null;
    onAction: (action: PokerAction, amount?: number) => void;
    onReady: () => void;
    onUnready?: () => void;
    onClaimWin: () => void;
    onLeaveGame: () => void;
    onRaiseChange: (val: string) => void;
    isActionPending: boolean;
    hasShellHeader?: boolean;
}

export function GameTableView({
    gameState,
    roomState,
    auth,
    playerName,
    myPlayerId = null,
    privateState = null,
    showdown = null,
    showdownResult = null,
    claimPending = false,
    notification = null,
    wsStatus = 'connected',
    isCompactTable = false,
    isMobileLandscape = false,
    nowMs,
    raiseAmount,
    raiseError,
    onAction,
    onReady,
    onUnready,
    onClaimWin,
    onLeaveGame,
    onRaiseChange,
    isActionPending,
    hasShellHeader = false,
}: GameTableViewProps) {
    if (!gameState || !roomState) return null;

    const effectivePlayerName = playerName ?? auth?.playerName;
    const me = gameState.players.find((p) => p.id === myPlayerId);
    const myIndex = gameState.players.findIndex(
        (p) => p.id === myPlayerId || (effectivePlayerName && p.name === effectivePlayerName)
    );
    const orderedPlayers = myIndex <= 0
        ? gameState.players
        : [...gameState.players.slice(myIndex), ...gameState.players.slice(0, myIndex)];

    const isMyTurn = gameState.currentPlayerId === myPlayerId;
    const isSelfDisconnected = me?.status === 'DISCONNECTED';
    const isReadyCountdownActive = Boolean(gameState.isReadyCountdownActive);
    const isWaitingForReconnect = Boolean(gameState.players.some((p) => p.status === 'DISCONNECTED'));
    const currentTurnPlayer = gameState.players.find((p) => p.id === gameState.currentPlayerId);

    const canClaimWin = Boolean(
        gameState.claimWinAvailable &&
        ((effectivePlayerName && gameState.claimWinPlayerName === effectivePlayerName) || gameState.claimWinPlayerName === me?.name)
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

    return (
        <main
            aria-label="Live poker table"
            data-testid="game-table-view"
            className={cn(
                'isolate flex w-full max-w-full flex-col relative overflow-hidden overscroll-none',
                hasShellHeader ? 'flex-1 min-h-0 min-w-0' : 'h-[100dvh] min-h-[600px] md:h-screen',
            )}
        >
            <NotificationBanner notification={notification} />

            {!hasShellHeader && wsStatus !== 'connected' && (
                <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4 text-center select-none pointer-events-auto" role="alert" aria-live="assertive">
                    <div className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    <h2 className="font-headline text-2xl font-bold text-white tracking-tight">Connection lost</h2>
                    <p className="text-zinc-400 text-sm uppercase tracking-widest animate-pulse">Reconnecting&hellip;</p>
                </div>
            )}

            {/* Showdown Modal removed in favor of ResultDock */}

            {/* Leave Button */}
            {!hasShellHeader && (
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
            )}

            {/* WebSocket connection status badge */}
            {!hasShellHeader && <WsStatusBadge status={wsStatus} />}

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
            <RoomStage>
                <LiveTableStage
                    nowMs={nowMs}
                    gameState={gameState}
                    orderedPlayers={orderedPlayers}
                    myPlayerId={myPlayerId}
                    showdown={showdown}
                    privateState={privateState}
                />
            </RoomStage>

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
            <RoomDock
                data-is-compact={isCompactTable}
                data-phase={gameState.phase}
                className={cn(
                    isMobileLandscape ? 'h-16' : isCompactTable ? 'h-24' : 'h-28',
                    gameState.phase === 'SHOWDOWN' && 'short:h-12',
                )}
            >
                {gameState.phase === 'SHOWDOWN' ? (
                    <ResultDock showdownResult={showdownResult} isReady={amReadyForNextHand} onReady={onReady} onUnready={onUnready} isMobileLandscape={isMobileLandscape} onLeaveGame={onLeaveGame} />
                ) : (
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
                        bigBlind={roomState.bigBlind ?? 50}
                        onLeaveGame={onLeaveGame}
                    />
                )}
            </RoomDock>
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
