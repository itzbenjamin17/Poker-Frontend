# 0008: Opt-In Recent Seats Rejoin via localStorage

**Status:** Accepted (2026-11-22) — **Amends [ADR-0003](0003-tab-scoped-authentication-via-session-storage.md)**

> _Contradicts [ADR-0003](0003-tab-scoped-authentication-via-session-storage.md) (tab-scoped authentication via `sessionStorage`), because room JWTs now persist beyond the tab in `localStorage`. Worth amending because closing every tab previously stranded live seats through the server's disconnect grace period._

## Context

Under [ADR-0003](0003-tab-scoped-authentication-via-session-storage.md), active room credentials (`AuthSession`) live strictly in tab-local `sessionStorage`. That preserves multi-tab isolation, but closing every tab stranded every live seat: the server held the seat through its disconnect grace period, yet a new tab had no credentials and attempting to join under the same name failed with "Player name already taken".

## Decision

Keep active `AuthSession` storage tab-local in `sessionStorage` (`poker-auth`), and add a separate browser-wide `localStorage` list under `poker-recent-seats` (`version: 1`, at most five `{ roomId, playerName, token }` entries, newest first):

- `useAuthSession` records each seat a tab logs in to (or restores on load) in `poker-recent-seats` and removes it when the tab clears auth (leaving, or token expiry).
- The lobby's "Your seats" panel (`RejoinSeats`) checks each remembered seat against `GET /api/room/{roomId}` using that seat's token and renders a Rejoin button only for seats the server still holds; any 4xx response other than `408` or `429` forgets the seat.
- Nothing logs a tab in automatically: a seat is adopted into tab-local `sessionStorage` only when the player explicitly clicks its Rejoin button.

## Consequences

- **Tab isolation is preserved:** opening a second tab stays unauthenticated until the player chooses to join, create, or explicitly click a Rejoin button. Two tabs rejoining the same seat share it, which the server already supports.
- **Token persistence expands beyond a tab:** up to five active room JWTs persist in `localStorage` until the player leaves, the seat ends, or the token expires. They carry the same XSS exposure as tokens in `sessionStorage` and are pruned automatically once expired or rejected by the server.

Implementation: [useAuthSession](../../src/hooks/useAuthSession.ts), [recentSeats](../../src/services/recentSeats.ts), [RejoinSeats](../../src/components/lobby/RejoinSeats.tsx), [App](../../src/App.tsx).
