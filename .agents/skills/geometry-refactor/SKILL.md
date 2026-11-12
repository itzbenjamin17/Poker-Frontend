---
name: geometry-refactor
description: Refactor shared poker table sizing or seat geometry while preserving rendered layout contracts. Use for table geometry, seat placement, footprint, or measured-container changes.
---

# Table geometry refactors

Read [ADR-0006](../../../docs/adr/0006-parametric-elliptical-seating-geometry.md), [project table-layout context](../../../docs/ai/PROJECT.md#table-layout-and-interaction), and the current implementations in `src/lib/tableGeometry.ts`, `src/hooks/useSeatLayout.ts`, and `src/components/LiveTableStage.tsx` before changing geometry.

## Preservation loop

Run this one-shot Vitest command before editing and again after the change:

- `npm run test -- --run src/lib/__tests__/tableGeometry.preservation.test.ts src/lib/__tests__/tableGeometry.footprint.test.ts src/hooks/__tests__/useSeatLayout.preservation.test.ts`

Use Node.js 22 and capture full output in `.scratch/` logs. Diagnose any baseline failure before editing and record it so the comparison remains clear. When the change affects rendered geometry or seat positioning, also run `npm run layout:overlap`; it uses `playwright.layout.config.ts` with Chromium and Vite and does not need the backend.

Keep these public contracts intact unless the approved change explicitly revises them: dimensions derive from the measured stage; `TABLE_ASPECT` remains `2.15`; the hero anchor stays at `(50%, 86%)`; and geometry and rendered seats share the same metrics so opponent footprints remain contained. Check the rendered layout when changing positions, sizing, or seat presentation, not only the helper math.

After the checks, inspect the diff and request a `deep-reviewer` pass against ADR-0006. Report each command, pass/fail result, Vitest test count, and log path, plus any baseline failures or checks not run.
