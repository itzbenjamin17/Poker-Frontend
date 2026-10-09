import { HeroSeat } from './HeroSeat';
import { OpponentSeats } from './OpponentSeats';
import type { TableScale } from '../lib/tableGeometry';
import type { Player, SeatPosition, GameState } from '../types';

export interface TablePlayersProps {
    orderedPlayers: Player[];
    currentPlayerId: string | undefined;
    myPlayerId: string | null;
    showdown: GameState | null;
    privateState: { holeCards: string[] } | null;
    getSeatPosition: (playerIndex: number, totalPlayers: number, heroIndex: number) => SeatPosition;
    isCompactTable: boolean;
    nowMs: number;
    tableScale: TableScale;
}

export function TablePlayers({
    orderedPlayers,
    currentPlayerId,
    myPlayerId,
    showdown,
    privateState,
    getSeatPosition,
    isCompactTable,
    nowMs,
    tableScale,
}: TablePlayersProps) {
    const heroIndex = orderedPlayers.findIndex((p) => p.id === myPlayerId);
    const heroPlayer = heroIndex >= 0 ? orderedPlayers[heroIndex] : undefined;

    return (
        <>
            <OpponentSeats
                orderedPlayers={orderedPlayers}
                currentPlayerId={currentPlayerId}
                myPlayerId={myPlayerId}
                heroIndex={heroIndex}
                showdown={showdown}
                getSeatPosition={getSeatPosition}
                isCompactTable={isCompactTable}
                nowMs={nowMs}
                tableScale={tableScale}
            />
            {heroPlayer && (
                <HeroSeat
                    player={heroPlayer}
                    currentPlayerId={currentPlayerId}
                    showdown={showdown}
                    privateCards={privateState?.holeCards ?? []}
                    isCompactTable={isCompactTable}
                    nowMs={nowMs}
                    tableScale={tableScale}
                />
            )}
        </>
    );
}
