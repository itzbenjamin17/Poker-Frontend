import { useCallback, useMemo } from 'react';
import type { SeatPosition, TableTier } from '../types';
import {
    classifyCardPlacement,
    classifyLabelPlacement,
    clamp,
    describeSeat,
    fitSeatEllipseCached,
    getTableScale,
    getTableTier,
    placeOpponentSeat,
} from '../lib/tableGeometry';
import type { SeatEllipse, TableDimensions, TableScale } from '../lib/tableGeometry';

export interface SeatLayoutInfo {
    tableTier: TableTier;
    isCompactTable: boolean;
    isWideTable: boolean;
    tableScale: TableScale;
    /** Same value as tableScale.overall, kept for callers that need one number. */
    scale: number;
    getSeatPosition: (playerIndex: number, totalPlayers: number, heroIndex: number) => SeatPosition;
    /** The fitted seat ellipse (percent of the table) that opponents are placed on for this player count. */
    getSeatEllipse: (totalPlayers: number, heroIndex: number) => SeatEllipse;
    tableDimensions: TableDimensions;
}

/** Hero is never a dynamically placed opponent: fixed bottom centre. */
export const HERO_POSITION = { left: 50, top: 86 } as const;

/**
 * Sanity bound for a seat (percent of the table). The fit keeps seats well inside it, so it never engages for a
 * supported table size: it only keeps degenerate input (0x0 tables, absurd aspect ratios) on the table.
 */
export const SEAT_SANITY_BOUNDS = { left: [2, 98], top: [2, 80] } as const;

/**
 * Seat geometry for a table of the given size. Takes the measured table
 * dimensions only: nothing here knows about the window, header, dock or padding.
 * Opponents sit on ONE ellipse for every player count; its radii are fitted so the
 * footprint of every seat (avatar, winner decoration, badges, labels, cards) stays
 * inside the felt with a margin that scales with the table.
 */
export function useSeatLayout(tableDimensions: TableDimensions, playerCount: number): SeatLayoutInfo {
    const { width, height } = tableDimensions;
    const tableTier = getTableTier(width);
    const isCompactTable = tableTier === 'compact';
    const isWideTable = tableTier === 'wide';

    const tableScale = useMemo(
        () => getTableScale({ width, height }, playerCount),
        [width, height, playerCount],
    );

    // The fit depends on the table, the tier and the number of players at the table (density), and is memoised per
    // player count: `playerCount` is a dependency so a new table size, count or tier gives a new layout identity.
    const getSeatEllipse = useCallback((totalPlayers: number, heroIndex: number): SeatEllipse => {
        const hasHero = heroIndex >= 0 && heroIndex < totalPlayers;
        return fitSeatEllipseCached(
            { width, height },
            totalPlayers,
            tableTier,
            hasHero ? totalPlayers - 1 : totalPlayers,
        );
        // playerCount: a new count is a new layout identity, even though the fit itself is keyed by the queried count.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height, tableTier, playerCount]);

    const getSeatPosition = useCallback((playerIndex: number, totalPlayers: number, heroIndex: number): SeatPosition => {
        if (playerIndex === heroIndex) {
            return {
                left: HERO_POSITION.left,
                top: HERO_POSITION.top,
                cardPlacement: 'right',
                // The hero keeps rank, bet and status to the left of the avatar.
                labelPlacement: 'avatar',
                ...describeSeat(HERO_POSITION.left, HERO_POSITION.top),
            };
        }

        // Without a hero (heroIndex < 0) every player is an opponent.
        const hasHero = heroIndex >= 0 && heroIndex < totalPlayers;
        const opponentCount = hasHero ? totalPlayers - 1 : totalPlayers;
        // Clockwise order starting right after the hero (correct for any heroIndex).
        const opponentIndex = hasHero
            ? (playerIndex - heroIndex - 1 + totalPlayers) % totalPlayers
            : playerIndex;

        const placed = placeOpponentSeat(opponentIndex, opponentCount, getSeatEllipse(totalPlayers, heroIndex));
        const left = clamp(placed.left, SEAT_SANITY_BOUNDS.left[0], SEAT_SANITY_BOUNDS.left[1]);
        const top = clamp(placed.top, SEAT_SANITY_BOUNDS.top[0], SEAT_SANITY_BOUNDS.top[1]);

        const description = describeSeat(left, top);
        // Hole cards face into the table. On a crowded table the seats along
        // the top centre would face each other, so their cards go below the avatar.
        const cardPlacement = classifyCardPlacement(left, top, opponentCount);

        return {
            left,
            top,
            cardPlacement,
            labelPlacement: classifyLabelPlacement(cardPlacement, description.side),
            ...description,
        };
    }, [getSeatEllipse]);

    return {
        tableTier,
        isCompactTable,
        isWideTable,
        tableScale,
        scale: tableScale.overall,
        getSeatPosition,
        getSeatEllipse,
        tableDimensions,
    };
}
