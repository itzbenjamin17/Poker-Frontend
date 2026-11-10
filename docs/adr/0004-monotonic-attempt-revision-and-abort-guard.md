# 0004: Reject Stale REST Recovery Results

Reviewed against the frontend implementation on 2026-11-10.

Recovery reads REST snapshots while WebSocket frames may advance the room and hand. Completion order cannot determine which state is current.

Use recovery-attempt identity and domain revisions to reject obsolete results, alongside cancellation of superseded requests. Ordered public snapshots also use hand/state ordering; private cards must remain coherent with the current hand and player. Cancellation alone is insufficient because a response may already have completed or newer live data may arrive during a request.

For example, when a live frame advances to the next hand while REST recovery is pending, the old public snapshot must not restore the previous hand or pair its private cards with the new board. REST public/private reads must agree on hand and player identity; at commit time they are checked against state already accepted by GameSession. Private live frames arriving ahead of their public hand can be buffered until that hand arrives. Recovery retries when it cannot establish a coherent pair rather than declaring the table recovered with mismatched cards.

The trade-off is ordering bookkeeping across room, public and private state. This prevents recovery overwriting accepted newer data; it does not make chip balances monotonic or independently prove the freshness of every server payload.

Counter names, commit guards and sibling-request cancellation belong in [GameSession](../../src/domain/GameSession.ts) and [sessionSync](../../src/domain/sessionSync.ts), with regression coverage in session ordering tests.
