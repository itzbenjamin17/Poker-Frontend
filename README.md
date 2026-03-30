# Frontend Poker - Real-time Multiplayer Game UI

A polished **React + TypeScript** frontend for a real-time multiplayer poker game. The app connects to a Spring Boot backend over **REST** and **STOMP/SockJS**, renders live room and table state, and uses **Tailwind CSS v4** plus **Motion** for the presentation layer.

**Purpose:** Showcase project demonstrating modern React patterns, real-time communication, and a branded multiplayer game UI.

## Table of Contents

- [Demo Preview](#demo-preview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Development](#development)
- [Demo Environment Notes](#demo-environment-notes)
- [Design System](#design-system)
- [API Integration](#api-integration)
- [Roadmap](#roadmap)

## Demo Preview

### Local Run (current workflow)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser
# -> http://localhost:5173
```

### Alternative package managers

```bash
pnpm install
pnpm run dev
```

### Using yarn

```bash
yarn install
yarn dev
```

## Tech Stack

| Technology | Version | Purpose |
| ---------- | ------- | ------- |
| **React** | `^19.2.4` | UI framework |
| **TypeScript** | `~5.9.3` | Type safety |
| **Vite** | `^8.0.1` | Build tool and dev server |
| **Tailwind CSS** | `^4.2.2` | Utility-first styling |
| **@tailwindcss/vite** | `^4.2.2` | Tailwind Vite integration |
| **@stomp/stompjs** | `^7.3.0` | STOMP client |
| **sockjs-client** | `^1.6.1` | WebSocket fallback transport |
| **Motion** | `^12.38.0` | UI animation |
| **Lucide React** | `^0.577.0` | Icons |
| **clsx + tailwind-merge** | `^2.1.1` / `^3.5.0` | Class composition helpers |

## Project Structure

```text
src/
|-- App.tsx                    # Root auth/session state
|-- Lobby.tsx                  # Create/join room experience
|-- GameView.tsx               # Lobby view, table view, live game state
|-- types.ts                   # Shared domain types + cn helper
|-- index.css                  # Theme tokens, fonts, base styles
|-- main.tsx                   # Application entry point
|-- assets/
|   |-- hero.png
|   |-- react.svg
|   `-- vite.svg
|-- components/
|   |-- UI.tsx                 # Reusable Button, Input, Card primitives
|   `-- GameUI.tsx             # CardUI and PlayerPod
`-- services/
    `-- api.ts                 # REST client and STOMP client factory
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
- Responsive seat positioning with layouts for common table sizes plus a fallback layout
- Reconnect countdowns, showdown results, side-pot display, and current-turn indicators

### Authentication

**Token-backed session persistence**

- JWT bearer token stored in local storage under `poker-auth`
- Room and player context restored on refresh
- Session validation against the backend before re-entering a room or game
- Graceful redirect back to the lobby if the seat or room is no longer valid

### Real-time Actions

**Player and host interactions**

- Fold, Check, Call, Bet, Raise, and All In actions
- Host-only start-game control from the lobby view
- Leave room / leave game flows
- Claim-win flow when the backend exposes it for the active player

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
          +-- REST bootstrap:
          |     - GET /api/room/{roomId}
          |     - GET /api/game/{gameId}/state
          |     - GET /api/game/{gameId}/private-state
          |
          +-- STOMP subscriptions:
          |     - /room/{roomId}
          |     - /game/{gameId}
          |     - /game/{gameId}/player-name/{encodedPlayerName}/private
          |
          `-- STOMP publish:
                - /app/{gameId}/action

Spring Boot backend (default local target: http://localhost:8080)
    |- REST under /api/*
    `- WebSocket endpoint at /ws
```

### State Management

The app still uses React hooks instead of Redux or a larger global state layer, but the live-state flow is a little richer now:

```ts
// App.tsx
const [auth, setAuth] = useState<AuthResponse | null>(() => readStoredAuth());

// GameView.tsx
const [roomState, setRoomState] = useState<RoomUpdate['data'] | null>(...);
const [gameState, setGameState] = useState<GameState | null>(null);
const [privateState, setPrivateState] = useState<{ holeCards: string[] } | null>(null);
```

**Benefits:**

- Auth/session stays simple at the app root
- Room, public game, and private player state are separated cleanly
- REST snapshots plus WebSocket subscriptions make reconnect and refresh flows more resilient
- The current app size still does not require Redux or a custom store

## API Integration

### REST Endpoints (HTTP)

All frontend requests go through the Vite proxy and resolve to backend `/api/*` routes on `http://localhost:8080` during local development.

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `POST` | `/api/room/create` | Create a new poker room |
| `POST` | `/api/room/join` | Join an existing room |
| `GET` | `/api/room/:roomId` | Fetch room details for hydration |
| `POST` | `/api/room/:roomId/leave` | Leave a lobby |
| `POST` | `/api/room/:roomId/start-game` | Start a game as host |
| `GET` | `/api/game/:gameId/state` | Fetch the current public game snapshot |
| `GET` | `/api/game/:gameId/private-state` | Fetch the current private player snapshot |
| `POST` | `/api/game/:gameId/leave` | Leave an active game |
| `POST` | `/api/game/:gameId/claim-win` | Claim a win when exposed by backend rules |

### WebSocket Channels (STOMP)

**Endpoint:** `/ws` (proxied to `http://localhost:8080/ws` in development)

**Subscribe channels:**

- `/room/{roomId}` - lobby updates such as room creation, joins, leaves, and room close events
- `/game/{gameId}` - full public game state plus server notifications such as auto-advance and game end
- `/game/{gameId}/player-name/{encodedPlayerName}/private` - private hole cards and action error feedback

### Action Transport

- Betting actions are currently published over STOMP to `/app/{gameId}/action`.
- Room lifecycle actions such as create, join, start, leave, and claim-win remain HTTP calls.
- On connect, the client also refreshes room/game/private snapshots so missed events can be recovered cleanly.

### WebSocket Connection Example

```ts
// From api.ts
const client = createStompClient(token);

client.onConnect = () => {
  client.subscribe(`/game/${gameId}`, (msg) => {
    const gameState = JSON.parse(msg.body);
    setGameState(gameState);
  });
};

client.activate();

// Actions are published over STOMP
client.publish({
  destination: `/app/${gameId}/action`,
  body: JSON.stringify({ action: 'RAISE', amount: 100 }),
});
```

## Development

### Build & Bundle

```bash
# Development with HMR
npm run dev

# Type-check + production build
npm run build

# Preview production build
npm run preview

# Linting
npm run lint

# Type-check only (manual)
npx tsc -b
```

### Vite Configuration Highlights

The `vite.config.ts` currently includes:

- `@vitejs/plugin-react`
- `@tailwindcss/vite` for Tailwind CSS v4
- `define.global = 'globalThis'`
- Proxying for `/api` and `/ws` to `http://localhost:8080`
- `allowedHosts` support for `.ngrok-free.app`

## Demo Environment Notes

### Local Demo Setup

**Current local assumptions:**

- Backend running at `http://localhost:8080`
- WebSocket endpoint available at `http://localhost:8080/ws`

```bash
npm install
npm run dev
# Frontend: http://localhost:5173
```

### Remote Demo with ngrok

**To test over a network:**

```bash
# Frontend
ngrok http 5173

# Backend
ngrok http 8080
```

The frontend already allows `.ngrok-free.app` hosts, but the proxy targets in `vite.config.ts` are still hard-coded to localhost. For a remote demo, update the `/api` and `/ws` proxy targets to point at your backend ngrok URL.

**Current Vite server config:**

```ts
server: {
  allowedHosts: ['.ngrok-free.app'],
  proxy: {
    '/api': 'http://localhost:8080',
    '/ws': { target: 'http://localhost:8080', ws: true }
  }
}
```

> Requests also send the `ngrok-skip-browser-warning` header from the service layer to reduce ngrok banner friction during demos.

## Design System

### Color Palette

Theme colors are defined in `src/index.css` using Tailwind CSS v4 `@theme` tokens.

| Name | Hex | Usage |
| ---- | --- | ----- |
| **Emerald Primary** | `#aaead0` | Highlights, borders, active states |
| **Emerald Dim** | `#9ddcc2` | Supporting emerald accents |
| **Emerald Container** | `#6fad95` | Table gradient core |
| **Gold Secondary** | `#fcc025` | CTA and chip accents |
| **Gold Dim** | `#edb210` | Secondary gold borders and accents |
| **Surface** | `#0e0e0e` | Main background |
| **Surface High** | `#20201f` | Elevated surfaces |
| **Surface Highest** | `#262626` | Cards, panels, and dense UI blocks |

### Typography

#### Headlines

**Font:** Space Grotesk

- Used for titles, action labels, and high-emphasis UI
- Supports the premium, geometric tone of the interface

```css
font-family: "Space Grotesk", sans-serif;
```

#### Body Text

**Font:** Inter

- Used for supporting text and general readability
- Paired with Space Grotesk for a sharper display/body split

```css
font-family: "Inter", sans-serif;
```

### Reusable Components

**UI.tsx** contains shared primitives:

- `Button` - `primary`, `secondary`, `outline`, and `ghost` variants
- `Input` - labeled input with optional error state
- `Card` - glass-panel wrapper used across lobby and room layouts

**GameUI.tsx** contains poker-specific UI:

- `CardUI` - visible and hidden card rendering
- `PlayerPod` - player badge, chip count, blind indicator, and reconnect state

## Environment Variables

No environment variables are wired into the app right now. Runtime configuration is currently hard-coded in `vite.config.ts`.

```ts
server: {
  proxy: {
    '/api': 'http://localhost:8080',
    '/ws': { target: 'http://localhost:8080', ws: true }
  }
}
```

If you want environment-based backend URLs, that would need to be added as a follow-up change.

## Roadmap

### Current Status: Work in Progress

This remains a showcase / portfolio project under active development.

## Portfolio Context

This repository is primarily a showcase artifact rather than a community-maintained package.

Areas to improve:

- Add automated tests for the service layer and critical UI states
- Move backend target configuration out of `vite.config.ts` and into env-based configuration
- Surface optional backend features such as room passwords in the current UI
- Improve accessibility, keyboard navigation, and screen-reader behavior
- Continue refining error handling and reconnect-state UX

## License & Attribution

This is a demo / portfolio project.

Related backend implementation: this frontend expects a compatible Spring Boot poker backend exposing `/api/*` and `/ws`. Refer to the backend repository README for server-side architecture and deployment details.
