import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { TableSurface } from './TableSurface';
import { BoardCluster } from './BoardCluster';
import { OpponentSeats } from './OpponentSeats';
import { HeroSeat } from './HeroSeat';
import { getPotBreakdown } from '../lib/game';
import { FALLBACK_STAGE, getTableDimensions } from '../lib/tableGeometry';
import { useElementSize } from '../hooks/useElementSize';
import { useSeatLayout } from '../hooks/useSeatLayout';
import type { GameState, Player } from '../types';

export { TableSurface } from './TableSurface';
export { BoardCluster } from './BoardCluster';
export { OpponentSeats } from './OpponentSeats';
export { HeroSeat } from './HeroSeat';

export interface LiveTableStageProps {
    nowMs: number;
    gameState: GameState;
    orderedPlayers?: Player[];
    myPlayerId?: string | null;
    showdown?: GameState | null;
    privateState?: { holeCards: string[] } | null;
    className?: string;
}

/**
 * Owns the table layout: measures its own stage, derives the table size,
 * scale, tier and seat positions from that measurement and from nothing else.
 */
export function LiveTableStage({
    nowMs,
    gameState,
    orderedPlayers: propOrderedPlayers,
    myPlayerId = null,
    showdown = null,
    privateState = null,
    className,
}: LiveTableStageProps) {
    const orderedPlayers = useMemo(
        () => propOrderedPlayers ?? gameState?.players ?? [],
        [propOrderedPlayers, gameState],
    );

    // The stage has no padding; the inset lives in getTableDimensions only.
    const { ref: stageRef, width: stageWidth, height: stageHeight } = useElementSize<HTMLDivElement>();
    const isMeasured = stageWidth > 0 && stageHeight > 0;
    const tableDimensions = useMemo(
        () => getTableDimensions(
            isMeasured ? stageWidth : FALLBACK_STAGE.width,
            isMeasured ? stageHeight : FALLBACK_STAGE.height,
        ),
        [isMeasured, stageWidth, stageHeight],
    );

    const seatLayout = useSeatLayout(tableDimensions, orderedPlayers.length);
    const { getSeatPosition, isCompactTable, tableScale } = seatLayout;

    if (!gameState) return null;

    const heroIndex = orderedPlayers.findIndex((p) => p.id === myPlayerId);
    const heroPlayer = heroIndex >= 0 ? orderedPlayers[heroIndex] : undefined;

    const uncalledAmount = gameState.uncalledAmount ?? 0;
    const potBreakdown = getPotBreakdown(gameState);
    const displayedPot = Math.max(0, gameState.pot - uncalledAmount);
    const mainPot = potBreakdown[0] ?? gameState.pot;
    const sidePots = potBreakdown.slice(1);

    return (
        <div
            ref={stageRef}
            data-testid="live-table-stage"
            aria-label="Live table stage"
            className={cn(
                'relative grid h-full w-full min-h-0 min-w-0 place-items-center overflow-hidden',
                className,
            )}
        >
            <TableSurface tableDimensions={tableDimensions} tableScale={tableScale.overall}>
                <BoardCluster
                    gameState={gameState}
                    displayedPot={displayedPot}
                    mainPot={mainPot}
                    sidePots={sidePots}
                    uncalledAmount={uncalledAmount}
                    tableScale={tableScale}
                />

                <OpponentSeats
                    orderedPlayers={orderedPlayers}
                    currentPlayerId={gameState.currentPlayerId}
                    myPlayerId={myPlayerId}
                    heroIndex={heroIndex}
                    showdown={showdown}
                    getSeatPosition={getSeatPosition}
                    isCompactTable={isCompactTable}
                    nowMs={nowMs}
                    tableScale={tableScale}
                    tableDimensions={tableDimensions}
                />

                {heroPlayer && (
                    <HeroSeat
                        player={heroPlayer}
                        currentPlayerId={gameState.currentPlayerId}
                        showdown={showdown}
                        privateCards={privateState?.holeCards ?? []}
                        isCompactTable={isCompactTable}
                        nowMs={nowMs}
                        tableScale={tableScale}
                        seatIndex={heroIndex >= 0 ? heroIndex : 0}
                    />
                )}
            </TableSurface>
        </div>
    );
}
