# 0008: Parametric Elliptical Seating Geometry and Dynamic Fitting

We decided to calculate player seat coordinates using continuous trigonometric equations along a parametric ellipse rather than static CSS grid or absolute coordinate templates.

## Context

A poker room supports anywhere from 2 to 10 players seated around an oval poker table. Standard responsive CSS (Flexbox or CSS Grid) cannot easily place arbitrary numbers of elements along a continuous oval perimeter while preserving the local player (hero) at bottom-center and adjusting relative spacing dynamically to prevent overlapping avatars, chips, and hole cards.

## Decision

1. **Parametric Ellipse Formula**: Calculate opponent positions in `src/lib/tableGeometry.ts` using parametric equations along an ellipse with fixed aspect ratio (`TABLE_ASPECT = 2.15`).
2. **Hero-Relative Anchoring**: Place the local player at a fixed bottom-center hero seat `(50%, 86%)` and distribute active opponents clockwise along the remaining elliptical perimeter.
3. **Dynamic Density Scaling**: Derive seat scale and bounding footprints dynamically based on player count and container width, ensuring zero overlap even with 10 players seated.

## Consequences

- Guarantees authentic poker table geometry that automatically adapts to any player count (2–10) and responsive screen size.
- Decouples visual seat rendering from layout math, keeping presentation components declarative and easily testable.
- Requires mathematical unit tests (`tableGeometry.test.ts`, `tableGeometry.footprint.test.ts`) to verify boundary containment.
