# 0004: Reject Stale REST Recovery Results

Reviewed against the frontend implementation on 2026-11-10.

When a tab reconnects or wakes up, it fetches the current room and game state over REST while live WebSocket messages may arrive at the same time. Because network requests can finish out of order, a slow REST response might contain older state than a WebSocket message that arrived while the REST request was still in flight.

To prevent an older REST response from overwriting newer live state, `GameSession` tracks a recovery-attempt counter alongside the server's `handNumber` and `stateRevision` counters, and aborts superseded in-flight HTTP requests. Aborting requests alone is not enough because a slow response may have already arrived just after a newer WebSocket update was applied.

For example, if a WebSocket message deals Hand #2 while a REST recovery fetch from Hand #1 is still finishing, `GameSession` compares the hand and revision numbers and drops the old Hand #1 response—preventing the UI from flashing back to the previous hand or pairing Hand #1's hole cards with Hand #2's community cards. Public table state and private hole cards fetched during recovery must match the same hand and player ID before they are applied; if a live private-card message arrives slightly ahead of the new hand's public broadcast, `GameSession` buffers the cards until the matching hand arrives. If recovery receives mismatched public and private responses, it retries rather than rendering mismatched cards.

Implementation: [GameSession](../../src/domain/GameSession.ts) and [sessionSync](../../src/domain/sessionSync.ts), covered by session ordering tests.