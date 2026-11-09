# Poker - Real-time Multiplayer Game UI

A polished **React 19 + TypeScript** frontend for real-time multiplayer Texas Hold'em. The app connects to a Spring Boot backend over **REST** and **STOMP/WebSockets**, coordinates live room and table state through an external session store, and renders an adaptive, accessibility-first table experience with **Tailwind CSS v4** and **Motion**.

**Purpose:** Showcase project demonstrating modern React 19 patterns, resilient real-time state synchronization, parametric table geometry, and comprehensive automated testing.

Companion backend showcase: ([Repo](https://github.com/itzbenjamin17/Poker-Backend))

## Table of Contents

- [Quick Start & Development](#quick-start--development)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Design System & Viewport Gates](#design-system--viewport-gates)
- [API Integration](#api-integration)
- [Docker, Nginx & CI/CD](#docker-nginx--cicd)
- [Documentation](#documentation)
- [Portfolio Context](#portfolio-context)

## Quick Start & Development

### Prerequisites

- **Node.js 22+** (Node 22 used in CI; Node 20+ supported in Docker)
- **For Playwright E2E tests:** **JDK 25**, the companion backend repository checked out alongside this project (defaults to `../Poker`, overridable via `BACKEND_DIR`), and Playwright Chromium (`npx playwright install chromium`)

### Local Run

```bash
# Install dependencies from lockfile
npm ci

# Start development server (proxies /api and /ws to http://localhost:8080)
npm run dev

# Open browser
# -> http://localhost:5173
```

### Scripts & Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite dev server with `/api` and `/ws` proxied to port `8080` |
| `npm run build` | Run TypeScript project references check (`tsc -b`) and Vite production build |
| `npm run lint` | Run ESLint flat config (TypeScript, React Hooks, and JSX A11y rules) |
| `npm run preview` | Preview the production build locally |
| `npm run test -- --run` | Run the Vitest unit and integration suite once |
| `npm test` | Run Vitest in interactive watch mode |
| `npm run test:all` | Run Vitest once followed by the full Playwright E2E suite |
| `npm run backend:test` | Launch the sibling `../Poker` backend with the `test` profile via `mvnw.cmd` |
| `npm run layout:overlap` | Run Playwright bounding-box overlap & containment checks across seat counts/viewports |
| `npm run layout:screenshots` | Capture 3–10 player table & showdown screenshots across 8 viewports into `test-results/layout-screenshots/` |
| `npm run layout:all` | Run all layout diagnostic suites using [`playwright.layout.config.ts`](playwright.layout.config.ts) |

Optional build-time environment variables (configured in [`src/services/api.ts`](src/services/api.ts)):
- `VITE_API_BASE_URL` — REST base path (defaults to `/api`)
- `VITE_WS_URL` — Explicit WebSocket URL (defaults to current host `ws`/`wss` at `/ws`)
- `VITE_DEBUG_STOMP=true` — Enable redacted STOMP diagnostic logging in development

## Tech Stack

| Technology | Version | Purpose |
| ---------- | ------- | ------- |
| **React** | `^19.2.6` | UI library (`useSyncExternalStore`, Suspense, lazy views) |
| **TypeScript** | `~5.9.3` | Static type safety |
| **Vite** | `8.3.3` | Build tool and dev server |
| **Tailwind CSS** | `^4.3.0` | Utility-first styling (`@tailwindcss/vite`) |
| **@stomp/stompjs** | `^7.3.0` | STOMP over WebSocket client |
| **Motion** | `^12.38.0` | Declarative UI animations |
| **Lucide React** | `^0.577.0` | Iconography |
| **clsx + tailwind-merge** | `^2.1.1` / `^3.6.0` | Class composition helpers |
| **Vitest + Testing Library + MSW** | `5.0.5` | Unit and integration testing with mocked REST/STOMP |
| **Playwright** | `^1.61.1` | Multi-browser end-to-end and layout verification |

## Project Structure

```text
src/
|-- App.tsx                        # Root auth gate, error boundary, lazy GameView loader
|-- Lobby.tsx                      # Create/join room experience (2-10 players, optional password)
|-- GameView.tsx                   # Container coordinating hydration, sockets, clocks, and views
|-- types.ts                       # Shared domain and wire-contract types
|-- index.css                      # Tailwind v4 @theme tokens, typography, and surface utilities
|-- main.tsx                       # Application entry point
|-- domain/
|   |-- GameSession.ts             # External state store: frames, action locks, recovery, timers
|   |-- clock.ts                   # Production and deterministic test clock abstractions
|   `-- sessionSync.ts             # Revision/generation synchronization helpers
|-- context/
|   |-- GameContext.ts             # Session snapshot and action context contract
|   `-- GameProvider.tsx           # Bridges GameSession to React via useSyncExternalStore
|-- hooks/
|   |-- useAuthSession.ts          # Tab-local sessionStorage auth persistence & expiry handling
|   |-- useSessionHydration.ts     # Initial REST room/game hydration & final-review fallback
|   |-- useGameWebSocket.ts        # STOMP lifecycle, wake/online resync, and retry coordination
|   |-- useGameDispatcher.ts       # Gameplay action, ready/unready, leave, and claim-win dispatch
|   |-- useSeatLayout.ts           # React adapter for parametric table seat layout
|   `-- useElementSize.ts          # ResizeObserver hook for measured table stage sizing
|-- components/
|   |-- PokerRoomLayout.tsx        # Viewport gate, header/stage/dock shell, reconnect overlay
|   |-- RotatePrompt.tsx           # Prompt displayed when viewport falls below minimum gates
|   |-- GameLobbyView.tsx          # Pre-game waiting room and host start controls
|   |-- GameTableView.tsx          # Active poker table view
|   |-- GameReviewView.tsx         # Frozen post-game final standings and recap view
|   |-- LiveTableStage.tsx         # Measured felt stage, elliptical opponent seats, hero seat
|   |-- BoardCluster.tsx           # Central community cards, main/side pots, and phase display
|   |-- ActionPanel.tsx            # Persistent lower betting controls and raise sizing dock
|   |-- ResultDock.tsx             # Inter-hand showdown summary and ready countdown gate
|   |-- GameUI.tsx & UI.tsx        # PlayerPod, CardUI, and reusable Button/Input/Card primitives
|   `-- lobby/                     # CreateRoomForm, JoinRoomForm, validation, and request lock
|-- lib/
|   |-- tableGeometry.ts           # Parametric ellipse seating, footprint fitting, containment guard
|   |-- payloads.ts                # Runtime wire decoders and error message normalization
|   |-- game.ts                    # Hand rank formatting and pot/card presentation helpers
|   |-- layoutChecks.ts            # Bounding-box overlap and containment verification helpers
|   `-- cn.ts                      # Tailwind class merge utility
|-- services/
|   |-- api.ts                     # REST client (timeouts, abort signals, error normalization)
|   |-- transport.ts               # GameTransport port, STOMP adapter, and in-memory test adapter
|   `-- gameEndStorage.ts          # Versioned sessionStorage persistence for post-game review
|-- constants/
|   `-- strings.ts                 # Centralized UI copy and accessible labels
|-- security/
|   `-- logger.ts                  # Redacting, production-gated diagnostic logger
|-- test/                          # Shared Vitest setup, fixtures, PRNG, and MSW/STOMP mocks
`-- __tests__/                     # Cross-component integration suites (plus co-located __tests__)
e2e/                               # Playwright multi-client and mocked WebSocket browser specs
scripts/layout/                    # Playwright layout overlap and screenshot diagnostic specs
```

## Key Features

### Real-time Synchronization & Recovery
- **Hybrid REST + STOMP Lifecycle:** Hydrates room and table state via REST before opening STOMP subscriptions to `/room/{roomId}`, `/game/{roomId}`, and `/user/queue/private`.
- **Automatic Resync & Deduplicated Recovery:** Automatically resynchronizes over REST upon socket reconnection, browser tab wake-up, or `online` events using generation/revision guards so stale responses never overwrite newer live frames.
- **Disconnect & Claim-Win Flows:** Tracks per-player disconnect deadlines, surfaces an accessible reconnect overlay while keeping header actions interactive, and allows the sole remaining connected player to claim victory when opponents time out.

### Adaptive Table-First UI
- **Parametric Elliptical Seating (2–10 Players):** [`tableGeometry.ts`](src/lib/tableGeometry.ts) and [`LiveTableStage.tsx`](src/components/LiveTableStage.tsx) measure the available stage container and place opponents along a continuous ellipse (`TABLE_ASPECT = 2.15`) with density scaling and containment guards, while pinning the hero seat at `(50%, 86%)`.
- **Showdown, Ready Gate & Final Review:** Distinct in-game [`ResultDock`](src/components/ResultDock.tsx) for single-hand showdowns and `ready`/`unready` countdowns, plus a dedicated [`GameReviewView`](src/components/GameReviewView.tsx) that survives page refreshes after server cleanup via versioned `sessionStorage` snapshots.

### Tab-Isolated Authentication
- **Multi-Tab Friendly Storage:** [`useAuthSession.ts`](src/hooks/useAuthSession.ts) stores the room-bound JWT and player context in tab-local `sessionStorage` under `poker-auth` (migrating and clearing legacy `localStorage` once), allowing multiple players or seats to be tested side-by-side in separate browser tabs.
- **Session Validation & Expiry Handling:** Validates JWT structure/expiry locally, verifies active room membership during hydration, and cleanly returns to the lobby on `auth-expired` events or invalidated seats.

## Architecture

### Data Flow

```text
Browser (React 19 + TypeScript)
    |
    +-- App.tsx & useAuthSession.ts
    |     `-- Persists tab-local auth in sessionStorage ('poker-auth')
    |
    +-- Lobby.tsx (useLobbyRequest.ts)
    |     `-- REST: create room / join room (with password & cancellation guards)
    |
    `-- GameProvider.tsx (useSyncExternalStore) <--> GameSession.ts (Domain Store)
          |-- useSessionHydration.ts  --> REST bootstrap (room, public/private state, review)
          |-- useGameWebSocket.ts     --> GameTransport (/room/*, /game/*, /user/queue/private)
          |-- useGameDispatcher.ts    --> STOMP publish (action/ready/unready) & REST commands
          `-- GameView.tsx            --> GameLobbyView | GameTableView | GameReviewView

Spring Boot Backend (default: http://localhost:8080)
    |- REST under /api/*
    `- STOMP over WebSocket at /ws
```

Per [ADR-0002](docs/adr/0002-in-process-game-session-and-transport-port.md), [`GameSession`](src/domain/GameSession.ts) owns state transitions, action locks, and timer orchestration outside React. [`GameProvider`](src/context/GameProvider.tsx) accepts injected `GameSession`, `GameTransport`, and `Clock` instances so unit and integration tests run deterministically without real sockets or timers.

## Security

- **Runtime Boundary Validation:** Incoming REST and STOMP payloads are validated and normalized at runtime in [`payloads.ts`](src/lib/payloads.ts) rather than trusting compile-time TypeScript types alone.
- **Input Validation & Sanitization:** Client-side trimming, length bounds, HTML/control-character rejection, and 72-byte UTF-8 password validation in [`validation.ts`](src/components/lobby/validation.ts).
- **Output Encoding:** `encodeURIComponent` applied to dynamic path segments in REST URLs and STOMP destinations.
- **Redacting Gated Logger:** [`logger.ts`](src/security/logger.ts) strips sensitive fields and silences debug output in production builds.
- **Error Normalization & CSP:** Normalizes backend problem/error responses to prevent raw stack/markup exposure and enforces a Content Security Policy in `index.html`.

## Testing

The test suite follows **User-Centric & Accessibility-First** principles:

- **Test Behavior, Not Implementation:** Assertions target visible user outcomes, chip balances, winner announcements, and accessible states rather than internal component hooks or CSS class names.
- **Query Like a User:** Uses semantic queries (`getByRole`, `getByLabelText`, `getByText`) backed by `sr-only` status cues for active turns, folded seats, and showdown winners.
- **Deterministic Session & Geometry Seams:** Domain and hook tests inject `TestClock` and `InMemoryTransportAdapter`, while table geometry suites verify seat footprints, avatar center anchoring, and viewport containment across table sizes.

### Running Tests

```bash
# Run Vitest unit & integration tests once
npm run test -- --run

# Run Playwright E2E suite (starts Vite + sibling backend on port 8080 with 'e2e' profile)
# Override BACKEND_DIR if the backend is cloned outside ../Poker (e.g., ../Poker-Backend)
npx playwright test

# Run Vitest + Playwright E2E sequentially
npm run test:all

# Run layout overlap & screenshot diagnostics (Vite-only, no backend required)
npm run layout:all
```

## Design System & Viewport Gates

### Color Palette
Theme tokens are defined in [`src/index.css`](src/index.css) using Tailwind CSS v4 `@theme` directives:

| Token | Hex | Usage |
| ---- | --- | ----- |
| **Emerald Primary** | `#aaead0` | Highlights, active turn borders, positive states |
| **Gold Secondary** | `#fcc025` | CTA buttons, chip stacks, and pot accents |
| **Surface** | `#0e0e0e` | Primary dark background |
| **Surface Highest** | `#262626` | Elevated cards, pods, and modal panels |

### Typography
- **Headlines & Numerals:** Space Grotesk (`tabular-nums` for chip stacks, timers, and pots)
- **Body Text:** Inter

### Minimum Viewport Eligibility Gates
[`PokerRoomLayout.tsx`](src/components/PokerRoomLayout.tsx) checks window dimensions and renders [`RotatePrompt.tsx`](src/components/RotatePrompt.tsx) when the viewport is smaller than the supported table-first bounds:
- **Portrait:** minimum `600 × 800`
- **Compact Landscape (`width < 1024px`):** minimum `667 × 320`
- **Desktop (`width >= 1024px`):** minimum `1024 × 600`

## API Integration

### REST Endpoints

Commands (`POST`) return `ApiResponse<T>` (`{ message, data }`), whereas queries (`GET`) return the resource DTO directly:

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `POST` | `/api/room/create` | Create a new poker room (2–10 players, optional password) |
| `POST` | `/api/room/join` | Join an existing room by name |
| `GET` | `/api/room/:roomId` | Fetch room details and player list for hydration |
| `POST` | `/api/room/:roomId/start-game` | Start the game (host only) |
| `POST` | `/api/room/:roomId/leave` | Leave the lobby room |
| `GET` | `/api/game/:gameId/state` | Fetch the current public game snapshot |
| `GET` | `/api/game/:gameId/private-state` | Fetch the authenticated player's hole cards |
| `GET` | `/api/game/:gameId/review` | Fetch the frozen terminal game review snapshot |
| `POST` | `/api/game/:gameId/leave` | Leave an active game |
| `POST` | `/api/game/:gameId/claim-win` | Claim victory when all other remaining players are disconnected |

### WebSocket Channels (STOMP over `/ws`)

- **Subscribe:**
  - `/room/{roomId}` — Lobby membership, host changes, and game-start events
  - `/game/{gameId}` — Public game state snapshots, action notifications, and game-end events
  - `/user/queue/private` — Authenticated player's private hole cards and action errors
- **Publish:**
  - `/app/{gameId}/action` — Send player betting action (`FOLD`, `CHECK`, `CALL`, `RAISE`, `ALL_IN`)
  - `/app/{gameId}/ready` — Mark ready for the next hand
  - `/app/{gameId}/unready` — Cancel ready state during the inter-hand countdown

## Docker, Nginx & CI/CD

- **Container & Reverse Proxy ([`Dockerfile`](Dockerfile) & [`nginx.conf`](nginx.conf)):** Multi-stage build compiling static assets with `node:20-alpine` and serving them via `nginx:alpine` on port `80`. Nginx handles SPA routing (`try_files`), gzip compression, immutable asset caching, and reverse-proxying `/api` and `/ws` to `http://backend:8080` with `3600s` WebSocket read/send timeouts.
- **CI/CD Workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)):** On every push and PR to `main`, GitHub Actions checks out both `Poker-Frontend` and `Poker-Backend`, runs ESLint, Vitest, full Playwright E2E against the live Java 25 backend, and verifies the production build. Pushes to `main` publish multi-arch (`linux/amd64`, `linux/arm64`) images (`suame/poker-frontend:latest` and `:<sha>`).

```bash
# Build and run the frontend container locally
docker build -t poker-frontend .
docker run --rm -p 8080:80 poker-frontend
```

## Documentation

- [AI & Project Context](docs/ai/PROJECT.md) — Canonical architecture, session/transport lifecycle, and table geometry reference.
- [Architecture Decision Records](docs/adr/) — ADRs covering the adaptive table-first game page, in-process `GameSession` & `GameTransport` port, and seat layout invariants.

## Portfolio Context

This repository is a showcase artifact demonstrating:
- Resilient real-time state synchronization in a stateful multiplayer game UI.
- Clean separation between domain session state (`GameSession`) and React presentation (`useSyncExternalStore`).
- Parametric 2D layout engineering (`tableGeometry.ts`) verified by automated bounding-box diagnostics.
- Defensive frontend security and multi-layered testing (Vitest, MSW, and Playwright).

### Future Roadmap
- Add an interactive hand-history timeline to the post-game review screen.
- Introduce optional Web Audio sound effects for card deals, chip actions, and turn alerts.
- Support configurable blind-level progression timers for tournament-style tables.

## License & Attribution

This is a demo / portfolio project. The companion Spring Boot backend lives in the [Poker-Backend repository](https://github.com/itzbenjamin17/Poker-Backend).
