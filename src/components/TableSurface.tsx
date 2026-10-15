import React from 'react';
import { cn } from '../lib/cn';
import type { TableDimensions } from '../lib/tableGeometry';
export interface TableSurfaceProps {
    tableDimensions: TableDimensions;
    tableScale: number;
    children: React.ReactNode;
    className?: string;
}

/**
 * Thickness of the table rim in px. It scales continuously with the measured table width
 * (about 1/90th of it), from 6px on the smallest tables up to 12px on the largest. This keeps
 * the thick dark rim the table originally had, without per-breakpoint steps.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getTableBorderWidth(tableWidth: number): number {
    return Math.round(Math.max(6, Math.min(12, tableWidth / 90)));
}

/** Purely visual container: felt, rim, shadow and ellipse. Size comes from the caller. */
export function TableSurface({
    tableDimensions,
    tableScale,
    children,
    className,
}: TableSurfaceProps) {
    return (
        <div
            className={cn(
                // box-content: the rim is drawn OUTSIDE the measured width/height, so the felt area
                // that seats are positioned against (percent coordinates) is unchanged by the rim.
                'poker-table-gradient box-content relative shrink-0 overflow-visible border-solid border-surface-high shadow-[0_0_76px_rgba(0,0,0,0.72)]',
                className,
            )}
            style={{
                width: tableDimensions.width,
                height: tableDimensions.height,
                borderRadius: '50%',
                borderWidth: getTableBorderWidth(tableDimensions.width),
                '--table-scale': tableScale,
            } as React.CSSProperties}
            role="region"
            aria-label="Poker table"
            data-testid="table-surface"
        >
            {children}
        </div>
    );
}
