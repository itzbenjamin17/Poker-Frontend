# Frontend Poker Project Context

This is the canonical project context for agents. Root `AGENTS.md` and `GEMINI.md` point here. Read relevant [ADRs](../adr/) before changing architecture; use the current source and configuration for exact contracts and commands.

## Project Overview

A React and TypeScript client for real-time multiplayer Texas Hold'em, paired with the Spring Boot backend in `../Poker`. Players create or join named rooms, receive a room-bound JWT, enter a lobby, play successive hands, and review the final game result. The backend owns poker rules and authoritative game state; the frontend owns presentation, local session state, transport coordination, and recovery.

The stack is React 19, TypeScript 5, Vite 8, Tailwind CSS 4, Motion, Lucide React, and STOMP. Exact dependency versions live in [package.json](../../package.json) and [package-lock.json](../../package-lock.json).

## Development And Configuration

Use `npm ci` to install the lockfile dependencies. CI uses Node.js 22; see [the workflow](../../.github/workflows/deploy.yml) and [Dockerfile](../../Dockerfile) for the environments actually configured.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite; development requests to `/api` and `/ws` proxy to the backend at port 8080. |
| `npm run build` | TypeScript project build checks followed by the Vite production build. |
| `npm run lint` | Run the ESLint flat configuration. |
| `npm run preview` | Preview the production assets locally. |
| `npm run test -- --run` | Run Vitest once; plain `npm run test` uses Vitest's default interactive behavior. |
| `npm run test -- --run <test-file>` | Run a targeted Vitest test file. |
| `npm run test:all` | Run Vitest once, then the standard Playwright suite. |
| `npm run backend:test` | Invoke the sibling backend with the `test` profile using the Windows Maven wrapper. |
| `npm run layout:overlap` / `npm run layout:screenshots` / `npm run layout:all` | Run optional layout diagnostics using the separate layout Playwright configuration. |

Scripts are defined in `package.json`; proxying and Vitest setup are in [vite.config.ts](../../vite.config.ts). The `backend:test` script is distinct from Playwright's backend setup: backend test resources use a random server port, while standard Playwright expects port 8080 and the `e2e` profile.

[api.ts](../../src/services/api.ts) reads these Vite build-time settings:

- `VITE_API_BASE_URL`: REST base, defaulting to `/api`.
- `VITE_WS_URL`: optional STOMP WebSocket URL; otherwise use the browser's host and matching `ws`/`wss` scheme at `/ws`.
- `VITE_DEBUG_STOMP=true`: enable redacted STOMP debug output in development.

The production [Nginx configuration](../../nginx.conf) serves the built client and proxies backend traffic. Client environment values are public build inputs, so credentials belong in backend configuration.

## Code Map

| Area | Entry points and responsibility |
| --- | --- |
| App and lobby | [App.tsx](../../src/App.tsx) selects lobby or lazy-loaded game view from auth state and wraps errors/Suspense. [Lobby.tsx](../../src/Lobby.tsx) coordinates create/join forms and their shared request lock. There is no router library. |
| Lobby requests | [useLobbyRequest.ts](../../src/components/lobby/useLobbyRequest.ts) owns request cancellation and prevents overlapping create/join submissions; [validation.ts](../../src/components/lobby/validation.ts) owns form rules. |
| Game container | [GameView.tsx](../../src/GameView.tsx) coordinates hydration, connection, actions, display clocks, and lobby/table/final-review selection. |
| Session store | [GameSession.ts](../../src/domain/GameSession.ts) owns public/private/room state, incoming frames, action locks, recovery coordination, notifications, and session timers. |
| React bridge | [GameProvider.tsx](../../src/context/GameProvider.tsx) constructs or accepts a session and exposes its snapshots through `useSyncExternalStore`; [GameContext.ts](../../src/context/GameContext.ts) defines the compatibility API. |
| Transport and time | [transport.ts](../../src/services/transport.ts) defines `GameTransport`, its STOMP adapter, and an in-memory test adapter. [clock.ts](../../src/domain/clock.ts) supplies production and deterministic test clocks. |
| Network lifecycle | [useSessionHydration.ts](../../src/hooks/useSessionHydration.ts), [useGameWebSocket.ts](../../src/hooks/useGameWebSocket.ts), and [useGameDispatcher.ts](../../src/hooks/useGameDispatcher.ts) handle REST hydration, connection/resync, and commands respectively. |
| Contracts | [types.ts](../../src/types.ts) contains domain and payload types; [payloads.ts](../../src/lib/payloads.ts) validates/normalizes incoming data and maps room responses. |
| Table geometry | [tableGeometry.ts](../../src/lib/tableGeometry.ts) owns dimensions, scale, seat metrics, footprints, containment, and disclosure decisions. [useSeatLayout.ts](../../src/hooks/useSeatLayout.ts) adapts it to React. |
| Presentation | `src/components/` contains lobby/table/review views, table seats, board, pots, action/result docks, room shell, and reusable UI primitives. |
| Theme and copy | [index.css](../../src/index.css) defines Tailwind theme tokens and global CSS; [strings.ts](../../src/constants/strings.ts) holds shared copy. |
| Storage and logging | [useAuthSession.ts](../../src/hooks/useAuthSession.ts) manages auth persistence; [gameEndStorage.ts](../../src/services/gameEndStorage.ts) stores the final review snapshot; [logger.ts](../../src/security/logger.ts) gates and redacts diagnostic output. |

