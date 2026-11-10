# 0002: In-Process GameSession and GameTransport Port

Reviewed against the frontend implementation on 2026-11-10.

Game state, incoming frames, recovery, action locks and session timers belong to an in-process GameSession rather than a collection of React state slices and effects. React subscribes through useSyncExternalStore. This makes lifecycle ownership explicit and permits session tests without rendering the UI.

Real-time communication sits behind GameTransport, with STOMP in production and an in-memory adapter for tests. Browser tests intercept the transport boundary instead of enabling production mock modes. The trade-off is an explicit store lifecycle, immutable snapshots and subscription cleanup that the application must maintain.

GameProvider attaches and detaches the session with the React lifecycle, while the session guards obsolete callbacks and owns recovery cancellation. An injected Clock makes session timers deterministic. Moving this ownership back into component effects would couple recovery and transport correctness to rendering again; a different state library alone would not remove that responsibility.

The container supplies view data and commands. Some presentation components retain context compatibility fallbacks; this record does not claim every view is props-only. Backend poker rules remain authoritative.

Implementation: [GameSession](../../src/domain/GameSession.ts), [GameProvider](../../src/context/GameProvider.tsx), [transport](../../src/services/transport.ts).
