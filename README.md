# Poker - Real-time Multiplayer Game UI

A polished **React 19 + TypeScript** frontend for a real-time multiplayer poker game. The app connects to a Spring Boot backend over **REST** and **STOMP/SockJS**, renders live room and table state, and uses **Tailwind CSS v4** plus **Motion** for the presentation layer.

**Purpose:** Showcase project demonstrating modern React patterns, real-time communication, and a branded multiplayer game UI.

## Table of Contents

- [Demo Preview](#demo-preview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Development](#development)
- [Design System](#design-system)
- [API Integration](#api-integration)
- [Portfolio Context](#portfolio-context)

## Demo Preview

### Local Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser
# -> http://localhost:5173
```

## Tech Stack

| Technology | Version | Purpose |
| ---------- | ------- | ------- |
| **React** | `^19.2.6` | UI framework |
| **TypeScript** | `~5.9.3` | Type safety |
| **Vite** | `^8.0.12` | Build tool and dev server |
| **Tailwind CSS** | `^4.3.0` | Utility-first styling |
| **@tailwindcss/vite** | `^4.3.0` | Tailwind Vite integration |
| **@stomp/stompjs** | `^7.3.0` | STOMP client |
| **sockjs-client** | `^1.6.1` | WebSocket fallback transport |
| **Motion** | `^12.38.0` | UI animation |
| **Lucide React** | `^0.577.0` | Icons |
| **clsx + tailwind-merge** | `^2.1.1` / `^3.6.0` | Class composition helpers |

## Project Structure

```text
src/
|-- App.tsx                    # Root auth/session state
|-- Lobby.tsx                  # Create/join room experience
|-- GameView.tsx               # Lobby view, table view, live game state
|-- types.ts                   # Shared domain types + cn helper
|-- index.css                  # Theme tokens, fonts, base styles
|-- main.tsx                   # Application entry point
|-- components/
|   |-- UI.tsx                 # Reusable Button, Input, Card primitives
|   `-- GameUI.tsx             # CardUI and PlayerPod
|-- services/
|   `-- api.ts                 # REST client and STOMP client factory
|-- __tests__/                 # Integration and unit tests
`-- security/
    `-- logger.ts              # Production-gated logging utility
```

## Key Features

### Real-time Updates
**Live lobby and table synchronization**
- Room updates over `/room/{roomId}`
- Game snapshots and notifications over `/game/{gameId}`
- Private hole-card and action-error messages over `/game/{gameId}/player-name/{encodedPlayerName}/private`
- Session hydration on load using REST snapshots before live subscriptions take over

### User Experience
**Branded multiplayer table UI**
- "Vault Poker" lobby and table presentation
- Motion-driven card reveals, overlays, notifications, and transitions
- Responsive seat positioning with layouts for common table sizes
- Reconnect countdowns, showdown results, side-pot display, and current-turn indicators

### Authentication
**Token-backed session persistence**
- JWT bearer token stored in local storage under `poker-auth`
- Room and player context restored on refresh
- Session validation against the backend before re-entering a room or game
- Graceful redirect back to the lobby if the seat or room is no longer valid

## Architecture

### Data Flow
```text
Browser (React + TypeScript)
    |
    +-- App.tsx
    |     `-- Persists auth/session in localStorage
    |
    +-- Lobby.tsx
    |     `-- REST: create room / join room
    |
    `-- GameView.tsx
          +-- REST bootstrap (hydration)
          +-- STOMP subscriptions (live updates)
          `-- STOMP publish (game actions)

Spring Boot backend (default: http://localhost:8080)
    |- REST under /api/*
    `- WebSocket endpoint at /ws
```

## Security

The application incorporates several security best practices:
- **Input Sanitization:** Client-side trimming and validation of room and player names.
- **Output Encoding:** URL-encoding of dynamic path segments in REST and WebSocket destinations.
- **Gated Logging:** Centralized `logger.ts` that strips debug information in production environments.
- **Error Normalization:** Normalizing backend errors to prevent technical detail exposure.
- **Content Security Policy (CSP):** Implemented in `index.html` to mitigate XSS risks.

## Testing

The project includes a comprehensive, multi-layered testing suite engineered under strict **User-Centric & Accessibility-First** testing principles:

- **Test Behavior, Not Implementation:** We do not assert on internal state variables, hooks, or fragile styling layouts (e.g., CSS classes). Tests focus strictly on what the user sees, experiences, or can interact with on the screen.
- **Query Like a User:** All tests utilize semantic, screen-reader friendly queries (`screen.getByRole`, `screen.getByText`, `screen.getByLabelText`) rather than non-semantic IDs (like `data-testid`) or DOM class selectors. If a user using assistive technology cannot access it, our tests will fail.
- **Accessibility-First State Indicators:** Visual states (such as active turn highlights, folded states, and winners) are represented using hidden screen-reader labels (`sr-only`) so that they are fully accessible to screen readers and directly verifiable by semantic testing queries.

### Integration & Unit Tests (Vitest)
Uses **Vitest** and **React Testing Library** for component, hook, and service layer validation.
- **Mocking:** Employs **MSW (Mock Service Worker)** to mock REST API requests and a custom STOMP mock for real-time message simulation.
- **Asynchronous Hydration Safety:** Avoids raw async updates warnings (`act(...)`) by semantically waiting for DOM elements (e.g. `Total Pot` labels) before simulating STOMP frames.
- **Run:** `npm test`

### End-to-End Tests (Playwright)
Uses **Playwright** for full multi-browser end-to-end user flows.
- **Coverage:** Lobby creation, player joins, full heads-up betting rounds, showdown outcomes, all-in side pots, and connection resilience.
- **Run:** `npx playwright test`

### Running All Tests
To run all tests sequentially (unit, integration, and E2E):
```bash
npm run test::all
```

## Design System

### Color Palette
Theme colors are defined in `src/index.css` using Tailwind CSS v4 `@theme` tokens.

| Name | Hex | Usage |
| ---- | --- | ----- |
| **Emerald Primary** | `#aaead0` | Highlights, borders, active states |
| **Gold Secondary** | `#fcc025` | CTA and chip accents |
| **Surface** | `#0e0e0e` | Main background |
| **Surface Highest** | `#262626` | Cards and panels |

### Typography
- **Headlines:** Space Grotesk (geometric, premium tone)
- **Body Text:** Inter (readability and clarity)

## API Integration

### REST Endpoints
| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `POST` | `/api/room/create` | Create a new poker room |
| `POST` | `/api/room/join` | Join an existing room |
| `GET` | `/api/room/:roomId` | Fetch room details for hydration |
| `POST` | `/api/room/:roomId/start-game` | Start a game as host |
| `GET` | `/api/game/:gameId/state` | Fetch the current public game snapshot |
| `GET` | `/api/game/:gameId/private-state` | Fetch the current private player snapshot |

### WebSocket Channels (STOMP)
- `/room/{roomId}` - Lobby updates (joins, leaves, starts)
- `/game/{gameId}` - Public game state and server notifications
- `/game/{gameId}/player-name/{playerName}/private` - Private cards and action feedback

## Portfolio Context

This repository is a showcase artifact demonstrating:
- Real-time synchronization in a stateful multiplayer environment.
- Modern React 19 patterns and Tailwind CSS v4 integration.
- Defensive frontend security and comprehensive automated testing.

### Roadmap
- Move backend target configuration to environment variables.
- Surface optional backend features like room passwords.
- Improve accessibility (A11y) and keyboard navigation.
- Continue refining error handling and reconnect UX.

## License & Attribution

This is a demo / portfolio project. Related backend implementation can be found in the companion repository.