## Session And Transport Architecture

Per [ADR-0003](../adr/0003-in-process-game-session-and-transport-port.md), game session state lives outside React. `GameProvider` accepts injected `GameSession`, `GameTransport`, and `Clock` dependencies for tests. Views receive explicit game data and action callbacks from the container.

1. Create/join REST responses wrap `TokenResponse` in `ApiResponse`. The API client normalizes these to `AuthResponse` containing token, room ID, player name, and message.
2. `useAuthSession` restores validated auth from `poker-auth` localStorage, synchronizes browser-tab storage changes, and processes token-specific `auth-expired` events.
3. Initial REST hydration checks room membership, loads public/private game state when a game is active, and redirects when the room or seat is gone. A persisted final-game result allows review after server cleanup without live hydration.
4. Once hydrated, the WebSocket hook connects the session. The session subscribes to `/room/{roomId}`, `/game/{roomId}`, and `/user/queue/private`.
5. The WebSocket hook performs REST resync on connection, tab wake-up, online events, and manual retry. The session deduplicates recovery, bounds retries, and uses generation/revision guards to avoid applying obsolete recovery results over newer state.
6. Gameplay and readiness commands publish to `/app/{gameId}/action`, `/app/{gameId}/ready`, and `/app/{gameId}/unready`. Start, leave, and claim-win use authenticated REST calls. Backend game IDs reuse room IDs.

The API wrapper handles HTTP status errors, malformed expected responses, a request timeout, and caller cancellation. Gameplay state is decoded at runtime; TypeScript interfaces alone do not validate network data. JWT parsing in the client checks shape/expiry for session handling, while signature and authorization checks remain the backend's responsibility.

Final-game snapshots use `poker-game-end:{roomId}`. Keep final-game review distinct from a single-hand showdown and its ready countdown. [game.ts](../../src/lib/game.ts) formats ranks/results and pot/card presentation; it is not the authoritative poker hand evaluator.

## Table Layout And Interaction

[ADR-0001](../adr/0001-adaptive-table-first-game-page.md) establishes the table-first experience. Current measured-container sizing and parametric seating are implemented in `LiveTableStage`, `useSeatLayout`, and `tableGeometry.ts`.

- `PokerRoomLayout` owns viewport eligibility, header/stage/dock regions, and the reconnect overlay. The overlay makes the underlying stage/dock inert while preserving header access.
- `LiveTableStage` measures its container through `useElementSize`. `getTableDimensions` fits the table to that space; table content sizing uses measured dimensions rather than window size.
- Current geometry uses a single `TABLE_ASPECT = 2.15`. Compact/standard/wide tiers derive from table width; density reduces opponent sizes at crowded tables.
- Opponents are ordered relative to the hero and placed along a continuous ellipse. The fit uses shared seat footprints and a containment guard. Keep rendered seat metrics and geometry calculations aligned.
- The hero stays at `(50%, 86%)`. Avatar centers anchor seats; subordinate labels/cards must not displace those anchors.
- Cards have compact faces and minimum sizes. Rank/status disclosure depends on felt and board clearances; hidden visual details retain accessible or expanded-seat equivalents.
- Current viewport gates are portrait minimum 600×800; landscape below 1024px width minimum 667×375; desktop at least 1024px wide requires 600px height. These gates use window dimensions separately from measured table geometry.

## Styling And Development Conventions

Use functional components and focused hooks. Keep transport/state logic at the existing session seams and avoid ambient state dependencies in presentational views.

Use `cn` for conditional classes, shared types for contracts, runtime decoders at boundaries, and shared strings for reusable copy. The theme uses Space Grotesk headlines, Inter body text, emerald for active/positive state, gold for chips/stakes, and dark surfaces. Consult `index.css` for exact tokens.

Preserve keyboard access, semantic labels, focus handling, reduced motion, and non-color status cues. Follow the existing request/error paths instead of inventing a second error helper. Diagnostics use the redacting logger, which is silent in production.

## Tests And CI

- Vitest defaults to JSDOM through `vite.config.ts`; domain tests can opt into Node. Shared setup/fixtures and MSW/STOMP doubles live in `src/test/`.
- Session flows use `TestClock` and `InMemoryTransportAdapter`. Component/integration tests exercise rendering, actions, recovery, and auth; geometry tests cover footprint fitting, anchoring, and preservation.
- [playwright.config.ts](../../playwright.config.ts) runs Chromium specs in `e2e/` and starts Vite plus the sibling backend with the `e2e` profile. Override `BACKEND_DIR` when the backend is elsewhere. Java 25, backend configuration, and installed Playwright Chromium are prerequisites even when individual specs mock traffic.
- Mocked browser flows use [stompWsMock.ts](../../e2e/support/stompWsMock.ts) and Playwright `routeWebSocket`. Keep mocks at the transport boundary rather than add production test switches.
- [playwright.layout.config.ts](../../playwright.layout.config.ts) runs `scripts/layout/` diagnostics with Vite only. These are separate from standard E2E and are not run by the normal CI workflow.
- The `main` push/PR workflow runs lint, Vitest, standard Playwright with the companion backend, and the production build. Successful pushes to `main` then build/push Docker images.
- ESLint includes accessibility and React rules but permits warning-level rules; `npm run lint` does not enforce zero warnings. A successful build/test run establishes only the checks actually executed, not a timing or universal layout guarantee.

