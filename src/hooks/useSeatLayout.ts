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
    scale: number;
}

export function useSeatLayout({ width, height }: WindowDimensions): SeatLayoutInfo {
    const isCompactTable = width < 1024;
    const isWideTable = width >= 1280;
    const isLandscapeOrientation = width > height;
    const isMobileLandscape = isCompactTable && isLandscapeOrientation && height <= 520;
    const tableTier: TableTier = isCompactTable ? 'compact' : isWideTable ? 'wide' : 'standard';
    const scale = Math.min(1, Math.max(0.5, width / 1024));

    const getSeatPosition = useMemo(() => {
        return (index: number, total: number): SeatPosition => {
            const tier = tableTier;
            
            // Dynamic scaling based on active player count
            // Small games -> lower multiplier pulls avatars closer to the center pot
            // Larger games -> 1.0 multiplier pushes them evenly along the edge
            const spreadMultiplier = total <= 3 ? 0.6 : total <= 5 ? 0.8 : 1.0;

            // Local player always at bottom-center
            if (index === 0) {
                const baseHeroTop = tier === 'wide' ? 82 : tier === 'standard' ? 80 : 78;
                const pullUp = total <= 3 ? 12 : total <= 5 ? 6 : 0;
                return {
                    left: 50,
                    top: baseHeroTop - pullUp,
                    cardPlacement: 'right',
                };
            }

            const others = total - 1;
            
            // Calculate angle for opponents
            let angleDegrees;
            if (others === 1) {
                angleDegrees = 270; // Heads-up: directly top-center
            } else {
                // Distribute evenly along the top edge from roughly 195 to 345 degrees
                const startAngle = 195;
                const endAngle = 345;
                const t = (index - 1) / (others - 1);
                angleDegrees = startAngle + t * (endAngle - startAngle);
            }
            
            const angle = (angleDegrees * Math.PI) / 180;
            
            const centerY = tier === 'wide' ? 44 : tier === 'standard' ? 45 : 47;
            const baseRadiusX = tier === 'wide' ? 40 : tier === 'standard' ? 38 : 35;
            const baseRadiusY = tier === 'wide' ? 30 : tier === 'standard' ? 28 : 26;
            
            const radiusX = baseRadiusX * spreadMultiplier;
            const radiusY = baseRadiusY * spreadMultiplier;
            
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

    return { tableTier, isCompactTable, isWideTable, isMobileLandscape, getSeatPosition, scale };
}