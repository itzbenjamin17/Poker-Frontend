import { cn } from '../lib/cn';
import { Button } from './UI';
import { ActionPanel } from './ActionPanel';
import { ShowdownModal } from './ShowdownModal';
import { NotificationBanner } from './NotificationBanner';
import { TablePots } from './TablePots';
import { CommunityCardsArea } from './CommunityCardsArea';
import { TablePlayers } from './TablePlayers';
import { ReadyCountdownOverlay } from './ReadyCountdownOverlay';
import { useGameContext } from '../context/GameContext';
import type { SeatPosition, TableTier } from '../types';
import {
    BTN_LEAVE_TABLE, BTN_CLAIM_WIN, BTN_CLAIMING,
    WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX,
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
                    {/* Community Cards & Pots */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 md:gap-6">
                        <TablePots
                            displayedPot={displayedPot}
                            mainPot={mainPot}
                            sidePots={sidePots}
                            uncalledAmount={uncalledAmount}
                            phase={gameState.phase}
                            isCompactTable={isCompactTable}
                        />
                        <CommunityCardsArea communityCards={gameState.communityCards} />
                    </div>

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
