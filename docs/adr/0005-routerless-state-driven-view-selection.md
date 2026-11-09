# 0005: Routerless State-Driven View Selection

We decided to avoid client-side routing libraries (such as React Router) and instead render views as a deterministic state machine driven by authenticated session state.

## Context

Most modern React applications introduce a routing package (`react-router-dom`, TanStack Router) that maps URL pathnames (e.g. `/lobby`, `/table/123`, `/review`) to view components. In a multiplayer poker game, viewing a table or review screen requires an active cryptographic JWT and synchronized WebSocket connection. Exposing browser URL routes allows users to bookmark or navigate to deep URLs without valid credentials, triggering complex redirection guards, and exposes back/forward button interactions that desynchronize live game states.

## Decision

1. **State Machine Root**: `App.tsx` serves as the top-level view selector, switching between `<Lobby />`, `<GameView />`, and `<GameReviewView />` strictly based on active `auth` token state and room status.
2. **Zero Router Dependencies**: The application does not install or bundle any client-side router library.
3. **Deep Link Security**: Navigating to the app always enters through the lobby unless valid session credentials exist in `sessionStorage`.

## Consequences

- Completely eliminates deep-link unauthorized access bypasses and URL synchronization race conditions.
- Prevents browser back/forward buttons from breaking active multiplayer games.
- Reduces frontend bundle size and dependency surface.
