# 🎮 Frontend Poker - Real-time Multiplayer Game UI

A beautifully crafted **React + TypeScript** frontend for a real-time multiplayer poker game. Features live-updating game state, HTTP-driven player actions, and a sleek dark-mode design system built with **Tailwind CSS 4** and **Motion animations**.

**Purpose:** Showcase project demonstrating modern React patterns, real-time communication, and polished UI design.

## 📋 Table of Contents

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

## 🚀 Demo Preview

### Local Run (optional)

```bash
# Install dependencies (only needed if you want to run the demo)
npm install

# Start development server
npm run dev

# Open browser
# → http://localhost:5173
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

## 🛠️ Tech Stack

| Technology         | Version  | Purpose                  |
| ------------------ | -------- | ------------------------ |
| **React**          | 19.2.4   | UI framework             |
| **TypeScript**     | ~5.9.3   | Type safety              |
| **Vite**           | 8.0.1    | Build tool with HMR      |
| **Tailwind CSS**   | 4.2.2    | Utility-first styling    |
| **@stomp/stompjs** | ^7.3.0   | WebSocket STOMP protocol |
| **SockJS**         | ^1.6.1   | WebSocket fallback       |
| **Motion**         | ^12.38.0 | Smooth animations        |
| **Lucide React**   | ^0.577.0 | Icon library             |

## 📁 Project Structure

```
src/
├── App.tsx                    # Root component, authentication state
├── Lobby.tsx                  # Room creation & joining interface
├── GameView.tsx               # Main game board & real-time updates
├── types.ts                   # Core TypeScript interfaces
├── index.css                  # Design system & Tailwind config
├── main.tsx                   # Entry point
├── components/
│   ├── UI.tsx                 # Reusable design system (Button, Card, Input)
│   └── GameUI.tsx             # Poker-specific components (CardUI, PlayerPod)
└── services/
    └── api.ts                 # Backend API client & WebSocket setup
```

> 💡 **Component Organization**: Single-use component props types are kept local to the component file (not in central types file) for better encapsulation and less cross-dependency friction.

## ✨ Key Features

### Real-time Updates

**WebSocket Integration via STOMP**

- Live player state updates every action
- Automated game phase progression with visual feedback
- Real-time chip, hand, and betting information
- Private player data (hole cards) via secure channels

### User Experience

**Smooth Animations & Transitions**

- Motion-driven UI for cards, chips, and player pods
- Glass-morphism design cards with backdrop blur
- Dot-grid background pattern
- Responsive player positioning around the table

### Authentication

**Token-based Session Management**

- LocalStorage-persisted auth state
- JWT Bearer token on authenticated API requests
- Auto-login on page refresh (if session valid)
- Room and player context maintained across navigation

### Real-time Actions

**Instant Player Interactions**

- Fold, Check, Call, Bet, Raise, All-in buttons
- Real-time action validation from backend
- Automatic turn indication for current player
- Showdown hand evaluation & winners announcement

## 🏗️ Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + TypeScript)                       │
│                                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ App.tsx (Root State Management)              │  │
│  └──────────────┬───────────────────────────────┘  │
│                 │                                    │
│    ┌────────────┴────────────┐                      │
│    ▼                         ▼                      │
│  Lobby.tsx            GameView.tsx                │
│  (REST)               (WebSocket)                  │
│    │                     │                          │
│    │              ┌──────┴──────┐                  │
│    │              ▼             ▼                   │
│    │        UI Components  Service Layer            │
│    │        (UI.tsx)        (api.ts)               │
│    │              │             │                   │
│    └──────────────┴─────────────┘                  │
│                 │                                    │
├─────────────────┼─────────────────────────────────┤
│                 │ HTTP/WebSocket                    │
│                 ▼                                    │
│      Spring Boot Backend (8080)                   │
│      ├── REST: /api/room/*                        │
│      ├── REST: /api/game/*                        │
│      └── WebSocket: /ws (STOMP)                   │
└─────────────────────────────────────────────────────┘
```

### State Management

The app uses React hooks for state management (no Redux/Context needed for this scale):

```typescript
// App.tsx - Session management
const [auth, setAuth] = useState<AuthResponse | null>(null);

// GameView.tsx - Game state
const [gameState, setGameState] = useState<GameState | null>(null);
const [players, setPlayers] = useState<Player[]>([]);

// LocalStorage persistence
useEffect(() => {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}, [auth]);
```

**Benefits:**

- Simple one-way data flow (unidirectional)
- No boilerplate or reducer complexity
- Easy to debug with React DevTools
- Scales well for mid-size apps

## 🔌 API Integration

### REST Endpoints (HTTP)

All endpoints are called through the frontend proxy (Vite) and resolve to backend `/api/*` routes on `http://localhost:8080`:

| Method | Endpoint                   | Purpose               |
| ------ | -------------------------- | --------------------- |
| `POST` | `/api/room/create`         | Create new poker room |
| `POST` | `/api/room/join`           | Join existing room    |
| `GET`  | `/api/room/:roomId`        | Fetch room details    |
| `POST` | `/api/room/:roomId/leave`  | Leave room            |
| `POST` | `/api/room/:roomId/start-game` | Start game       |
| `POST` | `/api/game/:gameId/leave`  | Leave active game     |
| `POST` | `/api/game/:gameId/action` | Submit player action  |

### WebSocket Channels (STOMP)

**Endpoint:** `/ws` (proxied to `http://localhost:8080/ws`)

