# 0005: Monotonic Attempt Revision and Abort Guard for Private REST Recovery

We decided to guard private REST state recovery requests with monotonic attempt revision counters and AbortController cancellation in `GameSession.ts`.

## Context

When a connection hiccup or tab wake-up occurs, the client triggers a background REST recovery request (`/api/game/{gameId}/private-state`) to recover hole cards and seat state. If network latency delays the HTTP response, newer real-time STOMP frames (e.g. next-hand card deals or chip updates) can arrive before the HTTP response resolves. Previously, when the delayed HTTP response finally resolved, it overwrote the newer STOMP state with stale historical private state.

## Decision

1. **Monotonic Revisions**: Assign an incrementing `privateRecoveryAttempt` sequence number to every recovery cycle in `GameSession.ts`.
2. **Abort Superseded Requests**: Whenever a new recovery attempt or authoritative WebSocket frame arrives, abort the active in-flight `AbortController`.
3. **Stale Response Discarding**: Before applying any resolved private REST payload, assert that its attempt revision matches the active attempt counter; otherwise discard it silently.

## Consequences

- Prevents asynchronous REST race conditions from corrupting newer WebSocket state.
- Ensures hole cards and chip balances remain strictly monotonic.
- Cancels unnecessary pending HTTP network traffic on rapid reconnections.
