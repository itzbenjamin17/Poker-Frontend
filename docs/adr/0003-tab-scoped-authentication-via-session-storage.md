# 0003: Tab-Scoped Authentication via sessionStorage

Reviewed against the frontend implementation on 2026-11-10.

Active room login credentials (`AuthSession`: `roomId`, `playerName`, and JWT `token`) are saved in the browser tab's `sessionStorage` rather than `localStorage`. Because `sessionStorage` is isolated per tab, a player or developer can open multiple tabs to join as different players or sit at different rooms without one tab overwriting another tab's login.

Refreshing a tab restores its `AuthSession` from `sessionStorage`, whereas closing a tab does not send an explicit "leave room" request—the server handles closed tabs through its WebSocket disconnect grace period ([Backend ADR-0009]). Note that duplicating an existing tab in the browser may copy the original tab's initial `sessionStorage`.

Each `AuthSession` is tied to a specific `{ roomId, playerName, token }` triple rather than a global user account. If an old token expires or a delayed "leave room" response arrives after the tab has already joined a new room, the client checks the token before clearing `AuthSession` so an old request never logs out a newer session; see also [ADR-0007](0007-versioned-offline-envelope-storage-for-post-game-review.md).

On startup, `useAuthSession` migrates and deletes any old `localStorage` auth entries from earlier versions. All security and permission checks are still enforced by the backend server.

Implementation: [useAuthSession](../../src/hooks/useAuthSession.ts), [App](../../src/App.tsx).