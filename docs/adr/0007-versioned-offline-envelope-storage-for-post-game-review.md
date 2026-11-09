# 0007: Versioned Offline Envelope Storage for Post-Game Review

We decided to persist final game outcomes in browser `sessionStorage` inside a versioned envelope bound to `{ roomId, playerName, token }` so players can review results and showdowns even after the backend tears down the completed room aggregate.

## Context

When a poker match ends (one player accumulates all chips), the backend broadcasts a terminal game-end payload and shortly thereafter cleans up the in-memory room aggregate. If a player reloads or refreshes their browser tab while reading the game-over screen or examining the showdown recap, standard hydration calls `GET /api/game/{roomId}/state`. Because the room was already cleaned up by the server, the endpoint returns HTTP 404, causing naive clients to wipe session state and boot the player back to an empty login lobby.

## Decision

1. **Versioned Envelope Schema**: Define `PersistedGameEndEnvelope` (version 1) in `src/services/gameEndStorage.ts` containing `{ version: 1, roomId, playerName, token, result: GameEndResult, storedAt }`.
2. **Tab-Scoped Storage**: Save the envelope to `sessionStorage` under `poker-game-end:{roomId}` whenever a terminal `GAME_END` frame is received.
3. **Strict Auth Binding**: During page reload, `loadPersistedGameEnd()` only returns the cached result if the active session's `roomId`, `playerName`, and `token` match the envelope exactly. Unversioned legacy `localStorage` entries are rejected and purged.
4. **Offline Review Hydration**: When an envelope is restored, `GameSession` initializes directly into the `REVIEW` state with the cached result, allowing players to read the final recap at their leisure without failing on server 404s.

## Consequences

- Prevents abrupt lobby redirects and loss of post-game showdown details during page refreshes.
- Strict auth binding prevents stale review screens from poisoning future games created with the same room ID.
- Avoids requiring the backend to maintain zombie completed rooms indefinitely.
