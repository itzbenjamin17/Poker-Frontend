# Frontend Poker Project Context

This is the canonical AI and project context for the repository. Root-level files such as `AGENTS.md` and `GEMINI.md` should stay thin wrappers that point here.

## Project Overview

This repository is a polished React 19 + TypeScript frontend for a real-time multiplayer Texas Hold'em poker game. It is built with Vite 8, styled with Tailwind CSS v4, and uses Motion for animation. The app communicates with a Spring Boot backend over REST for authentication, room, and game lifecycle actions, and over STOMP/WebSockets for live table events.

## Tech Stack

- **Framework**: React 19 with functional components and hooks
- **Language**: TypeScript 5.x with strict typing
- **Build Tool**: Vite 8 with `@tailwindcss/vite` and `@vitejs/plugin-react`
- **Styling**: Tailwind CSS v4 configured via `@theme` tokens in `src/index.css`
- **Animation**: Motion (`motion/react`)
- **Icons**: Lucide React
- **Transport**: `@stomp/stompjs` for real-time WebSocket messaging
- **Testing**: Vitest, React Testing Library, MSW, and Playwright

## Build And Run

Defined scripts from `package.json`:

- `npm install`: install dependencies
- `npm run dev`: start the Vite dev server (proxies `/api` and `/ws` to `localhost:8080`)
- `npm run build`: run TypeScript build checks (`tsc -b`) and production Vite build
- `npm run lint`: run ESLint flat config
- `npm run preview`: preview the production build locally
- `npm run test`: run the Vitest unit and component suite
- `npm run backend:test`: start companion Spring Boot backend with test profile (`../Poker`)
- `npm run test:all`: run Vitest followed by standard Playwright E2E tests
- `npm run layout:overlap`: (Diagnostic) run the Playwright layout measurement script (in `scripts/layout/`)
- `npm run layout:screenshots`: (Diagnostic) capture layout screenshot suites across viewports and player counts
- `npm run layout:all`: (Diagnostic) run all layout diagnostic scripts

The frontend expects a compatible backend at `http://localhost:8080` and proxies `/api` and `/ws` traffic there during development.

## Project Structure

