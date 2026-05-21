import { useMemo } from 'react';
import type { SeatPosition, TableTier } from '../types';

interface WindowDimensions {
    width: number;
    height: number;
}

export interface SeatLayoutInfo {
    tableTier: TableTier;
    isCompactTable: boolean;
    isWideTable: boolean;
    isMobileLandscape: boolean;
    getSeatPosition: (index: number, total: number) => SeatPosition;
}

export function useSeatLayout({ width, height }: WindowDimensions): SeatLayoutInfo {
    const isCompactTable = width < 1024;
    const isWideTable = width >= 1280;
    const isLandscapeOrientation = width > height;
    const isMobileLandscape = isCompactTable && isLandscapeOrientation && height <= 520;
    const tableTier: TableTier = isCompactTable ? 'compact' : isWideTable ? 'wide' : 'standard';

    const getSeatPosition = useMemo(() => {
        return (index: number, total: number): SeatPosition => {
            const tier = tableTier;

            // Local player always at bottom-center
            if (index === 0) {
                return {
                    left: 50,
                    top: tier === 'wide' ? 82 : tier === 'standard' ? 80 : 78,
                    cardPlacement: 'right',
                };
            }

            // Heads-up: opponent directly across
            if (total === 2) {
                return {
                    left: 50,
                    top: tier === 'wide' ? 16 : tier === 'standard' ? 18 : 20,
                    cardPlacement: 'right',
                };
            }

            // Predefined seat layouts for common player counts (3–6 players, index 1..N-1)
            const seatLayouts: Record<number, { left: number; top: number; cardPlacement: SeatPosition['cardPlacement'] }[]> = {
                3: [
                    { left: 18, top: 45, cardPlacement: 'below' },
                    { left: 82, top: 45, cardPlacement: 'below' },
                ],
                4: [
                    { left: 15, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 48, cardPlacement: 'below' },
                    { left: 50, top: tier === 'wide' ? 14 : tier === 'standard' ? 16 : 18, cardPlacement: 'right' },
                    { left: 85, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 48, cardPlacement: 'below' },
                ],
                5: [
                    { left: 14, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                    { left: 28, top: tier === 'wide' ? 18 : tier === 'standard' ? 20 : 22, cardPlacement: 'right' },
                    { left: 72, top: tier === 'wide' ? 18 : tier === 'standard' ? 20 : 22, cardPlacement: 'left' },
                    { left: 86, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                ],
                6: [
                    { left: 12, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                    { left: 24, top: tier === 'wide' ? 19 : tier === 'standard' ? 20 : 22, cardPlacement: 'right' },
                    { left: 50, top: tier === 'wide' ? 12 : tier === 'standard' ? 14 : 16, cardPlacement: 'right' },
                    { left: 76, top: tier === 'wide' ? 19 : tier === 'standard' ? 20 : 22, cardPlacement: 'left' },
                    { left: 88, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                ],
            };

            const layout = seatLayouts[total];
            if (layout && index - 1 < layout.length) {
                const seat = layout[index - 1];
                return { left: seat.left, top: seat.top, cardPlacement: seat.cardPlacement };
            }

            // Fallback: elliptical distribution for 7+ players
            const others = total - 1;
            const t = (index - 1) / Math.max(1, others - 1);
            const angleDegrees = 200 + t * 140;
            const angle = (angleDegrees * Math.PI) / 180;
            const centerY = tier === 'wide' ? 44 : tier === 'standard' ? 45 : 47;
            const radiusX = tier === 'wide' ? 40 : tier === 'standard' ? 38 : 35;
            const radiusY = tier === 'wide' ? 30 : tier === 'standard' ? 28 : 26;
            const left = Math.max(10, Math.min(90, 50 + radiusX * Math.cos(angle)));
            const top = Math.max(12, Math.min(70, centerY + radiusY * Math.sin(angle)));

            let cardPlacement: SeatPosition['cardPlacement'];
            if (top < 30 && left < 50) cardPlacement = 'right';
            else if (top < 30 && left >= 50) cardPlacement = 'left';
            else if (left < 35) cardPlacement = 'below';
            else if (left > 65) cardPlacement = 'below';
            else cardPlacement = 'right';

            return { left, top, cardPlacement };
        };
    }, [tableTier]);

    return { tableTier, isCompactTable, isWideTable, isMobileLandscape, getSeatPosition };
}