Test public behavior and accessibility. Prefer semantic queries and deterministic session/transport seams. Verify winner identity, chips, cards, and meaningful outcomes where relevant rather than visibility-only assertions or private implementation details. Historical research under `docs/research/` describes the code at the time of its audit; verify observations against current source.

## Domain Vocabulary

| Term | Meaning |
| --- | --- |
| Room | A named lobby/session container with a backend-generated UUID. Players join by room name; `roomId` identifies API/STOMP resources. |
| Game | The backend-managed sequence of hands associated with a room; its ID reuses the room ID. |
| Hand / round | One deal through betting phases and showdown, distinct from final game completion. |
| Hero | The local player, pinned at the bottom-center seat. |
| Opponent | Another seated player placed on the opponent ellipse. |
| PlayerPod | Avatar-centered seat presentation with status and supporting details. |
| Board cluster | Central pots/phase/community-card area. |
| Action dock | Persistent lower action/turn-status controls. |
| Result dock | In-game hand result and readiness surface. |
| Final review | Frozen end-of-game recap that can survive page refresh after server cleanup. |

## Agent Roles And Model Selection

Choose the main chat model for the decisions the task requires. For architecture, ambiguous requirements, or difficult debugging, prefer GPT-6.1 Sol with high reasoning in Codex or the Pro tier in Antigravity. Luna with medium reasoning or Flash is suitable for straightforward work with clear acceptance criteria. These are task-specific recommendations, not a requirement to start every chat at a higher tier.

Custom subagents have their own model settings; choosing a stronger main model does not change the explicit model or reasoning setting in those role definitions. Treat the linked role files as the source of truth for models, reasoning effort, tools, and operating rules.

| Role | Codex definition | Antigravity definition | Delegate when |
| --- | --- | --- | --- |
| Explorer | [explorer](../../.codex/agents/explorer.toml) | [explorer](../../.agents/agents/explorer.md) | A specific file lookup, call-path trace, or coverage question would save the main agent substantial exploration. |
| Scoped implementer | [scoped_implementer](../../.codex/agents/scoped_implementer.toml) | [scoped-implementer](../../.agents/agents/scoped-implementer.md) | The plan is settled and file ownership, required behavior, and completion criteria are explicit. |
| Verifier | [verifier](../../.codex/agents/verifier.toml) | [verifier](../../.agents/agents/verifier.md) | Assigned checks need execution and a compact report of observed results. |
| Fast reviewer | [fast_reviewer](../../.codex/agents/fast_reviewer.toml) | [fast-reviewer](../../.agents/agents/fast-reviewer.md) | Presentational components, accessibility, forms, UI copy, and routine configuration changes. |
| Deep reviewer | [deep_reviewer](../../.codex/agents/deep_reviewer.toml) | [deep-reviewer](../../.agents/agents/deep-reviewer.md) | GameSession state transitions, REST/STOMP ordering, transport and timer lifecycles, runtime payload validation, authentication, and shared table-geometry algorithms. |

Keep decisions about the deep-review areas with the main agent or a stronger model. A scoped implementer can carry out a settled plan in those areas; a deep review is still required even for a small diff.

### Delegation And Usage

- Handle tiny edits directly. Delegate bounded work when its benefit exceeds the extra agent context and coordination.
- Supply the question or acceptance criteria, relevant evidence, explicit file ownership, allowed checks, and the expected handoff. Reuse existing findings instead of repeating exploration.
- Choose the reviewer whose scope matches the change. Use both reviewers when the change spans both scopes.
- Preserve concurrent edits and give workers distinct file ownership. The main agent integrates results and resolves cross-module decisions.
- Run the smallest relevant checks first. Expand or repeat checks only for an assigned requirement, an intervening change, or an unresolved failure.
- After an unsuccessful fix-and-check attempt, return evidence to the main agent for diagnosis rather than continuing speculative repairs. Report blockers and unfinished checks explicitly.
- Keep handoffs concise: file:line evidence, changed files, observed check results, and unresolved decisions.

Explorer and reviewer work is read-only by instruction. Implementers edit assigned files; verifiers write only normal generated build/test outputs. Parent-session permissions remain authoritative: Codex custom-agent sandbox settings do not override the parent sandbox, and Antigravity subagents inherit the parent's safety boundaries.

Model and reasoning guidance: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents). Antigravity discovery, model tiers, and permission inheritance: [custom subagents](https://www.antigravity.google/docs/subagents/).
