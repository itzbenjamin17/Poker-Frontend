# 0006: Shared Parametric Seating Geometry

Reviewed against the frontend implementation on 2026-11-10.

Seat coordinates and scaling for 2 to 10 players are calculated in one shared TypeScript module (`tableGeometry.ts`) instead of maintaining separate hard-coded CSS layouts for every player count and screen size. `HeroSeat` is always pinned at the bottom center of the table, and opponent seats are spaced evenly around the oval table in clockwise seating order relative to the hero.

Having a single geometry module keeps seat positions, card placements, and overlap checks consistent as players join, leave, or reveal cards. Hard-coded CSS templates for each player count would easily drift out of sync whenever badge sizes or card layouts change.

`LiveTableStage` measures the available container size on screen, and `tableGeometry.ts` sizes the table oval and calculates where each seat's avatar center sits. Both the React seat components and the layout-fit tests read the same seat measurements so changing a label or card size does not cause seats to overlap or drift off the table.

Exact aspect ratios, scale limits, and minimum screen sizes are tunable constants inside `tableGeometry.ts`. Unit tests verify the math, and Playwright layout checks verify the rendered seats in a real browser.

Implementation: [tableGeometry](../../src/lib/tableGeometry.ts), [useSeatLayout](../../src/hooks/useSeatLayout.ts), [LiveTableStage](../../src/components/LiveTableStage.tsx). Current behavior: [project context](../ai/PROJECT.md#table-layout-and-interaction).