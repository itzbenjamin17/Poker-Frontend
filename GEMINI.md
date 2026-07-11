# GEMINI.md - Frontend Poker Project Context

## Project Overview
This is a polished **React 19 + TypeScript** frontend for a real-time multiplayer poker game ("Vault Poker"). It is built using **Vite 8** and employs **Tailwind CSS v4** for styling and **Motion** (Framer Motion) for UI animations. The application communicates with a Spring Boot backend via **REST** for lifecycle management and **STOMP/WebSockets** for real-time game state synchronization.

### Key Technologies
- **Framework:** React 19 (Functional components, Hooks)
- **Language:** TypeScript (~5.9.3)
- **Build Tool:** Vite 8
- **Styling:** Tailwind CSS v4 (@tailwindcss/vite)
- **Animations:** Motion (^12.38.0)
- **Icons:** Lucide React
- **Real-time:** @stomp/stompjs (Native WebSocket connection)
- **State Management:** Local React state with persistent auth in `localStorage` (`poker-auth`).
- **Testing:** Vitest (Unit/Integration), Playwright (E2E), MSW (API Mocking).

## Building and Running
The following commands are defined in `package.json`:

- `npm install`: Installs project dependencies.
- `npm run dev`: Starts the Vite development server with Hot Module Replacement (HMR).
- `npm run build`: Executes TypeScript type-checking (`tsc -b`) followed by the Vite production build.
- `npm run lint`: Runs ESLint for code quality checks.
- `npm run preview`: Locally previews the production build.
- `npm run test`: Runs the Vitest test suite.
- `npm run backend:test`: Starts the Spring Boot backend using the test profile.
- `npm run test:all`: Runs both Vitest and Playwright E2E tests.

### Backend Dependency
The frontend is configured to proxy `/api` and `/ws` requests to `http://localhost:8080`. A compatible Spring Boot backend must be running at this address for the application to function fully.

## Project Structure & Architecture
- `src/main.tsx`: Application entry point.
- `src/App.tsx`: Root component managing authentication state and session persistence.
- `src/Lobby.tsx`: View for creating or joining poker rooms.
- `src/GameView.tsx`: The primary game container. It handles REST-based hydration and WebSocket subscriptions for both room and active game states.
- `src/types.ts`: Centralized TypeScript interfaces for domain models (Player, GameState, RoomUpdate, etc.) and a `cn` utility for Tailwind class merging.
- `src/services/api.ts`: Service layer containing the `pokerApi` REST client and `createStompClient` factory.
- `src/components/UI.tsx`: Atomic, reusable UI primitives (Button, Input, Card).
- `src/components/GameUI.tsx`: Specialized poker UI components (CardUI, PlayerPod).
- `src/index.css`: Tailwind v4 theme configuration, custom tokens (Emerald, Gold, Surface), and font declarations (Space Grotesk for headlines, Inter for body).

## Technical Implementation Details

### Real-time Flow
1. **Hydration:** Fetch initial state via REST snapshots on mount (e.g., `getRoomInfo`, `getGameState`).
2. **Subscription:** Subscribe to STOMP topics for live updates:
   - `/room/{roomId}`: Lobby updates.
   - `/game/{gameId}`: Public game state.
   - `/user/queue/private`: Private hole cards and error feedback.
3. **Actions:** 
   - Game actions (Fold, Call, Raise) are published over STOMP to `/app/{gameId}/action`.
   - Lifecycle events (Join, Start, Leave, Claim Win) use REST POST requests.

### Authentication & Persistence
- Auth data is stored in `localStorage` under the key `poker-auth`.
- On application load, `App.tsx` attempts to restore the session from storage.
- If a session is valid, the user is directed to `GameView`; otherwise, they start at the `Lobby`.

### Styling & Theme
- **Tailwind v4:** Uses the new `@theme` block in CSS for tokens.
- **Fonts:** "Space Grotesk" for headlines, "Inter" for body text.
- **Custom Tokens:**
  - `emerald-primary`: `#aaead0`
  - `gold-secondary`: `#fcc025`
  - `surface`: `#0e0e0e`

## Development Conventions
- **Functional Components:** Use functional components with hooks for all UI logic.
- **Type Safety:** Ensure all API responses and component props are strictly typed using `src/types.ts`.
- **Styling:** Adhere to the established Tailwind v4 design system. Use the `cn` utility for conditional class joining.
- **Error Handling:** Use the `getErrorMessage` helper in `api.ts` to parse meaningful errors from backend responses.
- **Vite Proxy:** Configuration is localized in `vite.config.ts`. Changes to backend targets should be made there.
- **Testing Conventions:**
    - **Test Behavior, Not Implementation:** Avoid asserting on internal hook states (`useState`) or visual class stylings (`toHaveClass`). Focus strictly on what the user sees, experiences, or can interact with (e.g., text, buttons, alerts).
    - **Query Like a User:** Prioritize semantic, screen-reader friendly queries (`screen.getByRole`, `screen.getByText`, `screen.getByLabelText`) over non-accessible identifiers (like `data-testid` or `querySelector` class lookups).
    - **Accessibility-First Indicators:** For visual-only elements (e.g., active borders, folded states, winner animations), output hidden screen-reader labels (`sr-only`) containing the state description so that both screen readers and test queries can interact with the state semantically.
    - **Clean Execution:** Ensure Vitest integration and Playwright E2E tests execute without any unhandled exceptions, unmocked REST endpoints, or React asynchronous update warnings (`act(...)`). Wait for hydration landmarks (e.g. "Total Pot") before firing STOMP messages.
