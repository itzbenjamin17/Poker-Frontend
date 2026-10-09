# 0003: In-Process GameSession Store and GameTransport Port

We decided to encapsulate poker game state, hand progression, and timer lifecycles inside an in-process TypeScript `GameSession` store connected to React via `useSyncExternalStore`, while decoupling real-time communication behind a `GameTransport` port.

## Context

The previous architecture relied on an ambient React `GameContext` exposing 20+ raw state slices, action reducers, mutable refs, and `useEffect` timers. This forced 6 distinct test suites to fabricate brittle synthetic context mocks and caused race conditions between incoming WebSocket frames and component render lifecycles. Furthermore, tests bypassed the real-time boundary using a production `localStorage` backdoor (`poker-e2e-mock`).

## Decision

1. **In-Process `GameSession`**: Move game state transitions, action validation, and lifecycle timers (showdown delay, turn timeout) out of React components and into a standalone TypeScript `GameSession` domain model. React components consume it as an external store using `useSyncExternalStore`.
2. **`GameTransport` Port**: Define an explicit port (`connect`, `disconnect`, `subscribe`, `publish`, `onStatusChange`) satisfied by `StompTransportAdapter` in production and `InMemoryTransportAdapter` in tests.
3. **Pure Presentational Views**: Refactor `GameTableView`, `GameLobbyView`, and `GameReviewView` into pure components receiving explicit props from the container rather than reading ambient context.
4. **E2E WebSocket Interception**: Replace the production `poker-e2e-mock` conditional with Playwright native `page.routeWebSocket()`.

## Consequences

- Tests can verify complete game flows, showdown sequences, and timer transitions in pure Node.js in milliseconds without React or JSDOM wrappers.
- Deletes 6 ad-hoc `useGameContext` test mocks.
- Removes all test-only backdoor conditionals from production bundles.
- Requires views to receive explicit props or narrow session queries.
