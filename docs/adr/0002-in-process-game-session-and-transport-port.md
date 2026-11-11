# 0002: In-Process GameSession and GameTransport Boundary

Reviewed against the frontend implementation on 2026-11-10.

Room and table state, incoming WebSocket messages, reconnect recovery, action locks, and countdown timers live inside a plain TypeScript class (`GameSession`) rather than being spread across React `useState` and `useEffect` hooks. React components subscribe to `GameSession` snapshots (`SessionSnapshot`) using `useSyncExternalStore`. Keeping this logic in a standalone class makes it easy to follow and lets unit tests run full game sessions without rendering React components.

Real-time messaging sits behind the `GameTransport` interface, which uses STOMP over WebSockets in production and a fast in-memory fake (`InMemoryTransportAdapter`) in unit tests. End-to-end browser tests intercept WebSocket traffic at the network boundary instead of adding test-only flags to production code. In exchange, `GameSession` is responsible for producing read-only `SessionSnapshot` objects and cleaning up subscriptions when unmounted.

`GameProvider` connects and disconnects `GameSession` when the React tree mounts and unmounts, while `GameSession` cancels outdated recovery requests and ignores stale timer callbacks. Passing in a `Clock` interface makes timer tests deterministic without waiting for real time to pass.

`GameView` passes table data and action callbacks down to UI components. Backend poker rules remain the single source of truth.

Implementation: [GameSession](../../src/domain/GameSession.ts), [GameProvider](../../src/context/GameProvider.tsx), [transport](../../src/services/transport.ts).