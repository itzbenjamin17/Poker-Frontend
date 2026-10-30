# 0004: Tab-Scoped Authentication via sessionStorage

We decided to persist active player authentication and room tokens in browser `sessionStorage` rather than `localStorage`.

## Context

Standard single-tenant web applications use `localStorage` to share login state across all open browser tabs. In a multiplayer poker game, players frequently join multiple tables simultaneously ("multi-tabling"), and developers or testers need to open multiple tabs side-by-side to simulate different players in the same game. If tokens are stored in global `localStorage`, Tab 2 joining as "Bob" overwrites Tab 1's "Alice" token, causing session collisions, cross-tab evictions, and departure wipeouts.

## Decision

1. **sessionStorage Auth**: Store active `AuthResponse` credentials in `sessionStorage` under `poker-auth`.
2. **One-Time Migration**: During initial startup in `useAuthSession.ts`, inspect legacy `localStorage` once, import it to `sessionStorage`, and purge the legacy entry so subsequent tabs do not inherit it.
3. **Tab Isolation**: Each browser tab manages an independent authentication context, seat identity, and WebSocket connection.

## Consequences

- Multiple tabs can participate in the same or different rooms as different players without credential interference.
- Departing or clearing auth in one tab does not affect any other active tab.
- Closing a tab cleanly cleans up ephemeral player credentials.
