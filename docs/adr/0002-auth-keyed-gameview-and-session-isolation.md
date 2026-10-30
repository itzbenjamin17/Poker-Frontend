# 0002: Auth-Keyed GameView Subtree and Session Isolation

We decided to key the authenticated `GameView` component subtree by the active `auth.token` and isolate the `GameSession` lifecycle instance to that token.

## Context

When a user switches rooms, logs out and re-logs in, or experiences an auth replacement in React, mounting `GameView` without an identity key caused the component instance to survive across different sessions. This resulted in stale WebSocket subscriptions, orphaned hand timers, and lingering UI state from the previous room being displayed in the new room.

## Decision

1. **Auth-Keyed Mounting**: In `App.tsx`, mount the authenticated view using `<GameView key={auth.token} />`.
2. **Lifecycle Isolation**: Any change to `auth.token` triggers a clean unmount of the entire game subtree, automatically cancelling active timers, tearing down WebSocket connections, and initializing fresh session state.
3. **Session Purging**: During unmount, `GameProvider` destroys the underlying `GameSession` instance so state cannot bleed into subsequent logins.

## Consequences

- Prevents memory leaks, orphaned countdown intervals, and cross-session state pollution.
- Forces React to perform a clean, predictable mount whenever authentication changes.
- Eliminates manual component reset logic across child table components.
