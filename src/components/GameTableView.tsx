import { useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ResultDock } from './ResultDock';
import { NotificationBanner, type NotificationControls } from './NotificationBanner';
import { ReconnectOverlay, RoomShellContext, RoomStage, RoomDock, useOrientationGating } from './PokerRoomLayout';
import { LiveTableStage } from './LiveTableStage';
import { GameContext } from '../context/GameContext';
import { ConfirmDialog } from './ConfirmDialog';

import type { ActionError, AuthResponse, GameState, PokerAction, RoomState, WsStatus } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    BTN_CONFIRM_LEAVE, BTN_CANCEL_LEAVE, CONFIRM_LEAVE_TABLE_TITLE, CONFIRM_LEAVE_TABLE_MESSAGE,
    TABLE_INACTIVITY_WARNING_TITLE, TABLE_INACTIVITY_WARNING_MESSAGE,
    BUSTED_TITLE, BUSTED_MESSAGE,
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
    notificationControls?: NotificationControls;
    wsStatus?: WsStatus;
    isRecovering?: boolean;
    recoveryFailed?: boolean;
    onRetryConnection?: () => void;
    isGameInactivityWarningActive?: boolean;

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
    /**
     * The room header split into the top corners outside the oval felt on short landscape screens.
     * Passing this switches GameTableView to the full-bleed corner-chrome layout.
     */
    cornerHeader?: ReactNode;
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
    notificationControls,
    wsStatus = 'connected',
    isRecovering,
    recoveryFailed,
    onRetryConnection,
    isGameInactivityWarningActive: propIsGameInactivityWarningActive,
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
    cornerHeader,
}: GameTableViewProps) {
    const gameContext = useContext(GameContext);
    const { isContentFrozen } = useContext(RoomShellContext);
    const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
    const { isMobileLandscape: detectedMobileLandscape, isCompactViewport } = useOrientationGating();
    const useCornerChrome = Boolean(cornerHeader);
    const dockLayout = useCornerChrome ? 'corner' : 'dock';
    const isMobileLandscape = propIsMobileLandscape ?? detectedMobileLandscape;
    const isCompactTable = propIsCompactTable ?? isCompactViewport;
    const effectiveIsRecovering = isRecovering ?? gameContext?.isRecovering ?? false;
    const effectiveRecoveryFailed = recoveryFailed ?? gameContext?.recoveryFailed ?? false;
    const effectiveOnRetry = onRetryConnection ?? gameContext?.retryConnection;
    const effectiveIsGameInactivityWarningActive =
        propIsGameInactivityWarningActive ?? gameContext?.isGameInactivityWarningActive ?? false;
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
        const rotated = myIndex <= 0
            ? players
            : [...players.slice(myIndex), ...players.slice(0, myIndex)];
        // Busted opponents stay on the server roster (for the final standings) but no longer have a seat.
        return rotated.filter((player, index) => player.status !== 'OUT' || (index === 0 && myIndex >= 0));
    }, [players, resolvedHeroId, effectivePlayerName]);

    const readyEligiblePlayers = useMemo(
        () => players.filter((player) => player.status !== 'OUT' && player.status !== 'DISCONNECTED' && player.chips > 0),
        [players]
    );

    if (!gameState || !roomState) return null;

    const me = resolvedHero ?? (resolvedHeroId ? players.find((p) => p.id === resolvedHeroId) : undefined);

    const isMyTurn = Boolean(resolvedHeroId && gameState.currentPlayerId === resolvedHeroId);
    const isSelfDisconnected = me?.status === 'DISCONNECTED';
    const isBusted = me?.status === 'OUT';
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

    const isTurnCountdownActive = gameState.phase !== 'SHOWDOWN' && !isReadyCountdownActive && !gameState.isAutoAdvancing;
    const turnSecondsRemaining = isTurnCountdownActive && typeof gameState.turnDeadlineEpochMs === 'number'
        ? Math.max(0, Math.ceil((gameState.turnDeadlineEpochMs - nowMs) / 1000))
        : undefined;

    const stage = (
        <RoomStage>
            <LiveTableStage
                nowMs={nowMs}
                gameState={gameState}
                orderedPlayers={orderedPlayers}
                myPlayerId={resolvedHeroId}
                showdown={showdown}
                privateState={privateState}
                turnDeadlineEpochMs={isTurnCountdownActive ? gameState.turnDeadlineEpochMs : undefined}
            />

            {/* Claim Win Button: bottom-left dead corner; shifted up slightly in corner-chrome mode to clear Raise presets. */}
            {canClaimWin && (
                <div
                    data-testid="claim-win-container"
                    className={cn(
                        'absolute left-[8px] z-20',
                        useCornerChrome ? 'bottom-12' : 'bottom-[8px]',
                    )}
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
    );

    const dock = gameState.phase === 'SHOWDOWN' && showdownResult ? (
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
            layout={dockLayout}
        />
    ) : isBusted ? (
        <BustedDock onLeave={onLeaveGame} isMobileLandscape={isMobileLandscape} layout={dockLayout} />
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
            turnSecondsRemaining={turnSecondsRemaining}
            layout={dockLayout}
        />
    );

    return (
        <main
            aria-label="Live poker table"
            data-testid="game-table-view"
            className={cn(
                'flex w-full max-w-full flex-col relative overflow-hidden overscroll-none',
                hasShellHeader ? 'flex-1 min-h-0 min-w-0' : 'h-dvh min-h-[600px]',
            )}
        >
            <div inert={useCornerChrome && isContentFrozen}>
                <NotificationBanner notification={notification} sequence={notificationSequence} {...notificationControls} />
            </div>

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
                        onClick={() => setIsConfirmingLeave(true)}
                        className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                    >
                        {BTN_LEAVE_TABLE}
                    </Button>
                    <ConfirmDialog
                        open={isConfirmingLeave}
                        title={CONFIRM_LEAVE_TABLE_TITLE}
                        message={CONFIRM_LEAVE_TABLE_MESSAGE}
                        confirmLabel={BTN_CONFIRM_LEAVE}
                        cancelLabel={BTN_CANCEL_LEAVE}
                        onConfirm={() => {
                            setIsConfirmingLeave(false);
                            onLeaveGame();
                        }}
                        onCancel={() => setIsConfirmingLeave(false)}
                    />
                </div>
            )}

            {/* WebSocket connection status badge */}
            {!hasShellHeader && <WsStatusBadge status={wsStatus} />}

            {/* In the layout flow, so the table re-fits below it rather than being covered by it. */}
            {effectiveIsGameInactivityWarningActive && (
                <div
                    role="status"
                    aria-live="polite"
                    inert={useCornerChrome && isContentFrozen}
                    className="shrink-0 mx-auto mt-2 short:mt-1 w-[calc(100%-2rem)] max-w-2xl px-3 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 flex items-center gap-2.5"
        >
                    <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0 text-amber-400" />
                    <p className="flex-1 min-w-0 text-[0.6875rem] md:text-xs leading-snug">
                        <span className="font-semibold text-amber-200">{TABLE_INACTIVITY_WARNING_TITLE}</span>
                        <span className="sr-only">: </span>
                        <span className="ml-2 text-zinc-300">{TABLE_INACTIVITY_WARNING_MESSAGE}</span>
                    </p>
                </div>
            )}

            {useCornerChrome ? (
                <div data-testid="corner-chrome-layout" className="relative flex flex-1 min-h-0 min-w-0 flex-col">
                    {/* Corner header (room info + Leave) stays above the reconnect overlay (z-40) and outside inert. */}
                    {cornerHeader}
                    {/* Full-bleed stage and corner dock isolate below ReconnectOverlay (z-30) and freeze together. */}
                    <div inert={isContentFrozen} className="relative isolate flex flex-1 min-h-0 min-w-0 flex-col">
                        {stage}
                        {dock}
                    </div>
                </div>
            ) : (
                <>
                    {stage}
                    {/* Stable action slot - the table keeps the same height as turns change */}
                    <RoomDock
                        data-is-compact={isCompactTable}
                        data-phase={gameState.phase}
                        className={cn(
                            isMobileLandscape ? 'h-16' : isCompactTable ? 'h-24' : 'h-28',
                        )}
                    >
                        {dock}
                    </RoomDock>
                </>
            )}
        </main>
    );
}

