# Frontend Poker Project Context

This is the canonical AI and project context for the repository. Root-level files such as `AGENTS.md` and `GEMINI.md` should stay thin wrappers that point here.

## Project Overview

This repository is a polished React 19 + TypeScript frontend for a real-time multiplayer poker game. It is built with Vite 8, styled with Tailwind CSS v4, and uses Motion for animation. The app talks to a Spring Boot backend over REST for room and game lifecycle actions and over STOMP/WebSockets for live table state.

## Tech Stack

- React 19 with functional components and hooks
- TypeScript 5.x
- Vite 8
- Tailwind CSS v4 with `@tailwindcss/vite`
- Motion for UI animation
- Lucide React for icons
- `@stomp/stompjs` for realtime transport
- Vitest, React Testing Library, MSW, and Playwright for testing

## Build And Run

Defined scripts from `package.json`:

- `npm install`: install dependencies
- `npm run dev`: start the Vite dev server
- `npm run build`: run TypeScript build checks and the production build
- `npm run lint`: run ESLint
- `npm run preview`: preview the production build locally
- `npm run test`: run the Vitest suite
- `npm run backend:test`: start the companion Spring Boot backend with the test profile
- `npm run test:all`: run Vitest followed by Playwright E2E tests

The frontend expects a compatible backend at `http://localhost:8080` and proxies `/api` and `/ws` traffic there during development.

## Project Structure

- `src/main.tsx`: application entry point
- `src/App.tsx`: root auth and session restoration
- `src/Lobby.tsx`: room creation and join flows
- `src/GameView.tsx`: room and game container, including hydration and live subscriptions
- `src/types.ts`: shared domain types and the `cn` helper
- `src/services/api.ts`: REST client and STOMP client factory
- `src/components/UI.tsx`: reusable UI primitives
- `src/components/GameUI.tsx`: poker-specific UI building blocks
- `src/index.css`: theme tokens, typography, and global styles

## Architecture

### Real-Time Flow

1. Hydrate the initial view from REST snapshots when the app or room loads.
2. Subscribe to STOMP channels for live room, table, and private-player updates.
3. Publish gameplay actions through STOMP while using REST for lifecycle actions such as join, start, leave, and claim win.

The main channels are `/room/{roomId}`, `/game/{gameId}`, and `/user/queue/private`.

### Authentication And Persistence

- Session data is stored in `localStorage` under `poker-auth`.
- `App.tsx` restores the session on startup.
- If the session is valid, the user enters the game flow; otherwise they start in the lobby.

### Styling And Theme

- Tailwind CSS v4 is configured through the `@theme` block in `src/index.css`.
- The current visual language uses Space Grotesk for headlines and Inter for body text.
- The main tokens are Emerald Primary (`#aaead0`), Gold Secondary (`#fcc025`), and Surface (`#0e0e0e`).

## Development Conventions

- Prefer functional components and hooks.
- Keep API responses and component props strictly typed.
- Use the existing `cn` helper for conditional class composition.
- Use the backend error normalisation helper in `api.ts` rather than duplicating parsing logic.
- Keep backend target changes in `vite.config.ts` unless the architecture changes.
- Preserve the user-centric and accessibility-first testing style used across the repo.

## Testing Conventions

- Test behavior, not implementation details.
- Prefer semantic queries such as `getByRole`, `getByText`, and `getByLabelText`.
- Avoid brittle assertions on hooks, state internals, or CSS class names.
- Use hidden screen-reader labels for important visual states when tests or accessibility need to observe them.
- Keep Vitest and Playwright runs free of unmocked backend calls and React async warnings.

## Domain Guidance

- This is a multiplayer poker UI, so terms like room, lobby, table, game, seat, pot, showdown, and hole cards should stay consistent with the existing code and docs.
- Prefer the project’s existing terminology over synonyms when naming tests, issues, or UI states.
- If a term is ambiguous, resolve it against the current codebase vocabulary before introducing a new label.

## Source Of Truth

- `AGENTS.md` and `GEMINI.md` should only point here for detailed context.
- `docs/agents/domain.md` should treat this file as canonical and mention `GEMINI.md` only as compatibility.
