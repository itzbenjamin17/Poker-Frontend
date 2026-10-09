# Parametric seat ellipse and containment architecture

**Status:** accepted

This architecture replaces hardcoded coordinate lookup tables and global window listeners with a closed-form parametric ellipse model and dynamic seat footprint fitting. It guarantees that for any supported viewport (from 650×300 minimum landscape up to 4K desktop) and 3–10 players, all opponent pods, showdown hole cards, and status badges remain strictly contained inside the table felt with zero element overlap.

## Problem Context

Earlier revisions positioned opponent seats using static coordinate arrays and global window resize handlers. This created severe failure modes:
1. **Felt boundary clipping**: At extreme aspect ratios (wide mobile landscape 844×390, constrained height 650×300), seats near the table edges or crown clipped past the felt rim.
2. **Showdown card collisions**: When 3–10 players reveal hole cards and hand rank badges at showdown, adjacent seats and the central board cluster collided.
3. **Window coupling**: Direct reliance on `window.innerWidth`/`innerHeight` caused unstable renders on mobile keyboard shifts or split-screen adjustments and created test friction.

## Decisions

### 1. Viewport Decoupling via Container Dimension Sync
`LiveTableStage` measures its actual rendered DOM container dimensions using `useElementSize` (powered by `ResizeObserver` with a robust fallback). The stage fits a responsive table box maintaining a 2.15:1 (standard) or 2.35:1 (wide) aspect ratio. Component sizing scales proportionally from this fitted box rather than raw window dimensions.

### 2. Parametric Trigonometric Ellipse Seating
Opponent seat positions are computed analytically along an ellipse arc:
\[
x = cx + rx \cdot \cos(\theta), \quad y = cy + ry \cdot \sin(\theta)
\]
Seats are evenly distributed across an angular span spanning the top and sides of the table, ordered relative to the local hero offset:
\[
k = (i - \text{heroIndex} + \text{total}) \pmod{\text{total}}
\]
The hero seat itself is statically anchored at `(50%, 86%)` above the action dock and never competes for dynamic angular allocation.

### 3. Dynamic Footprint Fitting (`fitSeatEllipse`)
To guarantee containment without arbitrary trial-and-error:
- The system evaluates the worst-case seat footprint (avatar diameter, expanded card fan, and status badges) scaled by `scale.overall`.
- `fitSeatEllipse` computes the maximum safe semi-major and semi-minor radii \((rx, ry)\) such that the outer bounding box of every seat remains at least `safeMarginPx(scale.overall)` inside the felt boundary.
- A closed-form calculation seeds the radii, backed by an iterative containment guard that clamps radii if extreme density requires it.

### 4. Avatar-Centered Geometric Origin
The root bounding box of `PlayerPod` is constrained strictly to the avatar dimensions (\(D \times D\)). All bottom-heavy elements (`handRank`, `currentBet`, `disconnectSecondsRemaining`, readiness indicators) are placed in an absolutely positioned container (`absolute top-full left-1/2 -translate-x-1/2`). This prevents asymmetrical element growth from displacing the pod's geometric center under CSS `-translate-x-1/2 -translate-y-1/2`.

### 5. Density Degradation & Showdown Card Fan
- **Scale Floor**: Enforced at `SCALE_FLOOR = 0.30` to prevent micro-text or unreadable elements on small devices.
- **Card Fan Geometry**: Showdown cards render as an overlapping fan with corner-indices always visible.
- **Badge Fallback**: When vertical clearance between top seats and the central board cluster is constrained, hand-rank labels transition gracefully (e.g. into the avatar badge or accessible screen-reader announcement) to prevent collisions with the pot.

## Consequences & Verification

- **Invariant**: Exactly 0 gating layout violations across all 393 verified cases across 8 viewports and 3–10 player counts.
- **Test Surface**: Pure geometric logic lives in [src/lib/tableGeometry.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/lib/tableGeometry.ts) and is verified by 46 unit test suites in Vitest.
- **CI Performance**: Layout measurement specs live in `scripts/layout/` and run via `npm run test:layout`, preventing CI test bloat while maintaining strict regression prevention.