// ─── Busted Dock ──────────────────────────────────────────────────────────────

/** Replaces the action dock once the hero has no chips: the server no longer deals them in. */
function BustedDock({ onLeave, isMobileLandscape, layout = 'dock' }: {
    onLeave: () => void;
    isMobileLandscape: boolean;
    layout?: 'dock' | 'corner';
}) {
    const isCorner = layout === 'corner';
    if (isCorner) {
        return (
            <section
                aria-label="Action dock"
                data-testid="corner-dock"
                className="pointer-events-auto absolute right-1.5 bottom-1.5 z-20 flex items-center gap-2 rounded-xl border border-white/10 bg-surface-high/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md"
            >
                <div role="status" className="min-w-0 text-left">
                    <p className="font-headline font-bold text-white text-xs leading-tight">{BUSTED_TITLE}</p>
                    <p className="text-zinc-400 text-[0.625rem] leading-tight">{BUSTED_MESSAGE}</p>
                </div>
                <Button
                    variant="outline"
                    size="xs"
                    onClick={onLeave}
                    className="shrink-0 border-red-500/50 text-red-400 hover:bg-red-500/10"
                >
                    {BTN_LEAVE_TABLE}
                </Button>
            </section>
        );
    }
    return (
        <section
            aria-label="Action dock"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
            className={cn(
                'flex h-full w-full min-w-0 items-center justify-center gap-4 border-t border-white/5 bg-surface-high',
                isMobileLandscape ? 'px-3 py-1' : 'px-4 py-2 md:px-6',
            )}
        >
            <div role="status" className="min-w-0 text-left">
                <p className="font-headline font-bold text-white text-sm md:text-base">{BUSTED_TITLE}</p>
                <p className="text-zinc-400 text-xs">{BUSTED_MESSAGE}</p>
            </div>
            <Button
                variant="outline"
                size={isMobileLandscape ? 'xs' : 'sm'}
                onClick={onLeave}
                className="shrink-0 border-red-500/50 text-red-400 hover:bg-red-500/10"
            >
                {BTN_LEAVE_TABLE}
            </Button>
        </section>
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
                <span className={cn('text-[0.625rem] font-bold uppercase tracking-wider hidden sm:inline', labelClass)}>
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
