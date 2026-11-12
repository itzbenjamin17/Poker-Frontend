# Agent instructions

## Project context

Read [the project context](docs/ai/PROJECT.md) before changing application code. It describes the architecture, domain vocabulary, and available checks. Read the relevant decision records in `docs/adr/` before changing an architectural area; verify exact contracts against current source and configuration.

- [Issue tracker workflow](docs/agents/issue-tracker.md): GitHub Issues conventions.
- [Triage labels](docs/agents/triage-labels.md): canonical issue labels and their meanings.
- [Domain documentation](docs/agents/domain.md): glossary and ADR guidance for engineering work.

## Architecture invariants

- **Game state and transport:** Per [ADR-0002](docs/adr/0002-in-process-game-session-and-transport-port.md), `GameSession` owns game/session state outside React, and transport is behind `GameTransport`. `GameProvider` exposes session snapshots through `useSyncExternalStore`.
- **Table geometry:** Per [ADR-0006](docs/adr/0006-parametric-elliptical-seating-geometry.md), shared `tableGeometry.ts` positions seats using measured container dimensions. Preserve `TABLE_ASPECT = 2.15` and the hero anchor at `(50%, 86%)`; keep rendered seat metrics aligned with geometry.
- **Authentication and final review:** Per [ADR-0003](docs/adr/0003-tab-scoped-authentication-via-session-storage.md), active room credentials use tab-local `sessionStorage` under `poker-auth`; guard against stale requests clearing a newer session. `gameEndStorage.ts` owns the versioned `PersistedGameEndEnvelope` stored under `poker-game-end:{roomId}`.
- **Logging:** Use the redacting [logger](src/security/logger.ts) for diagnostics.

## Checks

Use Node.js 22 for local frontend checks and follow the Node version configured in CI. The Docker builder is a separate environment; its version is defined in `Dockerfile`.

For documentation-only changes, review the diff, verify links and referenced paths, and check formatting. Application tests and builds are not required unless the documentation change alters executable configuration or its instructions.

For bug fixes and feature logic, write a meaningful failing test first, confirm it fails for the intended reason, then implement and confirm it passes. For geometry changes and refactors, establish passing behavioral or characterization coverage before moving code; do not manufacture a failing test for the sequence. Assert public state, component output, published messages, and meaningful outcomes. Preserve existing assertions and never weaken tests to pass a check.

For code changes, select the narrowest relevant check while iterating. After integration, run one full Vitest pass (`npm run test -- --run`) and run the standard Playwright suite when the changed behavior or acceptance criteria require browser-flow coverage. `npm run test:all` runs both Vitest and standard Playwright; Playwright needs its configured backend and browser prerequisites. Run `npm run lint` for lint coverage and `npm run build` for TypeScript and production-build coverage. Layout diagnostics use the separate `npm run layout:*` scripts and are relevant when table layout changes. Confirm available scripts and prerequisites in `package.json` and [project context](docs/ai/PROJECT.md).

Create `.scratch/` before writing local check logs; it is ignored by Git. Redirect full test output there (for example, `npm run test -- --run <test-file> > .scratch/test.log 2>&1`). Report the command, pass/fail status, test counts, and log path for each relevant check; state any checks not run and why. Keep output focused on summaries and relevant failure details.

## Working tree

Inspect `git status` and the relevant diff before editing; preserve unrelated changes. Do not stage or commit changes unless explicitly requested. When staging is authorized, stage only explicit paths with `git add <file>`; never use `git add .` or `git add -A`. Never push, publish, or create remote issues or pull requests unless explicitly requested.
