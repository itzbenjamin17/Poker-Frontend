# 0006: Shared Parametric Seating Geometry

Reviewed against the frontend implementation on 2026-11-10.

Calculate seating and fit in a shared geometry module rather than separate CSS coordinate templates for each player count and viewport. The table supports 2–10 players, anchors the hero bottom-center and orders opponents relative to the hero along an ellipse.

This keeps placement, footprints and containment under one model. Per-layout templates would require coordinating independent placements as density and card disclosure change. The trade-off is mathematical layout code and the need to align its footprint model with rendered content.

Use the measured stage as the sizing input and avatar centers as seat anchors. The components and fit calculations share seat metrics so expanding a label or changing card presentation does not silently establish a second positioning model. Replacing this approach requires coordinating seat rendering, footprint calculations and layout diagnostics, not just swapping a coordinate formula.

Exact aspect ratio, anchor percentages, density thresholds and viewport gates are tunable implementation details, not architectural commitments. Geometry aims to contain seats and avoid collisions at supported sizes; it cannot guarantee readability or zero overlap for arbitrary content. Geometry tests and rendered visual checks are both needed.

Implementation: [tableGeometry](../../src/lib/tableGeometry.ts), [useSeatLayout](../../src/hooks/useSeatLayout.ts), [LiveTableStage](../../src/components/LiveTableStage.tsx). Current behavior: [project context](../ai/PROJECT.md#table-layout-and-interaction).
