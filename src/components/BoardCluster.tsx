import { cn } from '../lib/cn';
import { TablePots } from './TablePots';
import { CommunityCardsArea } from './CommunityCardsArea';
import type { TableScale } from '../lib/tableGeometry';
import type { GameState } from '../types';

export interface BoardClusterProps {
    gameState: GameState;
    displayedPot: number;
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
    tableScale: TableScale;
    className?: string;
}

/** Centred on the table (50% / 50%) independently of any seat layout. */
export function BoardCluster({
    gameState,
    displayedPot,
    mainPot,
    sidePots,
    uncalledAmount,
    tableScale,
    className,
}: BoardClusterProps) {
    // Many side pots: shrink the pot row (boxes and fonts) so the board stays centred and compact.
    const potShrink = sidePots.length > 2 ? 0.75 : 1;
    return (
        <section
            aria-label="Board cluster"
            data-testid="board-cluster"
            className={cn(
                'absolute left-1/2 top-1/2 flex w-max max-w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-start',
                className,
            )}
            style={{ gap: `${Math.round(tableScale.spacing * 8)}px` }}
        >
            <TablePots
                displayedPot={displayedPot}
                mainPot={mainPot}
                sidePots={sidePots}
                uncalledAmount={uncalledAmount}
                phase={gameState.phase}
                scale={tableScale.spacing * potShrink}
                textScale={tableScale.text * potShrink}
            />
            <CommunityCardsArea communityCards={gameState.communityCards} scale={tableScale.overall} />
        </section>
    );
}
