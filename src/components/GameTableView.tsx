import { useContext, useMemo } from 'react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ResultDock } from './ResultDock';
import { NotificationBanner } from './NotificationBanner';
import { ReconnectOverlay, RoomStage, RoomDock, useOrientationGating } from './PokerRoomLayout';
import { LiveTableStage } from './LiveTableStage';
import { GameContext } from '../context/GameContext';

import type { ActionError, AuthResponse, GameState, PokerAction, RoomState, WsStatus } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
} from '../constants/strings';

export interface GameTableViewProps {
    /** Domain & session state */
    gameState: GameState | null;
    roomState: RoomState | null;
    auth?: AuthResponse | { playerName: string; token?: string; roomId?: string } | null;
    playerName?: string | null;
    myPlayerId?: string | null;
    privateState?: { holeCards: string[] } | null;
    showdown?: GameState | null;
    showdownResult?: GameState | null;
    claimPending?: boolean;
    notification?: string | null;
    notificationSequence?: number;
    wsStatus?: WsStatus;
    isRecovering?: boolean;
    recoveryFailed?: boolean;
    onRetryConnection?: () => void;

    /** Chrome-density flags for ActionPanel/ResultDock only; the table layout never reads them. */
    isCompactTable?: boolean;
    isMobileLandscape?: boolean;
    nowMs: number;
    raiseAmount?: string;
    raiseError?: string | null;
    actionError?: ActionError | null;
    onAction: (action: PokerAction, amount?: number) => void;
    onReady: () => void;
    onUnready?: () => void;
    onClaimWin: () => void;
    onLeaveGame: () => void;
    onRaiseChange?: (val: string) => void;
    onClearRaiseError?: () => void;
    isActionPending?: boolean;
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
    notificationSequence = 0,
    wsStatus = 'connected',
    isRecovering,
    recoveryFailed,
    onRetryConnection,
    isCompactTable: propIsCompactTable,
    isMobileLandscape: propIsMobileLandscape,
    nowMs,
    raiseAmount,
    raiseError = null,
    actionError,
    onAction,
    onReady,
    onUnready,
    onClaimWin,
    onLeaveGame,
    onRaiseChange,
    onClearRaiseError,
    isActionPending = false,
    hasShellHeader = false,
}: GameTableViewProps) {
    const gameContext = useContext(GameContext);
    const { isMobileLandscape: detectedMobileLandscape, isCompactViewport } = useOrientationGating();
    const isMobileLandscape = propIsMobileLandscape ?? detectedMobileLandscape;
    const isCompactTable = propIsCompactTable ?? isCompactViewport;
    const effectiveIsRecovering = isRecovering ?? gameContext?.isRecovering ?? false;
    const effectiveRecoveryFailed = recoveryFailed ?? gameContext?.recoveryFailed ?? false;
    const effectiveOnRetry = onRetryConnection ?? gameContext?.retryConnection;
    const showStandaloneOverlay =
        !hasShellHeader &&
        (wsStatus !== 'connected' || effectiveIsRecovering || effectiveRecoveryFailed);

    const effectivePlayerName = playerName ?? auth?.playerName ?? null;
    const players = useMemo(() => gameState?.players ?? [], [gameState?.players]);

    const resolvedHero = useMemo(() => {
        if (!players.length) return null;
        if (effectivePlayerName) {
            const foundByName = players.find((p) => p.name === effectivePlayerName);
            if (foundByName) return foundByName;
        }
        if (!effectivePlayerName && myPlayerId) {
            const foundById = players.find((p) => p.id === myPlayerId);
            if (foundById) return foundById;
        }
        return null;
    }, [players, effectivePlayerName, myPlayerId]);

    const resolvedHeroId = useMemo(() => {
        if (resolvedHero) return resolvedHero.id;
        if (effectivePlayerName) {
            if (myPlayerId && players.some((p) => p.id === myPlayerId && p.name === effectivePlayerName)) {
                return myPlayerId;
            }
            return null;
        }
        return myPlayerId ?? null;
    }, [resolvedHero, effectivePlayerName, myPlayerId, players]);

    const orderedPlayers = useMemo(() => {
        if (!players.length) return [];
        let myIndex = -1;
        if (resolvedHeroId) {
            myIndex = players.findIndex((p) => p.id === resolvedHeroId);
        }
        if (myIndex < 0 && effectivePlayerName) {
            myIndex = players.findIndex((p) => p.name === effectivePlayerName);
        }
        return myIndex <= 0
            ? players
            : [...players.slice(myIndex), ...players.slice(0, myIndex)];
    }, [players, resolvedHeroId, effectivePlayerName]);

    const readyEligiblePlayers = useMemo(
        () => players.filter((player) => player.status !== 'OUT' && player.status !== 'DISCONNECTED' && player.chips > 0),
        [players]
    );

    if (!gameState || !roomState) return null;

    const me = resolvedHero ?? (resolvedHeroId ? players.find((p) => p.id === resolvedHeroId) : undefined);

    const isMyTurn = Boolean(resolvedHeroId && gameState.currentPlayerId === resolvedHeroId);
    const isSelfDisconnected = me?.status === 'DISCONNECTED';
    const isReadyCountdownActive = Boolean(gameState.isReadyCountdownActive && gameState.readyGateState !== 'WAITING_FOR_PLAYERS');
    const currentTurnPlayer = players.find((p) => p.id === gameState.currentPlayerId)
        ?? players.find((p) => p.name === gameState.currentPlayerName);
    const reconnectingPlayerName =
        currentTurnPlayer?.status === 'DISCONNECTED' &&
        !currentTurnPlayer.hasFolded &&
        currentTurnPlayer.id !== resolvedHeroId &&
        currentTurnPlayer.name !== effectivePlayerName
            ? currentTurnPlayer.name
            : undefined;

    const canClaimWin = Boolean(
        gameState.claimWinAvailable &&
        ((effectivePlayerName && gameState.claimWinPlayerName === effectivePlayerName) || gameState.claimWinPlayerName === me?.name)
    );

    const isReadyEligible = Boolean(me && me.status !== 'OUT' && me.status !== 'DISCONNECTED' && me.chips > 0);
    const amReadyForNextHand = Boolean(me?.isReadyForNextHand);

    const readyCount = readyEligiblePlayers.filter((player) => player.isReadyForNextHand).length;
    const readyEligibleCount = readyEligiblePlayers.length;

    const readyCountdownSecondsRemaining = isReadyCountdownActive && typeof gameState.readyCountdownDeadlineEpochMs === 'number'
        ? Math.max(0, Math.ceil((gameState.readyCountdownDeadlineEpochMs - nowMs) / 1000))
        : 0;

    return (
        <main
            aria-label="Live poker table"
            data-testid="game-table-view"
            className={cn(
                'flex w-full max-w-full flex-col relative overflow-hidden overscroll-none',
                hasShellHeader ? 'flex-1 min-h-0 min-w-0' : 'h-[100dvh] min-h-[600px] md:h-screen',
            )}
        >
            <NotificationBanner notification={notification} sequence={notificationSequence} />

            {showStandaloneOverlay && (
                <ReconnectOverlay
                    role="alert"
                    className="z-50"
                    recoveryFailed={effectiveRecoveryFailed}
                    onRetry={effectiveOnRetry}
                />
            )}

            {/* Standalone Leave Button */}
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

            {/* Table Area */}
            <RoomStage>
                <LiveTableStage
                    nowMs={nowMs}
                    gameState={gameState}
                    orderedPlayers={orderedPlayers}
                    myPlayerId={resolvedHeroId}
                    showdown={showdown}
                    privateState={privateState}
                />

                {/* Claim Win Button: Place inside RoomStage at bottom-left with 8px inset */}
                {canClaimWin && (
                    <div
                        data-testid="claim-win-container"
                        className="absolute left-[8px] bottom-[8px] z-30"
                    >
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
            </RoomStage>

            {/* Stable action slot - the table keeps the same height as turns change */}
            <RoomDock
                data-is-compact={isCompactTable}
                data-phase={gameState.phase}
                className={cn(
                    isMobileLandscape ? 'h-16' : isCompactTable ? 'h-24' : 'h-28',
                )}
            >
                {gameState.phase === 'SHOWDOWN' && showdownResult ? (
                    <ResultDock
                        showdownResult={showdownResult}
                        isReady={amReadyForNextHand}
                        isReadyEligible={isReadyEligible}
                        isActionPending={isActionPending}
                        isReadyCountdownActive={isReadyCountdownActive}
                        readyGateState={gameState.readyGateState}
                        readyCountdownSecondsRemaining={readyCountdownSecondsRemaining}
                        readyCount={readyCount}
                        readyEligibleCount={readyEligibleCount}
                        onReady={onReady}
                        onUnready={onUnready}
                        isMobileLandscape={isMobileLandscape}
                    />
                ) : (
                    <ActionPanel
                        gameState={gameState}
                        me={me}
                        isMyTurn={isMyTurn}
                        isSelfDisconnected={isSelfDisconnected}
                        isReadyCountdownActive={isReadyCountdownActive && readyCountdownSecondsRemaining > 0}
                        readyGateState={gameState.readyGateState}
                        currentTurnPlayerName={currentTurnPlayer?.name}
                        reconnectingPlayerName={reconnectingPlayerName}
                        isMobileLandscape={isMobileLandscape}
                        isCompactTable={isCompactTable}
                        raiseAmount={raiseAmount}
                        raiseError={raiseError}
                        actionError={actionError}
                        onRaiseChange={onRaiseChange}
                        onClearRaiseError={onClearRaiseError}
                        onAction={onAction}
                        isActionPending={isActionPending}
                        readyCountdownSecondsRemaining={readyCountdownSecondsRemaining}
                        readyCount={readyCount}
                        readyEligibleCount={readyEligibleCount}
                        readyEligiblePlayers={readyEligiblePlayers}
                        isReadyEligible={isReadyEligible}
                        amReadyForNextHand={amReadyForNextHand}
                        onReady={onReady}
                        onUnready={onUnready}
                        bigBlind={roomState.bigBlind ?? 50}
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