```
frontend-poker/
├── docs/
│   ├── adr/                      # Architectural Decision Records (ADR-0001 – ADR-0003)
│   ├── agents/                   # Agent workflow guidelines (domain, issue tracking, labels)
│   └── ai/
│       └── PROJECT.md            # Canonical project context (this file)
├── scripts/
│   └── layout/                   # Layout verification and screenshot Playwright specs
│       ├── layout-overlap.spec.ts
│       └── layout-screenshots.spec.ts
├── src/
│   ├── main.tsx                  # Application entry point
│   ├── App.tsx                   # Root auth, router, and session restoration
│   ├── Lobby.tsx                 # Lobby page hosting the create/join room forms
│   ├── GameView.tsx              # Live game container (WebSocket orchestration & view switching)
│   ├── types.ts                  # Shared domain types, interfaces, and state models
│   ├── index.css                 # Theme tokens, font variables, and global CSS
│   ├── assets/                   # Static images (hero art, logos)
│   ├── components/
│   │   ├── lobby/
│   │   │   ├── CreateRoomForm.tsx# Create-table form (room name, alias, blinds, max players, buy-in)
│   │   │   ├── JoinRoomForm.tsx  # Quick-join form (room name, alias)
│   │   │   └── validation.ts     # Lobby form validation rules
│   │   ├── ActionPanel.tsx       # Betting slider, quick-bet buttons, and player actions
│   │   ├── BoardCluster.tsx      # Centered table area (pots and community cards)
│   │   ├── CommunityCardsArea.tsx# Flop, Turn, and River card slots
│   │   ├── ErrorBoundary.tsx     # Top-level render error fallback
│   │   ├── GameLobbyView.tsx     # Pre-game room lobby, player readiness, seat count
│   │   ├── GameReviewView.tsx    # End-of-hand recap and hand history review sheet
│   │   ├── GameTableView.tsx     # Active game table container
│   │   ├── GameUI.tsx            # CardUI, PlayerPod, chips, badges, and avatars
│   │   ├── HeroSeat.tsx          # Local player seat pinned at bottom-center (50%, 86%)
│   │   ├── LiveTableStage.tsx    # Stage container measuring bounds and fitting table aspect ratio
│   │   ├── LoadingView.tsx       # Splash and loading indicators
│   │   ├── NotificationBanner.tsx# Non-blocking toast notifications
│   │   ├── OpponentSeats.tsx     # Dynamic parametric opponent seating around table ellipse
│   │   ├── PokerRoomLayout.tsx   # Viewport gating thresholds (landscape/portrait constraints)
│   │   ├── ResultDock.tsx        # In-table round recap, payouts, winner announcements, ready controls
│   │   ├── RoomHeader.tsx        # Header with room code, blinds, hand count, and leave table action
│   │   ├── RotatePrompt.tsx      # Device rotation prompt on unsupported screen dimensions
│   │   ├── TablePlayers.tsx      # High-level seat orchestrator
│   │   ├── TablePots.tsx         # Main pot, side pots, chip stacks, and breakdown toggles
│   │   ├── TableSurface.tsx      # Felt oval surface rendering, scaled rim and rail
│   │   └── UI.tsx                # Generic primitives (Button, Input, Badge, Card, Modal)
│   ├── constants/
│   │   └── strings.ts            # UI copy, accessible labels, and display strings
│   ├── context/
│   │   ├── GameContext.ts        # Context type, `Action` union, and `useGameContext` accessor
│   │   └── GameProvider.tsx      # Bridges the `GameSession` store into React via `useSyncExternalStore`
│   ├── domain/
│   │   ├── GameSession.ts        # In-process game store: payload application, action lock, showdown/room-closed timers
│   │   └── clock.ts              # `Clock` port with `SystemClock` (prod) and `TestClock` (deterministic tests)
│   ├── hooks/
│   │   ├── useAuthSession.ts     # JWT storage in localStorage (`poker-auth`)
│   │   ├── useElementSize.ts     # ResizeObserver hook for container dimension measurement
│   │   ├── useGameDispatcher.ts  # Game action dispatching with pending state management
│   │   ├── useGameWebSocket.ts   # Transport lifecycle: subscriptions, frame handling, and auto-reconnect
│   │   ├── useNotification.ts    # Toast notification state and timeouts
│   │   ├── useSeatLayout.ts      # Parametric ellipse seating calculations wrapping `tableGeometry.ts`
│   │   ├── useSessionHydration.ts# REST snapshot hydration on initial load with fallback
│   │   └── useShowdownTimers.ts  # Ready countdowns and auto-advance timers
│   ├── lib/
│   │   ├── cn.ts                 # Class merger utility (`clsx` + `tailwind-merge`)
│   │   ├── game.ts               # Hand ranking evaluations, legal bet clamping, action helpers
│   │   ├── layoutChecks.ts       # Geometry measurement and overlap detection utilities
│   │   ├── payloads.ts           # WebSocket frame payload decoders and type guards
│   │   └── tableGeometry.ts      # Parametric ellipse math, footprint fitting, and scaling tiers
│   ├── security/
│   │   └── logger.ts             # Dev-only console logger (silent in production builds)
│   ├── services/
│   │   ├── api.ts                # REST client (`fetch`), `handleApiError`, and STOMP client factory
│   │   └── transport.ts          # `GameTransport` port with `StompTransportAdapter` and `InMemoryTransportAdapter`
│   └── test/
│       ├── mocks/                # MSW `handlers.ts`/`server.ts` and STOMP mock (`stomp.ts`)
│       ├── fixtures.ts           # Shared domain test fixtures
│       ├── prng.ts               # Seeded PRNG for deterministic tests
│       └── setup.ts              # Vitest global setup
```

## Architecture

### Game Session and Transport Port

Per ADR `0003`, game state lives outside React:

1. **`GameSession` (`src/domain/GameSession.ts`)**: A plain TypeScript store that owns room/game/private state, applies decoded payloads, enforces the action lock, and runs lifecycle timers (showdown fallback, room-closed redirect) through an injected `Clock`. It exposes `subscribe`/`getSnapshot` for `useSyncExternalStore`.
2. **`GameTransport` port (`src/services/transport.ts`)**: `connect`, `disconnect`, `subscribe`, `publish`, `onStatusChange` (plus optional `onError`/`isConnected`). `StompTransportAdapter` wraps `@stomp/stompjs` in production; `InMemoryTransportAdapter` backs tests and the provider default.
3. **React bridge**: `GameProvider` constructs (or accepts an injected) `GameSession` and maps legacy `Action` dispatches onto session methods. Presentational views (`GameTableView`, `GameLobbyView`, `GameReviewView`) receive explicit props from `GameView`.
4. **Testability**: Full game flows and timer transitions can be tested in Node with `TestClock` + `InMemoryTransportAdapter`, without JSDOM. E2E tests intercept sockets with Playwright `page.routeWebSocket()` rather than production backdoors.