**Subscribe Channels:**

- `/room/{roomId}` - Lobby updates (players joining/leaving)
- `/game/{gameId}` - Public game state (community cards, pot, phase)
- `/game/{gameId}/player-name/{encodedPlayerName}/private` - Private player data (hole cards)

**Action Transport:**

- Player actions are currently sent via HTTP `POST /api/game/{gameId}/action`.
- The backend still exposes STOMP action mapping at `/app/{gameId}/action`.

### WebSocket Connection Example

```typescript
// From api.ts
const client = new Client({
  webSocketFactory: () => new SockJS('/ws'),
  connectHeaders: {
    Authorization: `Bearer ${token}`,
  },
  reconnectDelay: 5000,
  onConnect: () => {
    client.subscribe(`/game/${roomId}`, (msg) => {
      const gameState = JSON.parse(msg.body);
      setGameState(gameState);
    });
  },
});

// Connect
client.activate();

// Actions are currently sent over REST
await fetch(`/api/game/${gameId}/action`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ action: 'RAISE', amount: 100 }),
});
```

## 🚀 Development

### Build & Bundle

```bash
# Development with HMR (Hot Module Replacement)
npm run dev

# Type check
tsc -b

# Production build
npm run build      # → dist/

# Preview production build
npm run preview

# Linting
npm run lint
```

### Vite Configuration Highlights

The `vite.config.ts` includes:

- **React Plugin** with Oxc transpilation for fast builds
- **Tailwind CSS Integration** via @tailwindcss/vite
- **API Proxy** to localhost:8080 for development
- **WebSocket Proxy** with upgraded connection
- **ngrok Support** (see Demo Environment Notes section below)

## 🌍 Demo Environment Notes

### Local Demo Setup

**If you want to run this locally:**

- Backend running: `http://localhost:8080`
- WebSocket endpoint: `http://localhost:8080/ws`

```bash
npm install && npm run dev
# Frontend: http://localhost:5173
```

### Remote Demo with ngrok

**Using ngrok to test this over a network:**

```bash
# 1. Install ngrok (https://ngrok.com)
ngrok http 5173

# 2. Update frontend Vite config
# vite.config.ts already includes:
# allowedHosts: ['.ngrok-free.app']

# 3. Backend also needs ngrok tunnel
cd ../Poker
ngrok http 8080

# 4. Update frontend API proxy
# Point /api and /ws to your backend ngrok outlet
```

**Vite Config already supports ngrok tunnels:**

```typescript
server: {
  allowedHosts: ['.ngrok-free.app'],
  proxy: {
    '/api': 'http://localhost:8080',
    '/ws': { target: 'http://localhost:8080', ws: true }
  }
}
```

> 📝 For ngrok demos, you'll need to update the proxy targets to point to your backend's ngrok URL instead of localhost.

## 🎨 Design System

### Color Palette

All colors defined in `src/index.css` as CSS theme variables:

| Name                  | Hex       | Usage                           |
| --------------------- | --------- | ------------------------------- |
| **Emerald Primary**   | `#aaead0` | Buttons, active states, borders |
| **Emerald Dim**       | `#9ddcc2` | Hover states                    |
| **Emerald Container** | `#6fad95` | Poker table gradient            |
| **Gold Secondary**    | `#fcc025` | Accents, chip icons             |
| **Surface**           | `#0e0e0e` | Main background                 |
| **Surface High**      | `#262626` | Cards, elevated surfaces        |

### Typography

#### Headlines

**Font:** Space Grotesk (300–700 weights)

- Bold, geometric sans-serif
- Used for titles, section headings
- Modern, premium feel

```css
font-family: "Space Grotesk", sans-serif;
font-weight: 600; /* Example: section headers */
```

#### Body Text

**Font:** Inter (300–700 weights)

- Clean, readable sans-serif
- Used for body text, labels
- Excellent readability at all sizes

```css
font-family: "Inter", sans-serif;
font-weight: 400; /* Example: paragraph text */
```

### Reusable Components

**UI.tsx** - Design system components:

- `Button` - Primary, secondary, outline variants
- `Card` - Glass-morphism effect with backdrop blur
- `Input` - Form fields with validation

**GameUI.tsx** - Poker-specific components:

- `CardUI` - Rendered playing cards (hearts, diamonds, clubs, spades)
- `PlayerPod` - Player position, chip count, action indicator

## 📝 Environment Variables

No environment file required by default. All configuration is in `vite.config.ts`.

For custom backend URLs, you can update `vite.config.ts`:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': process.env.VITE_API_BASE || 'http://localhost:8080',
    '/ws': {
      target: process.env.VITE_WS_BASE || 'http://localhost:8080',
      ws: true
    }
  }
}
```

## 🗺️ Roadmap & Known Limitations

### Current Status: Work in Progress ⚠️

This is a **portfolio/demo project** under active development. Features are being refined and architecture may evolve.


## 📌 Portfolio Context

This repository is primarily a showcase artifact rather than a community-maintained package.

Areas to improve:

- **Performance**: Optimize WebSocket message frequency
- **UX**: Better error messages and loading states
- **Tests**: Add unit and integration tests
- **Accessibility**: Improve keyboard navigation and screen reader support
- **Design**: Enhance animations and visual polish

## 📜 License & Attribution

This is a demo/portfolio project. See the backend repository for licensing details.

---

**Related backend implementation:** Check the backend README for architecture details and full API specifications [here](https://github.com/itzbenjamin17/Poker-Frontend).
