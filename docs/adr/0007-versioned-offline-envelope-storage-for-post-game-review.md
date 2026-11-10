# 0007: Recoverable Final GameReview Independent of the Live Table

Reviewed against the frontend implementation on 2026-11-10.

Persist terminal results in a versioned, tab-local envelope bound to room ID, player name and token. A matching validated envelope restores final GameReview after server room cleanup, rather than requiring indefinite server retention just to display that recap.

Live room availability and final-review availability are separate concerns. Without a local result, synchronization can try the authenticated review endpoint when room or game reads return 403/404, rather than immediately treating the missing live table as a lost session. A lost or ambiguous claim-win response also triggers bounded review reads instead of automatically repeating the mutation. A successful claim response, recovered review or GAME_END frame installs the terminal result and cancels live recovery; competing late responses must not replace it.

This is a frozen terminal result, not hand history or a saved single-hand showdown. Ownership matching prevents old results appearing under a different session; validation/versioning permits rejection of incompatible data. Legacy unversioned shared-storage results are discarded rather than trusted without ownership information.

The trade-off is dependence on browser storage and matching session identity. Storage loss, invalid credentials or incompatible data can prevent restoration; this is not a durable archive. Local binding is neither server authorization nor tamper-proof storage. Restoring without live room data does not imply application assets are available offline.

Implementation/schema: [gameEndStorage](../../src/services/gameEndStorage.ts). Cache restoration/persistence: [GameProvider](../../src/context/GameProvider.tsx). Server fallback: [sessionSync](../../src/domain/sessionSync.ts). Terminal installation and claim recovery: [GameSession](../../src/domain/GameSession.ts), covered by [claim recovery tests](../../src/domain/__tests__/claimRecovery.test.ts).
