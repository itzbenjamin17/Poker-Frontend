# 0003: Tab-Scoped Authentication via sessionStorage

Reviewed against the frontend implementation on 2026-11-10.

Active room credentials use tab-local sessionStorage rather than shared localStorage. Different tabs must represent different players or rooms without one join or leave replacing another tab's identity.

This favors independent seats over shared-login behavior. Reload can restore a session, but storage is not a durable account login. Closing a tab is not an explicit server-side leave; disconnect and seat cleanup remain server concerns. Browser session restoration or opener-based duplication may retain or copy initial storage, so not every newly duplicated tab starts empty.

The identity boundary is the room, player name and token, not a browser-wide account. An expiry or late leave response for a previous token must not clear a replacement AuthSession. Changing to shared login would therefore require revisiting session lifecycle and final-review ownership as well as the storage API; see [ADR-0007](0007-versioned-offline-envelope-storage-for-post-game-review.md).

The client migrates and clears legacy shared auth and scopes expiry handling to the affected token. Compatibility mechanics live in [useAuthSession](../../src/hooks/useAuthSession.ts); leave-response ownership is enforced in [App](../../src/App.tsx). Server authorization remains necessary regardless of storage.