### Real-Time Flow

1. **Hydration**: When the game room mounts, `useSessionHydration` fetches initial state snapshots via REST (`/api/rooms/{id}`, `/api/games/{id}`).
2. **Subscriptions**: `useGameWebSocket` connects to the STOMP broker at `/ws` and subscribes to:
   - `/room/{roomId}`: room status, seat assignments, readiness, and game start events.
   - `/game/{gameId}`: public game states (phases, pots, community cards, turn active player).
   - `/user/queue/private`: private player updates (hole cards, private errors).
3. **Actions**: Gameplay actions (`CHECK`, `CALL`, `BET`, `RAISE`, `FOLD`) are dispatched via STOMP frames (`/app/game/{gameId}/action`). Room lifecycle actions (`join`, `start`, `leave`, `claim-win`) execute via authenticated REST endpoints.
4. **Resiliency**: Auto-reconnection handles transient network drops, tab visibility changes, and online events without creating UI freezes or infinite loops.

### Table Layout and Parametric Seating Geometry

The table layout is fully decoupled from browser viewport globals (`window.innerWidth`/`innerHeight`) and hardcoded coordinate lookup tables, governed by `src/lib/tableGeometry.ts` and ADR `0002`:

1. **Container Dimension Sync**: `LiveTableStage` measures its actual rendered dimensions via `useElementSize` (using `ResizeObserver` with border-box measurement). It calculates a responsive table box maintaining a 2.15:1 (standard) or 2.35:1 (wide) aspect ratio and passes it down to `TableSurface`.
2. **Parametric Ellipse Seating**: `useSeatLayout` computes opponent positions analytically along an ellipse arc:
   \[
   x = cx + rx \cdot \cos(\theta), \quad y = cy + ry \cdot \sin(\theta)
   \]
   Seats are evenly distributed across an angular span spanning the top and sides of the table, ordered relative to the local hero offset:
   \[
   k = (i - \text{heroIndex} + \text{total}) \pmod{\text{total}}
   \]
3. **Dynamic Footprint Fitting (`fitSeatEllipse`)**:
   - Calculates worst-case seat footprints (avatar diameter, status badges, showdown card fan) scaled by `scale.overall`.
   - Derives optimal semi-major and semi-minor radii \((rx, ry)\) to ensure every seat remains at least `safeMarginPx(scale.overall)` inside the felt boundary across 3–10 players and supported viewports (down to 667×375 minimum landscape).
4. **Hero Seat Pinning**: `HeroSeat` is statically anchored to `(50%, 86%)` above the action dock, isolated from dynamic opponent angle distribution.
5. **Avatar-Centered Geometry (`PlayerPod`)**: The root bounding box strictly matches the avatar diameter (\(D \times D\)). Bottom-heavy elements (`handRank`, `currentBet`, disconnect timers) are extracted into an absolutely positioned subordinate container (`absolute top-full left-1/2 -translate-x-1/2`) so vertical growth does not displace the avatar center.
6. **Showdown Card Fan & Density**:
   - Hole cards display as an overlapping fan with corner-indices always visible.
   - Scale floor is enforced at `SCALE_FLOOR = 0.30` with `SCALE_CEILING = 1.15`.
   - Constrained top-row clearances fall back gracefully to avatar badge or screen-reader announcements to eliminate collisions with the central pot.
7. **Orientation & Viewport Guards**: `PokerRoomLayout` enforces minimum playable viewport gates:
   - Landscape minimum: 667×375 px.
   - Portrait minimum: 600×800 px (displays `RotatePrompt` on narrow mobile screens < 600px width).
   - Desktop minimum height: 600 px.

### Styling And Theme

