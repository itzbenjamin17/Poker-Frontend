# 0005: Monotonic Attempt Revision and Abort Guard for REST Recovery

We decided to guard REST session synchronization and recovery requests with monotonic attempt and domain revision counters (`attemptId`, `privateSyncRevision`, `stateSyncRevision`, `roomRevision`) and `AbortController` cancellation in `GameSession.ts` and `sessionSync.ts`.

## Context

When initial hydration, a connection hiccup, or tab wake-up occurs, `GameSession.synchronizeSession()` delegates to `loadSessionData()` (`sessionSync.ts`) to fetch room state (`/api/room/{roomId}`) and/or concurrent public and private game snapshots (`/api/game/{gameId}/state` and `/api/game/{gameId}/private-state`), falling back to `/api/game/{gameId}/review` when appropriate. If network latency delays an HTTP response, newer real-time STOMP frames (e.g. next-hand hole cards, public state advances, or room updates) or a newer recovery cycle can arrive before the HTTP response resolves. Without attempt and revision guards, delayed REST responses could overwrite fresher WebSocket state.

## Decision

1. **Monotonic Attempt and Domain Revisions**:
   - Assign an incrementing `attemptId` sequence number to every recovery cycle in `GameSession.synchronizeSession()`, and increment `attemptId` whenever recovery is cancelled or scheduled for retry.
   - Track monotonic domain revision counters for WebSocket-driven updates: `roomRevision` (room membership/start frames), `stateSyncRevision` (accepted public game state frames), and `privateSyncRevision` (accepted private hole-card frames and hand transitions).
   - Snapshot `(attemptRoomRevision, attemptPrivateRevision, attemptStateSyncRevision)` when starting an attempt.
2. **Abort Superseded or Failed Requests**:
   - Store the active attempt's `AbortController` on `activeAttemptController` in `GameSession.ts` and abort it whenever a new `synchronizeSession()` attempt starts, a sync attempt fails (`handleSyncFailure` / `scheduleNextRecoveryRetry`), or recovery is cancelled (`cancelRecovery`, `disconnect`, `scheduleRedirect`).
   - Inside `loadSessionData()` (`sessionSync.ts`), link a child `attemptController` to the caller's `AbortSignal` so that if either concurrent public or private REST request rejects, the in-flight sibling request is aborted immediately.
3. **Stale Response Discarding in `commitSyncResult`**:
   - Ignore resolved `loadSessionData()` results if `controller.signal.aborted` is true or the captured `attempt` no longer matches `this.attemptId`.
   - In `commitSyncResult()`, apply room snapshots only when `this.roomRevision === attemptRoomRevision`, guard unordered legacy public snapshots with `this.stateSyncRevision === attemptStateSyncRevision` (while ordered snapshots are gated by `(handNumber, stateRevision)` in `applyGameState()`), and skip REST `privateState` when `this.privateSyncRevision > attemptPrivateRevision` and the existing private state already coherently matches the current hand and hero identity.

## Consequences

- Prevents asynchronous REST race conditions from corrupting newer WebSocket room, public, or private state.
- Ensures hole cards, hand numbers, and chip balances remain strictly monotonic across reconnects.
- Cancels unnecessary in-flight HTTP network traffic immediately when superseded or when a sibling request fails.