- Tailwind CSS v4 is configured through the `@theme` block in `src/index.css`.
- Typography: Space Grotesk for headlines/amounts, Inter for body/labels.
- Palette tokens:
  - Emerald Primary (`#aaead0` / `--color-emerald-primary`): active turns, ready status, confirmations.
  - Gold Secondary (`#fcc025` / `--color-gold-secondary`): chips, pots, bets, payouts.
  - Surface (`#0e0e0e` / `--color-surface`): table surroundings and container backgrounds.

## Development Conventions

- Prefer functional components and custom hooks with clean seams.
- Keep domain types and payload contracts strictly defined in `src/types.ts`.
- Use the `cn` helper for conditional Tailwind class composition.
- Centralize user-facing copy and accessible announcement strings in `src/constants/strings.ts`.
- Normalise backend error handling via `handleApiError` in `api.ts`.
- Respect reduced motion preferences (`useReducedMotion`) across animations.

## Testing Strategy & CI Guardrails

The testing strategy uses a strict two-tier architecture to balance thoroughness with fast CI feedback:

### 1. Fast CI Layer (~1–2 minutes)
- **Unit & Component Tests**: Run via `npx vitest run`. Covers 49 test files (pure geometric math in `tableGeometry.test.ts`, `GameSession` domain flows, hook lifecycle, component rendering, and state dispatchers).
- **Type Checking**: Run via `npx tsc -p tsconfig.app.json --noEmit`. Zero TypeScript errors allowed.
- **Linting**: Run via `npm run lint`. Baseline ceiling enforced (0 errors, 1 warning ceiling).
- **Production Build**: Run via `npm run build`. Builds production assets in < 500ms.
- **Fast E2E Integration**: Run via `npx playwright test` against mocked or live backend. Ignores heavy layout specs via `playwright.config.ts`.

### 2. Layout Overlap & Visual Diagnostics (Optional Utility)
- Kept in `scripts/layout/` as diagnostic measurement and screenshot generation tools (`npm run layout:overlap`, `npm run layout:screenshots`).
- Decoupled from the primary test suite because full visual runs take 10–20+ minutes and do not prevent visual card crowding at 7–10 players without layout algorithmic tuning.

### Testing Conventions
- Test behavior and accessibility, not internal state or CSS classes.
- Prefer semantic queries (`getByRole`, `getByText`, `getByLabelText`).
- Use screen-reader helper spans (`sr-only`) for states verified by automated tests and accessible tools.

## Architecture Decision Records (ADRs)

- [ADR-0001: Adaptive table-first game page](file:///c:/Users/benja/IdeaProjects/frontend-poker/docs/adr/0001-adaptive-table-first-game-page.md): Establishes the live table as the primary experience, landscape-first constraints, and the three-tier responsive model.
- [ADR-0002: Parametric seat ellipse and containment architecture](file:///c:/Users/benja/IdeaProjects/frontend-poker/docs/adr/0002-parametric-seat-ellipse-containment.md): Details the closed-form parametric ellipse model, container dimension sync, dynamic seat footprint fitting (`fitSeatEllipse`), and zero-gating-violation layout invariants.
- [ADR-0003: In-process GameSession store and GameTransport port](file:///c:/Users/benja/IdeaProjects/frontend-poker/docs/adr/0003-in-process-game-session-and-transport-port.md): Moves game state and lifecycle timers into a standalone `GameSession` consumed via `useSyncExternalStore`, decouples real-time I/O behind `GameTransport`, and replaces E2E backdoors with Playwright WebSocket interception.

## Domain Glossary

- **Room**: The multi-user lobby and game session container identified by a 6-character room code.
- **Table / Stage**: The responsive visual arena containing the table felt, seats, community cards, and pots.
- **Hero**: The local player seated at the client instance, statically positioned at bottom-center (50%, 86%).
- **Opponent / Villain**: Other players in the room, positioned dynamically along the parametric ellipse arc.
- **PlayerPod**: The circular seat component representing an individual player, strictly centered on the avatar diameter.
- **Board Cluster**: The central table area comprising the main pot, side pots, and community cards (Flop, Turn, River).
- **Result Dock**: The persistent lower docking panel displaying round outcomes, payouts, and the ready-up action button.
- **Action Panel**: The turn-based player control dock offering Fold, Check, Call, Bet, and Raise controls with slider and quick-bet buttons.
