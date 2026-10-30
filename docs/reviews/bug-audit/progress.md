# Poker bug audit progress

Started 2026-10-18 (Europe/London). Review current full source; no fixes or GitHub issues. Preserve concurrent edits. Reports only under this directory.

## Baseline
- Frontend HEAD: `3d25f9562e0d6bdcc7a48368485d881f08382755`; initial working tree clean.
- Backend HEAD: `8e9740f8d5d2e4572c1f666b63659105b77e12d5`; initial working tree clean.
- Read both AGENTS.md, domain guidance, PROJECT.md; frontend ADR-0001/0003; backend ADR-0001.
- Primary reviewers: explicitly configured `gpt-6.1-sol`, reasoning `high`, generic language-appropriate reviewer instructions. Repository frontend-specific role is not used for Java. Discovery/verification: `gpt-6-luna`, low. No fallback requested or observed. Orchestrator model comes from host; cannot independently inspect its model identifier.
- Sequential areas: F1 → F8 → B1 → B10 → X1 → X2. Each report must be collected/validated/recorded before next starts.
- Inventory in progress. Production, configuration, tests read-only; no secret/runtime-data contents.

## Coverage
| Area | Scope | Status |
| --- | --- | --- |
| F1 | Entry/auth/lobby | Complete: F1-1..3 High, F1-4 Medium, F1-5..7 Low validated (Tier 4 re-review) |
| F2 | HTTP/runtime boundaries | Complete: F2-1 Medium, F2-2..5 Low validated (Tier 6 re-review) |
| F3 | GameSession/React | Complete: F3-2..4 High, F3-1/F3-5..7 Medium, F3-8 Low validated (Tier 4 re-review) |
| F4 | Transport/recovery | Complete: F4-3/F4-4 High, F4-1/F4-2/F4-5/F4-6 Medium, F4-7/F4-8 Low validated (Tier 3 re-review) |
| F5 | Orchestration/final review | Complete: F5-3/F5-5 High (F5-2 merged X2-9/B1-2), F5-4/F5-6..7 Medium, F5-1/F5-8..9 Low validated (Tier 3 re-review) |
| F6 | Poker display/interaction | Complete: F6-1/F6-6 High (F6-5 merged B4-1/X1-6), F6-2..4/F6-8 Medium, F6-7/F6-9..10 Low validated (Tier 2 re-review) |
| F7 | Geometry/accessibility | Complete: F7-2..3 High, F7-4..7 Medium, F7-1/F7-8..10 Low validated (Tier 5 re-review) |
| F8 | Build/deploy/test infrastructure | Complete: F8-4 High, F8-1..2 Medium, F8-3/F8-5 Low validated (Tier 6 re-review) |
| B1 | Room lifecycle | Complete: B1-1/B1-4..5 High, B1-2/B1-3/B1-6..8 Medium, B1-9..11 Low validated (Tier 4 re-review) |
| B2 | Evaluation | Complete: B2-1 High reproduced and all categories verified (Tier 1 re-review) |
| B3 | Betting | Complete: B3-1..3, B3-7..8 High; B3-4..6, B3-9..10, B3-12..13 Medium; B3-11, B3-14 Low validated (Tier 1 re-review) |
| B4 | Pots/chips | Complete: B4-2..5 High; B4-1, B4-6 Medium validated (Tier 1 re-review) |
| B5 | Hand lifecycle/scheduling | Complete: B5-1..2/B5-9/B5-14 Critical, B5-3/B5-15..18 High, B5-4..6/B5-19..20 Medium, B5-7..8/B5-10..13/B5-21 Low validated (Tier 2 re-review) |
| B6 | Disconnect/concurrency | Complete: B6-2/B6-4/B6-7..9 High, B6-3/B6-10..12 Medium, B6-5/B6-6 Low (B6-1 merged B5-3) validated (Tier 4 re-review) |
| B7 | Auth/abuse | Complete: B7-1/B7-2/B7-9..10 High, B7-3..5/B7-11 Medium, B7-6..8/B7-12..13 Low validated (Tier 5 re-review) |
| B8 | API/projections | Complete: B8-1/B8-4 High, B8-5/B8-8..9 Medium, B8-6..7/B8-10..12 Low (B8-2 merged B4-1, B8-3 merged B5-1) validated (Tier 3 re-review) |
| B9 | Durable transactions/images | Complete: B9-1 Critical, B9-2/B9-4/B9-11..12 High, B9-5/B9-6/B9-13..15 Medium, B9-8/B9-10 Low (B9-3 merged B1-3, B9-7 merged B6-5, B9-9 merged B5-8) validated (Tier 6 re-review) |
| B10 | WAL/recovery/operations | Complete: B10-1/B10-2/B10-8 Critical, B10-3/B10-4 High, B10-9..11 Medium, B10-6/B10-7/B10-12..13 Low (B10-5 merged B6-5/B9-7) validated (Tier 6 re-review) |
| X1 | Cross-stack contracts | Complete: X1-3 High (merged B5-9), X1-9 Medium, X1-4 Medium, X1-1/X1-2/X1-5/X1-10 Low after revision (X1-6 merged B4-1/B8-2, X1-7 merged B8-1, X1-8 merged B8-7, X1-11 merged F6-8) validated (Tier 3 re-review) |
| X2 | Cross-stack lifecycle/failures | Complete: X2-1/X2-2 Critical, X2-3..5, X2-8..9 High, X2-6..7, X2-10..12 Medium validated (Tier 2 re-review) |

## Checks and blockers
Checks are recorded chronologically below. Full frontend checks passed; standard E2E incomplete; backend Spring checks deferred pending B10.

## Next action
Tier 6 implementation and verification complete across Poker and frontend-poker! Proceeding to Milestone 5: Full automated regression test suites (JUnit, Vitest, Playwright), final manual browser testing checklist (Tiers 1–6), and concise audit issue summary (Tiers 1–6).

### Initial verification
- Node v24.2.0, npm 11.17.0, Java 25.0.4.1 available (CI frontend uses Node 22).
- F1 focused invocation `npm run test -- --run src/__tests__/App.test.tsx src/__tests__/Lobby.integration.test.tsx src/hooks/__tests__/useAuthSession.test.ts src/components/lobby/__tests__`: exit 1; 6 suites failed to load, 0 assertions. Sandbox EPERM renaming Vite temp cache under AppData. PowerShell/npm argument handling also consumed `--run`; future command uses explicit npm.cmd arguments.
- Inventory complete: 169 frontend / 162 backend filtered paths, exact per-file ownership in inventory.md.
- Re-ran focused F1 tests using explicit `npm.cmd` arguments outside sandbox after cache EPERM: exit 0, 6 files / 49 tests passed. No source or dependency changes.

F1 report validated: request locking/cancellation and token-scoped expiry paths checked; no actionable F1 findings. Boundary questions transferred to F2/F3/F5. Next: F2 full API/decoder review. Production hash baseline captured for 277 tracked source/config/test files.


- F2 focused checks: npm.cmd run test -- --run src/services/__tests__/api.test.ts src/lib/__tests__/payloads.test.ts: exit 0, 2 files / 74 tests passed (outside sandbox cache restriction).

F2 validated: no confirmed findings; runtime decoder/request cancellation paths and tests inspected. X1 must verify auth and raw room DTO producer guarantees/nullability. Next: F3, including old leave callback vs replacement auth boundary.


- F3 focused checks: npm.cmd run test -- --run src/domain/__tests__/GameSession.test.ts src/domain/__tests__/clock.test.ts src/context/__tests__/GameProvider.test.tsx src/context/__tests__/GameProvider.integration.test.tsx: exit 0, 4 files / 52 tests passed.

F3 interim: coordinator validated stale LEAVE_GAME completion calling unscoped clearAuth after cross-tab replacement (dispatcher:102-105; auth:75-87; App:41-46). Medium, affects F1/F3/F5; awaiting completed F3 report. Recovery Promise.all early rejection/in-flight retry ordering transferred to F4 for confirmation.

F3 completed and report validated. Countdown true-to-false/deadline-decrease producer question reserved for X1. Next: F4 transport/hydration/recovery, including overlapping REST retry boundary.


- F4 focused checks: npm.cmd run test -- --run src/services/__tests__/transport.test.ts src/hooks/__tests__/useSessionHydration.test.ts src/hooks/__tests__/useSessionHydration.integration.test.tsx src/hooks/__tests__/useGameWebSocket.test.ts src/hooks/__tests__/gameSnapshotDiagnostics.test.tsx: exit 0, 5 files / 63 tests passed.

F4 validated: F4-1 private REST retry rollback; F4-2 decoder rejection swallowed, started table loading without retry (conditional malformed response, no backend producer established). Existing tests pass but don't cover these sequences. Next F5 command/orchestration/final review.


- F5 focused checks: npm.cmd run test -- --run (dispatcher, six GameView integrations/DisconnectLeaveEdgeCase, five game view/GameUI component files; exact list in F5 report): exit 0, 12 files / 130 tests passed.

F5 completed. F5-1 Low bad-cache review render throw validated; existing F3-1 shared, no duplicate. Backend/cross-stack questions: pre-hydration leave seat cleanup; claim-win success terminal-event guarantee; finalState.isWinner hand-vs-game semantics. Next F6.


- F6 focused checks: npm.cmd run test -- --run src/lib/__tests__/game.test.ts plus ActionPanel/CommunityCardsArea/TablePots/TablePlayers/OpponentSeats/ResultDock/RoomHeader/NotificationBanner component tests: exit 0, 9 files / 72 tests passed.

F6 report validated: all 11 primary files/9 tests inspected, no independent frontend-only defect. X1 questions: raise units/minimum; winners union vs tie/per-pot payouts; busted OUT cards/forfeit wording; readiness error routing. Next F7 geometry/responsiveness/accessibility.


- F7 focused checks: npm.cmd run test -- --run geometry/layout/seat/element-size/primitives files listed in F7 report: exit 0, 16 files / 229 tests passed. Supplementary F7a Luna/medium: no confirmed accessibility findings.
- F7 browser diagnostic: `LAYOUT_COUNTS=3,10 LAYOUT_VIEWPORTS=MobileLandscape_Min,Desktop_MinHeight,Portrait_MinWidth LAYOUT_SCENARIOS=main,regular npx.cmd playwright test -c playwright.layout.config.ts scripts/layout/layout-overlap.spec.ts`: exit 0, 4 tests passed (20.4s), 12 filtered count/viewport/scenario combinations. Real Chromium DOM, mocked REST/STOMP, Vite only; not real-backend E2E. Generated report: test-results/layout-overlap/report.json.
- F7 contrast validation: transient headless Chromium on local Vite port 5175 (process closed after check), actual `Room Name` label: color oklch(0.552 0.016 285.938), 10px/700; card background oklab(0.268617 0.000012286 0.00000536442 / 0.6), outer/body rgb(14,14,14). Confirms label contrast <=4.00:1 versus 4.5:1 normal-text minimum. No source/test changes.

F7 complete: Low F7-1 input-label contrast validated by source plus actual Chromium computed styles. No concrete geometry failure; limited layout browser cases green. F7a supplement no independent findings. Next F8 configuration/test reliability and once-broad frontend checks.

- F8 broad frontend checks (one run): `npm.cmd run test -- --run` exit 0, 54 files / 669 tests passed (37.09s); `npm.cmd run lint` exit 0; `npm.cmd run build` exit 0 (TypeScript + Vite).
- F8 CSP validation on built production preview in Chromium: `connect-src` violations for custom HTTPS API and WSS origins, fetch TypeError, zero external network requests. Confirms advertised custom-origin deployment fails under index.html policy.
- Standard Playwright suite started using unmodified configuration, existing local environment (values not inspected), Java 25 and existing compiled classes. e2e profile explicitly disables persistence/rate limiting. Ports 8080/5173 were free before start.
- Standard E2E aborted (exit 1 via coordinator interrupt). Backend startup unexpectedly logged persistence enabled=true despite e2e profile false. It restored 0 rooms/games, then created audit rooms before observation; stop prevents continued writes to shared configured data/poker-wal. Runtime data contents were not inspected or deleted. No runtime configuration changed to force a pass. Observed failure before abort: comprehensive Scenario1, e2e/fixtures.ts:15 (`Room name is required`), called from create fixture:41. Remaining suite incomplete. B10 must investigate configuration precedence before backend Spring integration execution; pure unit tests may run centrally once safe.

F8 completed/validated: CSP custom origins reproduced; escaped Docker ignore wildcard static-confirmed. E2E fixture failure unexplained, do not call flaky or production bug. Next backend B1; never run Spring integration before safe persistence boundary established. All frontend source fingerprints unchanged.

- B1 focused non-Spring checks: `.mvnw.cmd -B -ntp test "-Dtest=RoomTest,RoomServiceTest,InputSanitizerTest"` initial sandbox stalled after 47 RoomTest tests, at Mockito RoomService setup; interrupted. Outside-sandbox retry exit 0, 75 tests passed. Logs B1-check.log (interrupted), B1-check-retry.log (completed). No Spring context/runtime WAL used.

B1 validated: stale controller lobby decision splits room/game (High); never-connected lobby seat/host has no expiry (shared F1/F5/B6, Medium); disabled-persistence host-transfer race (Medium). B7 must check removed-name JWT reuse; minor canStart inconsistency not confirmed. Next B2 cards/evaluation.

- B2 pure unit checks: `.mvnw.cmd -B -ntp test "-Dtest=CardTest,DeckTest,HandEvaluationResultTest,HandEvaluatorServiceTest,RankTest,SuitTest,HandRankTest"`: exit 0, 99 tests / 7 classes passed. Log B2-check.log. No Spring context.
- B2 new-defect reproduction (production methods, no test/source write): JShell with target/classes and existing slf4j-api jar; board 2C 5D 8H 9S JC, holes AS 3D vs KS QD. getBestHand returned [A,J,9,8,5] and [K,Q,J,9,8]. `isBetterHandOfSameRank(king.bestHand(), ace.bestHand(), HIGH_CARD)` returned true. This confirms wrong high-card winner. No Spring/service/runtime WAL.

B2 validated and reproduced High B2-1 wrong high-card comparator order; coordinator JShell evidence above. No additional deck/evaluation defects confirmed. Next B3 betting/turn progression, B4 owns payout sections.

- B3 non-Spring checks: `.mvnw.cmd -B -ntp test "-Dtest=GameTest,PlayerTest,PlayerActionTest,GamePhaseTest,PlayerActionServiceTest"`: exit 0, 147 tests / 5 classes passed. Log B3-check.log. Includes some B4 Game accounting cases; no repeat needed in B4 unless new verification target.
- B3 new-defect reproduction: JShell public Game/Player/PlayerDecision methods on 3-player5/10 table. After B raises total from10to50, C's55 additional chips (prior5) raises total60 and is accepted. Expected minimum next full raise total90. Output firstActor=B; highest=60,cBet=60. Confirms fixed-BB validation bug at Game.java474-480. No source/test writes or Spring/runtime data.
- B3 second JShell reproduction: 3-player flop B bets100, C calls, A short-allin150, already-acted B raises150additional to250; accepted highest=250,Bbet=250. Confirms illegal short-allin reopening independently of fixed-BB minimum bug.
- B3 third JShell reproduction: heads-up5/10, A1000/B5, reset/deal/postBlinds leaves current=B, allin=true, phase=PRE_FLOP. Coordinator source confirms startNewHand only broadcasts after blinds, no auto-run/scheduling at lifecycle171-196. All reproductions use public domain methods only.
- B3 fourth/fifth public-method JShell checks: departing current B selects C in model, then lifecycle's explicit nextPlayer selects A (skips C). Four-seat dealer D/remove lower-index A, remaining C call/D call/B check -> FLOP first actor C (expected B). Source service sequence, not full Spring service reproduction. Confirms departure progression/index defects; no code/test changes.

B3 complete six findings: last-full-raise, short-allin reopening, blind-allin stall (High); leave skips successor, dealer index shifts, missing postdeparture hand completion (Medium). Five public-method JShell validations, sixth source checked lifecycle306-337 vs isHandOver1299-1301. ShortBB bring-in kept rule hypothesis. Raise amount incremental agreed; authoritative full-raise/reopen metadata absent. Next B4 payout/accounting.


- B4 production-method JShell: contributions50/150/150 fixed AA/KK/QQ low board produced winners[Short,Mid], stacks150/350/150, scalar175 despite actual awards150/200. Source GameState181 publishes175for each, confirms unequal payout projection.
- B4 second production-method JShell: contributions50/150/150, remove Leaver before showdown with ShortAA/MidKK -> winners[Short],stacks250/250,pot0 (expected150/350). Confirms departed contributor side-pot misallocation. Deterministic synthetic cards set through public collections; not a full Spring action flow. No source/tests/runtime WAL changed.
- B4 source validation: handleGameEnd354-386 picks stack winner/marks over/broadcasts/cleanup but never settles remaining pot, reachable heads-up leave319-323. Await final report. Known B3/GameTest checks cover existing accounting tests; no repeat.

B4 complete three findings validated: Medium false scalar chipsWon, High departed-contributor wrong side-pot payout, High terminal pot left unawarded. B4 producer handoff resolves winners union/ALL_IN card reveal/final game winner flags for X1. Odd-chip carry explicitly deliberate, product rule question only. B5/B6 check busted player claim during final display if winner disconnects. Next B5.

- B5 focused non-Spring checks: `GameLifecycleServiceTest` ran earlier: exit 0, 48 tests passed (log B5-check.log).
- B5 deterministic source traces independently confirmed: B5-1 routed hypothesis verified in `canPlayerClaimWin` and `computeClaimWinPlayerName` where zero-chip busted players retain `!isOut` before next-hand reset; B5-2 `handleGameEnd` leaves task deadlines intact and `executeScheduledTask` deals on ended game; B5-3 `GameController.leaveGame` bypasses `RoomService.leaveRoom()`; B5-4 `readyCountdownTimeouts` future leak; B5-5 30s ready stall for lone chip holder; B5-6 `handleGameEnd` missing `@DurableMutation`; B5-7 spectator ready toggle; B5-8 `@Async` self-invocation. All-in blind freeze duplicate merged into B3-3.

B5 complete eight findings validated initially. Re-reviewed on pro (Argon): confirmed B5-1/B5-2, corroborated B3-4 (double advance) and B4-3 (forfeit unawarded pot), confirmed Critical B5-9 (game never ends on leave with busted spectators), Low B5-10 (unsynchronized getCurrentPlayer read in log), Low B5-11 (premature schedule before commit). Next B7.

- B6 focused non-Spring checks: `WebSocketEventListenerTest`: exit 0, 4 tests passed.
- B6 deep review on pro (Argon) independently confirmed: B6-1 duplicate of B5-3 REST leave Room/Game desync; B6-2 `playerExistsInGame` unsynchronized iteration over mutable `ArrayList` causes `ConcurrentModificationException`; B6-3 `removeDisconnectedPlayer` lacks state guard against already-reconnected players; B6-4 Reconnect skips `markPlayerReconnected` when `pendingDisconnect` map entry is missing; B6-5 lock and compaction counter leak in `sessionLocks` and `roomLocks`; B6-6 mutating `Game.getCurrentPlayer()` called outside synchronization in `startNewHand`.

B6 complete six findings validated: High B6-2 CME in player lookup, Medium B6-3/B6-4 disconnect guard and reconnect skip, Low B6-5/B6-6 (B6-1 merged B5-3). Next B7 authentication, authorization, and abuse controls.

- B7 focused non-Spring checks: `RateLimitServiceTest`, `PayloadSizeFilterTest`, `JwtServiceTest`, `SecurityUtilsTest`: exit 0, 62 tests passed.
- B7 review independently confirmed: B7-1 `X-Forwarded-For` spoofing rate limit bypass and proxy lockouts; B7-2 `GET /api/room/{roomId}` unauthenticated cross-room metadata exposure; B7-3 departed/evicted players eavesdropping on STOMP topics with unrevoked JWTs; B7-4 `PayloadSizeFilter` chunked encoding bypass; B7-5 `wsBuckets` memory leak; B7-6 fragile destination parsing in STOMP interceptor; B7-7 null principal NPE in `WebSocketExceptionHandler`; B7-8 coarse hourly rate limit clear.

B7 complete eight findings validated: High B7-1/B7-2, Medium B7-3..5, Low B7-6..8.

- B8 focused non-Spring checks: `WebSocketExceptionHandlerTest`, `GameStateServiceTest`: exit 0, 43 tests passed (3.68s). No Spring application context or live WAL directories.
- B8 review independently confirmed: B8-1 `buildPublicGameStateResponse` erases showdown winners/cards during ready countdown and emits stale `isCurrentPlayer=true`; B8-2 scalar equal-share projection in side pots and total-stack injection in `GameEndResponse` (consolidated B4-1); B8-3 busted 0-chip player projected as eligible claimant (consolidated B5-1); B8-4 STOMP action error notifications misrouted to parsed destination room instead of authenticated caller's principal room; B8-5 Spring `MessageConversionException` suppresses granular action error codes; B8-6 missing `@Valid` on `PlayerActionRequest`; B8-7 inconsistent 401 JSON body in `JwtAuthenticationFilter`.

B8 complete seven findings validated: High B8-1/B8-4 (B8-2 merged B4-1, B8-3 merged B5-1), Medium B8-5, Low B8-6/B8-7.

- B9 focused non-Spring checks: `DurableMutationAspectTest`, `AggregateSnapshotMapperTest`: exit 0, 4 tests passed (3.80s). No Spring application context or live WAL directories.
- B9 review independently confirmed on pro (Argon): B9-1 [Critical] in-memory aggregate corruption on mutation failure leaves dirty state that subsequent actions commit to disk; B9-2 [High] `DurableTransactionContext.complete()` aborts all remaining callbacks and reports failure when any `afterCommit` runnable throws; B9-3 [High] `RoomService.leaveRoom` lacks synchronization when persistence is disabled (consolidated B1-3); B9-4 [High] WAL compaction failure marks entire persistence store unhealthy, fatally breaking all rooms; B9-5 [Medium] swallowed exceptions in `PlayerActionService` post-processing can commit invalid state and drop lifecycle transitions; B9-6 [Medium] nested `@DurableMutation` clears MDC `roomId` in outer mutation finally block; B9-7 [Medium] unbounded memory leak of `roomLocks` and `recordsSinceCompaction` (consolidated B6-5); B9-8 [Low] missing `@EnableAspectJAutoProxy(exposeProxy = true)`; B9-9 [Low] dead `@Async` and proxy bypass on `GameLifecycleService.performGameCleanup` (consolidated B5-8); B9-10 [Low] potential NPE in `AggregateSnapshotMapper.cardsFromState` on null list.

B9 complete ten findings validated: Critical B9-1, High B9-2/B9-4 (B9-3 merged B1-3), Medium B9-5/B9-6 (B9-7 merged B6-5), Low B9-8/B9-10 (B9-9 merged B5-8).

- B10 focused non-Spring checks: `EncryptedWalStoreTest`, `PersistenceRecoveryTest`: exit 0, 12 tests passed (3.77s). Verified using `@TempDir` without Spring context or workspace WAL pollution.
- B10 review independently confirmed on pro (Argon): B10-1 [Critical] configuration precedence defect causes `.env` `POKER_PERSISTENCE_ENABLED=true` to override `application-e2e.properties`, writing untracked live WAL files into `Poker/data/poker-wal` and corrupting E2E test isolation; B10-2 [Critical] crash recovery fails to truncate torn frame at EOF, causing fatal and permanent WAL corruption on subsequent write; B10-3 [High] `replaceAtomically` throws on filesystems without atomic move support and lacks standard rename fallback; B10-4 [High] transient Windows file locks during `EncryptedWalStore.delete()` mark persistence subsystem globally unhealthy; B10-5 [Medium] unbounded memory leak in `LogThrottler` and aspect lock registries (consolidated B6-5/B9-7); B10-6 [Low] `MdcUtils` fails to clear context keys when passed `null` values; B10-7 [Low] missing defensive `validateRoomId` on `compact`, `delete`, and `walSize`.

B10 complete seven findings validated: Critical B10-1/B10-2, High B10-3/B10-4, Low B10-6/B10-7 (B10-5 merged B6-5/B9-7).

- X1 focused non-Spring checks: `payloads.test.ts`, `api.test.ts`, `GameSession.test.ts`: exit 0, 112 tests passed (3.10s).
- X1 review independently confirmed: X1-1 [High] `applyGameState` omits `gameId`, leaving `snapshot.gameState.gameId` undefined, disabling `pokerApi.leaveGame` and state-change detection; X1-2 [High] `GameView` passes live `gameState` instead of `gameEndResult.finalState` to `GameReviewView`, producing empty community board and empty player standings on review reload; X1-3 [High] `claimWin` cross-stack deadlock caused by eliminated spectators blocking terminal `GAME_END` broadcast (consolidated B5-9); X1-4 [Medium] public broadcast of private all-in conversion notification leaks player identity and confuses opponents; X1-5 [Medium] `GAME_STARTED` lobby event rejected by frontend payload decoder as invalid room update; X1-6 [Medium] `ResultDock` misrepresents unequal side-pot showdowns as equal-split ties (consolidated B4-1/B8-2); X1-7 [Low] missing showdown data in `buildPublicGameStateResponse` renders blank result dock on browser refresh (consolidated B8-1); X1-8 [Low] non-standard 401 Unauthorized JSON body emitted by `JwtAuthenticationFilter` (consolidated B8-7).

X1 complete eight findings validated: High X1-1/X1-2 (X1-3 merged B5-9), Medium X1-4/X1-5 (X1-6 merged B4-1/B8-2), Low (X1-7 merged B8-1, X1-8 merged B8-7).

- X2 deep cross-stack trace independently confirmed on pro (Argon): X2-1 [Critical] server restart reconnection trap where `handleWebSocketConnectListener` bypasses `markPlayerReconnected` when in-memory pending disconnect entry is absent, permanently trapping player in `isDisconnected=true`; X2-2 [Critical] victory theft via `claimWin` by eliminated 0-chip opponents during showdown/ready countdown due to deferred `isOut` cleanup (consolidates B5-1/B8-3); X2-3 [High] post-terminal scheduled task execution mutates ended game state and overwrites review screen (consolidates B5-2); X2-4 [High] mid-hand forfeit pot annihilation & terminal balance desynchronization where unawarded pot chips are permanently destroyed (consolidates B4-3); X2-5 [High] eliminated spectators block terminal resolution on `leaveGame` / `claimWin`, permanently deadlocking lone survivor (consolidates B5-9/X1-3); X2-6 [Medium] silent session eviction on JWT expiration without user feedback leading to domain grace expiry; X2-7 [Medium] cross-tab storage race clears replacement authentication on stale leave completion (consolidates F3-1).

X2 complete seven findings validated: Critical X2-1/X2-2, High X2-3/X2-4/X2-5, Medium X2-6/X2-7. All 18 review areas complete! Final synthesized findings report and UX importance ranking established.

- Tier 1 re-review (B3 → B2 → B4) on pro (Argon):
  - **B3:** Verified existing B3-1..11 and H3-1; added and validated B3-12 [Medium] (`RAISE` accepted when `currentHighestBet == 0` and `CALL` silently accepted as 0-chip `CHECK` when `currentHighestBet == player.getCurrentBet()`), B3-13 [Medium] (`AUTO_ADVANCING` in `PlayerActionService` omits `PublicGameStateResponse` broadcast for 4,000 ms and projects stale `currentPlayer`), and B3-14 [Low] (`resetForNewHand` omits `actedPlayersInRound.clear()` and `removePlayerFromGame` leaves departed player ID in `actedPlayersInRound`).
  - **B2:** Verified B2-1 [High] (`compareHighCard` descending producer vs ascending consumer) and confirmed single-player 5-of-7 `HIGH_CARD` selection, all 9 other `HandRank` categories, wheel straights, bidirectional showdown tie detection, `Card`, `Deck`, and snapshot restoration have no additional defects.
  - **B4:** Verified existing B4-1..3 and H4-1; added and validated B4-4 [High] (`computePotAllocationsAndUncalled` refunds uncalled chips to folded sole contributors and merges all-folded upper side-pot layers into `allocations.getFirst()` — the lowest main pot — instead of the highest live side pot), B4-5 [High] (`conductShowdown` `showdownPlayers.size() == 1` shortcut bypasses side-pot/refund decomposition when a deep-stack contender leaves during `AUTO_ADVANCING`), and B4-6 [Medium] (`getPotBreakdown()` and `getUncalledAmount()` misclassify live mid-street bets and unacted blinds whenever any player is all-in).
- Tier 2 re-review (X2 → B5 → F6):
  - **X2:** Verified and extended X2-1..7 (including `PersistenceRecovery.java:128-160` startup race and `cleanupDisconnectedUser` aborting at `WebSocketEventListener.java:207` without clearing `isDisconnected`), refined X1-1 (`gameId` fallback to `roomId` breaking cross-hand transition detection in `ActionPanel` and `GameSession`), and added X2-8 [High] (`LEAVE_REVIEW` / `leaveGame` on completed games removes winner and re-runs `handleGameEnd` crowning 0-chip loser), X2-9 [High] (`GameView.tsx:82, 124, 130` Leave buttons call raw `clearAuth` instead of `LEAVE_GAME`), X2-10 [Medium] (cross-tab room switch via `localStorage` disconnects active room without calling `leaveGame`/`leaveRoom`), X2-11 [Medium] (clock skew on `readyCountdownDeadlineEpochMs` drops `SHOWDOWN` hydration snapshots or prematurely unmounts `ResultDock`), and X2-12 [Medium] (unhandled `PersistenceException` returns misleading `ACTION_REJECTED` while serving uncommitted in-memory state on reads).
  - **B5:** Verified and extended B5-1..13 (extending B5-1 to the 3-player spectator blocking case) and added B5-14 [Critical] (`resetForNewHand` and `startNewHand` never clear `scheduledTaskDeadlines`, allowing stale `AUTO_ADVANCE`/`READY_OPEN` tasks to block actions or auto-deal streets in the next hand), B5-15 [High] (`markPlayerDisconnected` during ready countdown prematurely starts next hand with 1 connected player and retains `readyForNextHand = true`), B5-16 [High] (`handleReadyCountdownTimeout` and `resumeRecoveredTimers` start a new hand and post blinds when 0 players are connected), B5-17 [High] (`startReadyCountdown` and `markPlayerDisconnected` lack terminal guards and `executeScheduledTask(AUTO_ADVANCE)` re-schedules post-showdown tasks on `SHOWDOWN`), B5-18 [High] (`leaveGame` during `SHOWDOWN` sets `isForfeit = false` and `buildFinalStateResponse` reveals all unshown hole cards from fold-win hands), B5-19 [Medium] (`claimWin` with 2+ disconnected opponents mutates and broadcasts per removal and can trigger `completeReadyCountdownAndStartNextHand` mid-loop), B5-20 [Medium] (`readyCountdownTimeouts.put` races immediate execution and `deadline == null` in `resumeRecoveredTimers` permanently hangs `readyCountdownActive`), and B5-21 [Low] (missing default initializer on `configuredReadyCountdownMs` and duplicated `openReadyCountdownGate`).
  - **F6:** Resolved contract questions Q1–Q4 and added F6-1 [High] (`ActionPanel` shows both `Call {fullCallAmount}` and `All In {chips}` when short-stacked `availableChips <= callAmount`), F6-2 [Medium] (`ActionPanel` `3BB`, `1/2 POT`, and `POT` presets omit `callAmount` and collapse to `minRaiseAmount` when facing a bet), F6-3 [Medium] (`ActionPanel` state reset relies on `gameState.gameId` changing across hands and leaves `pendingAction` stuck after rejected non-amount actions), F6-4 [Medium] (`ActionPanel` `SHOWDOWN` fallback renders dead `0s` countdown, mislabels mid-game hands as `'Final hand complete — reviewing board'`, and disables `UNREADY`), F6-5 [High] (`ResultDock` misrepresents multi-winner side-pot hands as equal split ties; consolidated with B4-1/B8-2/X1-6), F6-6 [High] (`GameTableView` and `ResultDock` omit `player.chips > 0` and `isReadyCountdownActive`, showing an active `READY` button to newly busted 0-chip players and during the 6s final-hand/pre-countdown windows while inflating `readyEligibleCount`), F6-7 [Low] (`ResultDock` renders redundant `"Won the round"` alongside `"{winner} won!"`), F6-8 [Medium] (`GameSession` `PLAYER_NOTIFICATION` handler does not release `'READY'`/`'UNREADY'` action locks on server rejection, freezing the button for 3s), F6-9 [Low] (card normalization mismatch between `payloads.ts`/`formatHandRank` and `getShowdownHoleCardState`/`CardUI`), and F6-10 [Low] (`NotificationBanner` progress bar does not restart on repeated identical messages).
- Tier 3 re-review (F4 → F5 → X1 → B8):
  - **F4:** Verified and extended F4-1..2 and added F4-3 [High] (`GameSession.applyGameState` never sets `roomState.gameStarted = true`, and `useGameWebSocket` drops `roomData` on concurrent `/room/{roomId}` frames and aborts recovery when `currentRoom.gameStarted` is `false`), F4-4 [High] (`applyGameState` returning `false`, rejected private/room payloads, and `getPrivateState` errors during initial hydration silently complete without retry or redirect), F4-5 [Medium] (`useGameWebSocket` recovery omits `playerStillInRoom` check, stranding evicted lobby players on reconnect/wakeup), F4-6 [Medium] (`useGameWebSocket` `isCancelled()` ignores `session.disconnect()`, `cancelRecovery()`, and pending redirects, allowing `visibilitychange`/`online` to reconnect the socket and restart recovery during `LEAVE_GAME` or `ROOM_CLOSED`), F4-7 [Low] (`onStompError` auth-failure `'disconnected'` status overwritten by `GameSession.handleTransportError` to `'reconnecting'` and missing `lifecycleGeneration` guard in `forceReconnect()`), and F4-8 [Low] (`failInitialLoad()` marks hydration complete without private cards if a superseded attempt already applied `gameState`).
  - **F5:** Verified F5-1, resolved open contract questions, and added F5-2 [High] (pre-hydration/pre-table Leave buttons bypass `LEAVE_GAME` and `useGameDispatcher` skips `leaveGame` when `gameState` is `null`; consolidated with X2-9/B1-2), F5-3 [High] (`CLAIM_WIN` relies exclusively on a one-shot STOMP `GAME_END` broadcast while `GameController.getAuthorisedGame` immediately returns `404` on `isGameOver()`, causing missed `GAME_END` frames to redirect the winner to the lobby as `SESSION_EXPIRED`), F5-4 [Medium] (`GameReviewView` ignores `gameEndResult.finalState` prop fallback, marks dual `WINNER` badges when `finalState` is rejected due to `maxPlayers = 0`, and renders standings in raw seat order; refines X1-2), F5-5 [High] (`START_GAME` in `useGameDispatcher` resets `isStartingGame` immediately on HTTP 200 without updating `roomState.gameStarted` or triggering state sync, re-enabling the Start button before `/game/{roomId}` STOMP delivery), F5-6 [Medium] (`GameTableView` hero resolution `me`, `isMyTurn`, `LiveTableStage`, and `OpponentSeats` omit the `effectivePlayerName` fallback when `myPlayerId` is `null`), F5-7 [Medium] (`GameTableView` `CLAIM THE WIN` overlay collides with `RoomDock`, `disconnectedPlayer` banner can display hero's own name, and banner shifts `LiveTableStage` height), F5-8 [Low] (duplicate Leave button without confirmation in mobile landscape dock), and F5-9 [Low] (`GameView.tsx:122` hardcodes `playerCount={0}` and `LEAVE_REVIEW` omits `session?.disconnect()` while calling `leaveGame` on an ended game).
  - **X1:** Re-verified X1-1/X1-2/X1-5 and downgraded all three to Low (X1-1: gameId falls back to roomId so leaveGame is reachable, real issue is gameId invariance across hands; X1-2: maxPlayers=0 on null room only in buildFinalStateResponse and no reachable caller found; X1-5: only a logger.warn plus delayed roomState.gameStarted). Added X1-9 [Medium] (lobby UI cannot create/join password-protected rooms), X1-10 [Low] (client/server name sanitizer mismatch: HTML-tag rule and zero-width characters), X1-11 [Low] (PLAYER_NOTIFICATION leaves action lock; merged into F6-8). Verified no defect in ACTION_ERROR code/action validation, private-state/room payload validators, identity reconciliation, and creation limits. X1-3/4/6/7/8 not re-verified this pass. First X1 reviewer run failed with a quota error and was rerun.
  - **B8:** Re-verified B8-1..7 with exact lines (B8-2 merged into B4-1, B8-3 into B5-1). Added and validated B8-8 [Medium] (`buildFinalStateResponse` emits `maxPlayers = 0` when `room == null`, violating frontend capacity schema and breaking review hydration), B8-9 [Medium] (`GameController.getAuthorisedGame` returns 404 when `game.isGameOver()` is true, breaking review screen hydration on reload), B8-10 [Low] (`WebSocketExceptionHandler` sends `PLAYER_NOTIFICATION` instead of `ACTION_ERROR` for ready/unready failures, leaving action locks uncancelled in `GameSession`), B8-11 [Low] (`resolvePlayerStatus` prioritizes `DISCONNECTED` over `FOLDED`, triggering table-wide reconnect banners for folded players), and B8-12 [Low] (`GET /api/room/{roomId}` lacks room-membership authorization check, exposing metadata across rooms). All 12 B8 findings recorded and confirmed.
- Tier 4 re-review (B6 → B1 → F3 → F1):
  - **B6:** Verified B6-1..6 and added B6-7 [High] (duplicate/trailing disconnect event extends disconnect grace deadline, desynchronizing runtime cleanup from domain state), B6-8 [High] (`scheduleRecoveredDisconnect` unsynchronized with `sessionLock` races early client reconnects on startup), B6-9 [High] (brief disconnect or browser refresh during ready countdown prematurely forces next hand and deals cards to disconnected player), B6-10 [Medium] (`markPlayerDisconnected` lacks `isGameOver()` guard, broadcasting active table state and mutating ended games), B6-11 [Medium] (`markPlayerDisconnected` fails to clear `readyForNextHand`, leaving disconnected players projected as ready), and B6-12 [Medium] (`AggregateSnapshotMapper.toState(Game)` unsynchronized reads of mutable `ArrayList` collections during WAL serialization).
  - **B1:** Verified B1-1..3 and added B1-4 [High] (`roomService.leaveRoom` lacks atomic host reassignment, dropping host when multiple players depart simultaneously), B1-5 [High] (concurrent join race on capacity allows room size to exceed `maxPlayers`), B1-6 [Medium] (`POST /api/room/{roomId}/start-game` fails to check minimum player count `players.size() >= 2` inside controller), B1-7 [Medium] (`RoomService.destroyRoom` leaks active games and fails to notify connected clients when empty room is deleted), B1-8 [Medium] (`RoomService.joinRoom` does not check if game has already started, permitting late joins during live poker play), B1-9 [Low] (`RoomDataResponse` joinedAt fallback missing zone identifier), B1-10 [Low] (`getRoomData` emits `canStartGame: true` when `gameStarted: true`), and B1-11 [Low] (controller pre-validation gap writes orphaned PREPARE records to WAL).
  - **F3:** Verified F3-1 and added F3-2 [High] (orphaned `GameSession` timer and transport leak on auth replacement in `GameProvider.tsx`, leading to replacement session eviction), F3-3 [High] (stale `poker-game-end:{roomId}` storage trap: skips hydration, hijacks new room sessions, and evicts active room on `LEAVE_REVIEW`), F3-4 [High] (`GameSession.applyGameState` lacks domain-level revision/timestamp guards, enabling silent state rollback from delayed REST hydration or out-of-order snapshots), F3-5 [Medium] (`scheduleRedirect` and `ROOM_CLOSED` keep STOMP subscriptions and transport active during 3s redirect countdown), F3-6 [Medium] (`GameSession.handleRoomMessage` ignores local player eviction on `PLAYER_LEFT`, stranding evicted lobby/table players without redirect), F3-7 [Medium] (`GameSession.scheduleShowdownHide` timer clears `showdownResult` while `phase === 'SHOWDOWN'`), and F3-8 [Low] (dead assignment `nextShowdownResult = null` and constructor `myPlayerId = null` initialization gap with `initialGameState`).
  - **F1:** Verified F1-1..3 and added F1-4 [Medium] (UI completely omits password inputs in `CreateRoomForm` and `JoinRoomForm`, permanently locking web users out of password-protected rooms), F1-5 [Low] (error message extraction in `api.ts:getErrorMessage` bypasses `normalizeErrorMessage`, exposing raw HTML/JSON markup in lobby alert toasts), F1-6 [Low] (contract mismatch in form sanitization: client `validation.ts` accepts HTML tags `<[^>]*>` that backend `InputSanitizer.java` rejects with HTTP 400), and F1-7 [Low] (asymmetric auth validation between `api.ts:normalizeAuthResponse`, `useAuthSession.ts:setAuth`, and `loadAuthStateFromStorage`).
- Tier 5 re-review (F7 → B7):
  - **F7:** Re-verified F7-1 [Low] (input label contrast ~3.85:1 vs 4.5:1 WCAG minimum) and added F7-2 [High] (`MIN_MOBILE_HEIGHT = 375` locks out standard mobile phones in landscape mode with browser UI chrome), F7-3 [High] (pot phase text contrast 1.16:1 against `#6fad95` radial felt center), F7-4 [Medium] (desktop height gating `< 600px` displays `<RotatePrompt>` telling desktop users to rotate device), F7-5 [Medium] (ghost button text contrast 3.44:1 on `#20201f`), F7-6 [Medium] (opponent seat popover missing Escape key dismiss and close button), F7-7 [Medium] (missing `aria-live="polite"` on showdown outcome and active turn transition), F7-8 [Low] (`100vh` in `min-h-screen` causing vertical scroll bounce on mobile browsers), F7-9 [Low] (`getSeatAngle` division by zero produces `NaN` when `opponentCount <= 1`), and F7-10 [Low] (`TablePots.tsx` zoom/fade animations bypass `@media (prefers-reduced-motion)`).
  - **B7:** Re-verified B7-1..8 with exact lines and added B7-9 [High / Critical] (lack of `SEND` frame destination and authorization checks in `WebSocketAuthInterceptor` permits arbitrary message injection and topic spoofing via the simple broker), B7-10 [High] (stateless JWT token re-use and player identity impersonation on username collision / re-join), B7-11 [Medium] (cleartext room passwords stored in memory and WAL snapshots, evaluated with timing-vulnerable `String.equals`), B7-12 [Low / Informational] (permissive WebSocket handshake origin fallback defaults to wildcard `*`), and B7-13 [Low] (technical error messages leaked via `WebSocketExceptionHandler.technicalMessage` on non-action STOMP errors).
- Tier 6 re-review (B9 → B10 → F2 → F8):
  - **B9:** Re-verified B9-1..10 with exact lines and added B9-11 [High] (unsynchronized collection reads during snapshot serialization in `AggregateSnapshotMapper.toState` risk `ConcurrentModificationException` and aggregate commit aborts), B9-12 [High] (`GameRestoreBuilder.build()` throws `ArithmeticException: / by zero` when restoring game with empty players list), B9-13 [Medium] (missing null safety across `GameRestoreBuilder.build()` collections causes `NullPointerException` on partial or legacy snapshots), B9-14 [Medium] (restored `Player.handRank == null` causes `NullPointerException` during next hand determination), and B9-15 [Medium] (unsynchronized iteration of `playersWithJoinTime` in `Room.getPlayersWithJoinTimeSnapshot()` causes `ConcurrentModificationException` during WAL serialization).
  - **B10:** Re-verified B10-1..7 with exact lines and added B10-8 [Critical] (single un-deserializable room or runtime error crashes entire server startup in PersistenceRecovery.run()), B10-9 [Medium] (walSize() returning Long.MAX_VALUE on transient I/O exception forces premature compaction and causes global persistence shutdown), B10-10 [Medium] (compaction failure and crash recovery leave orphaned .wal.compacting files on disk without cleanup), B10-11 [Medium] (PersistenceHealthIndicator reports UP when persistence storage directory is unmounted or inaccessible), B10-12 [Low] (EncryptedWalStore.recoverLatest(roomId) omits oomLocks synchronization), and B10-13 [Low] (decrypted historical payload retention in EncryptedWalStore.readWal() creates heap memory spikes during restart).
  - **F2:** Re-verified runtime decoders and tests (74 passed) and added F2-1 [Medium] (`getErrorMessage` in `api.ts` bypasses `normalizeErrorMessage` and returns unbounded raw HTML / stack traces on non-JSON errors), F2-2 [Low] (`isJwtValid` lacks clock skew tolerance and UTF-8 handling), F2-3 [Low] (`api.ts` does not normalize trailing slashes on `VITE_API_BASE_URL`, generating duplicate forward slashes rejected by Spring Boot `StrictHttpFirewall`), F2-4 [Low] (asymmetric `joinedAt` validation between `isRoomDataPayload` and `isRoomUpdatePayload`), and F2-5 [Low] (`logger.ts` `redactString` misses URL query parameters, risking credential leakage in error/debug logs).
  - **F8:** Re-verified build/deploy infrastructure and added F8-4 [High] (Playwright E2E configuration omits `--poker.persistence.enabled=false`, enabling disk persistence and corrupting test isolation; consolidates with B10-1), F8-3 [Low] (public API-base examples in `.env.example` and deployment docs omit the required `/api` prefix), and F8-5 [Low] (`nginx.conf` sets immutable year-long caching on unversioned public assets).

## Tier 3 Implementation & Verification Completion

Completed 2026-10-29. All 5 Tier 3 findings (`F4-1`, `F5-3`, `B8-9 / F5-4`, `B8-1`, `X1-9`) implemented and verified across `Poker` and `frontend-poker` via 10 fine-grained vertical slices (plus 1 remediation slice):

### Discrete Vertical Slice Commits

- **`Poker` (Backend):**
  - `a1b1647`: `fix(B8-1/S1): nullify active turn pointer and currentPlayer during showdown countdown`
    - Nullifies active turn pointer and `currentPlayer` during showdown countdown while preserving showdown winner and card projections.
  - `84c496f`: `fix(B8-1/S2): retain settlement winners and cards across intermediate ready updates`
    - Retains settlement winners, hole cards, and chip counts across intermediate ready toggles via `ConcurrentHashMap`.
  - `2781b24`: `fix(B8-9/S1): authorize terminal review queries and clamp finalState maxPlayers`
    - Authorizes terminal review queries on completed games, validates room/player token parameters, and clamps `finalState.maxPlayers` within bounds `[2, 10]`.
  - `31ba381`: `fix(F5-3/S1): return GameEndResponse on claim-win and expose terminal review endpoint`
    - Returns authoritative `GameEndResponse` directly from `POST /api/game/{roomId}/claim-win` under room lock and exposes terminal review query endpoint to eliminate STOMP-only recovery deadlocks.

- **`frontend-poker` (Frontend):**
  - `fec4275`: `fix(X1-9/S1): add password validation and submission normalization in lobby utils`
    - Adds password validation rules (length <= 50, control character rejection) and submission normalization in lobby utilities.
  - `9c73f02`: `fix(X1-9/S2): render optional password fields in create and join table forms`
    - Renders optional password inputs in `CreateRoomForm` and `JoinRoomForm` with accessibility attributes and submission wiring.
  - `ef71673`: `fix(F5-4/S1): sort final standings by stack and enforce exclusive tournament winner badge`
    - Sorts final standings descending by final chip stack (ties broken by seat index) and enforces exclusive tournament winner badge.
  - `d71f683`: `fix(F4-1/S1): abort superseded recovery attempts and track monotonic attempt revisions`
    - Implements monotonic `attemptId` and aborts superseded REST recovery attempts to prevent state corruption.
  - `930496f`: `fix(F4-1/S2): guard private REST state against delayed superseded recovery responses`
    - Guards private REST state application against late superseded responses, ensuring rollback isolation.
  - `63a8625`: `fix(F5-3/S2): consume direct claim-win response and fallback to terminal review on 404`
    - Consumes direct HTTP `GameEndResponse` on claim-win and falls back to `/api/game/{roomId}/review` on HTTP 404.
  - `02fb6fe`: `fix(F5-3/S2): resolve session sync abort deadlock and clean up api signatures`
    - Remediation resolving cancellation deadlock in `sessionSync.ts` and replacing mock fixture token checks in `api.ts` with authentic runtime type checks.

### Verification & Quality Gate Sign-Off

- **Automated Backend Verification (`Poker`):**
  - 173 backend tests passed across `GameStateServiceTest`, `GameLifecycleServiceTest`, and `GameControllerTest` (`mvnw test`).
  - 0 test failures, 0 errors, BUILD SUCCESS.
- **Automated Frontend Verification (`frontend-poker`):**
  - 1000 unit and integration tests passed across 65 test files (`npm run test -- --run`).
  - `npm run lint`: 0 errors, 0 warnings.
- **Forensic Gatekeeper Audit:**
  - Forensic audit verdict: **CLEAN** (zero hardcoded test outputs or mock fixtures in production code, no facades, authentic logic, full test pass).

## Tier 4 Implementation & Verification Completion

Completed 2026-10-30. All 5 Tier 4 findings (`B6-2`, `B1-5`, `F3-2`, `F3-3`, `F1-1`) implemented and verified across `Poker` and `frontend-poker` via 10 fine-grained vertical slice commits:

### Discrete Vertical Slice Commits

- **`Poker` (Backend):**
  - `280b741`: `fix(B6-2/S1): synchronize playerExistsInGame to prevent ConcurrentModificationException`
    - Synchronizes `playerExistsInGame` under the `game` monitor to prevent `ConcurrentModificationException` during concurrent player lookup and list mutation.
  - `df6ca51`: `fix(B1-5/S1): enforce maxPlayers capacity invariant in Room.addPlayer`
    - Enforces the `maxPlayers` capacity invariant atomically inside `Room.addPlayer` under the `room` monitor, throwing `IllegalStateException` on capacity breach.
  - `59e0ce8`: `fix(B6-2/S2): synchronize snapshot mapper player extraction and secure disconnect listener`
    - Synchronizes snapshot mapper player extraction under the `game` monitor during WAL serialization and guards disconnect listener player lookups.
  - `9c14bf5`: `fix(B1-5/S2): map room capacity violations to BadRequestException and synchronize joinRoom`
    - Maps room capacity violations to `BadRequestException` (`ROOM_FULL`) in `RoomController` and ensures full synchronization across `RoomService.joinRoom`.

- **`frontend-poker` (Frontend):**
  - `9f4a914`: `fix(F1-1/S1): scope clearAuth to matching token in useAuthSession`
    - Scopes `clearAuth(expectedToken)` to matching token in `useAuthSession` so stale or superseded leave operations cannot wipe out active authentication.
  - `062d4ed`: `fix(F3-3/S1): bind review storage envelope with auth ownership`
    - Binds review storage envelope with explicit token and username auth ownership, validating ownership before loading cached review data.
  - `741a1b8`: `fix(F3-2/S1): isolate GameSession lifecycle across auth replacement epochs`
    - Isolates `GameSession` lifecycle across auth replacement epochs in `GameProvider`, ensuring clean disconnection and disposal of superseded sessions.
  - `274e4ce`: `fix(F1-1/S2): propagate originating token through leave pipeline`
    - Propagates originating auth token through dispatcher and component leave pipeline down to `clearAuth(token)` to prevent accidental cross-session wipeouts.
  - `d381a6c`: `fix(F3-2/S2): key authenticated GameView subtree by auth identity`
    - Keys authenticated `GameView` subtree by auth identity (`token` / `sessionId`) to ensure React fully unmounts and remounts clean component state upon auth change.
  - `c5810cf`: `fix(F3-3/S2): bind game review storage and loading to active auth credentials`
    - Binds game review storage and hydration loading strictly to active auth credentials, eliminating stale review traps and cross-tab session contamination.

### Quality Gate Sign-Off

- **Reviewer 1:** `APPROVE` (All 838 backend tests, 116 frontend tests green, 0 lint errors)
- **Reviewer 2:** `APPROVE` (Strict Room -> Game monitor ordering, 12-thread join races, and CME tests green)
- **Challenger 1:** `APPROVE` (60-thread join storms and 1500-op mutator vs reader snapshot CME stress passed)
- **Challenger 2:** `APPROVE` (Interleaved late leaves and cross-tab review envelope races verified clean)
- **Forensic Auditor:** `CLEAN` (Zero hardcoded test outputs or facades, 209 backend tests, 147 frontend tests green, build clean)

## Tier 5 Implementation & Verification Completion

Completed 2026-10-30. All 5 Tier 5 findings (`F7-2`, `F7-3`, `B7-9`, `B7-10`, `B7-11`) implemented and verified across `Poker` and `frontend-poker` via 10 discrete vertical slice commits:

### Discrete Vertical Slice Commits

- **`Poker` (Backend):**
  - `10871c8` / `f23f340` (`B7-9/S1`): `fix(B7-9/S1): validate SEND frame destination prefix and room authorization`
    - Restores and enforces WebSocket SEND frame destination validation and room authorization in `WebSocketAuthInterceptor`, ensuring destination prefix conforms to `/app/` and authenticated caller is bound to target room.
  - `91f7ee8` (`B7-9/S2`): `fix(B7-9/S2): enforce caller room authorization across all STOMP SEND destinations`
    - Enforces caller room authorization across all STOMP SEND destinations (`/app/chat/{roomId}`, `/app/game/{roomId}/*`, etc.), rejecting cross-room spoofing attempts with security exceptions.
  - `9b9cb44` (`B7-10/S1`): `fix(B7-10/S1): incorporate membership nonce into PlayerPrincipal and JwtService`
    - Incorporates monotonic membership nonce into `PlayerPrincipal` and `JwtService`, binding session identity claims to prevent stateless JWT impersonation on collision.
  - `fc7c185` (`B7-10/S2`): `fix(B7-10/S2): reject stale session JWT tokens on controller endpoints`
    - Rejects stale session JWT tokens with HTTP 401 across REST controller endpoints (`GameController`, `RoomController`) when membership nonce mismatches active room state.
  - `7d96bf1` (`B7-11/S1`): `fix(B7-11/S1): integrate PasswordEncoder and hash Room passwords`
    - Integrates Spring Security `PasswordEncoder` (BCrypt) to hash room passwords in `Room`, preventing cleartext password memory exposure.
  - `f6343fd` (`B7-11/S2`): `fix(B7-11/S2): hash passwords in RoomService and serialize passwordHash in snapshots`
    - Uses `PasswordEncoder` in `RoomService` for password verification/creation and serializes `passwordHash` rather than plaintext in WAL aggregate snapshots.

- **`frontend-poker` (Frontend):**
  - `1d7dd0c` (`F7-2/S1`): `fix(F7-2/S1): lower mobile landscape height gate floor to 320px`
    - Lowers mobile landscape height gate threshold from 375px down to 320px in `PokerRoomLayout`, eliminating lockout on compact mobile landscape viewports.
  - `aa942ca` (`F7-2/S2`): `fix(F7-2/S2): adjust table geometry scale floor for 320px landscape`
    - Adjusts table geometry scale floor and padding calculations in `tableGeometry.ts` to guarantee layout containment and prevent element clipping at 320px landscape height.
  - `6b0ff98` (`F7-3/S1`): `fix(F7-3/S1): enforce accessible >=4.5:1 contrast on pot phase badges`
    - Updates pot phase text and badge styling in `TablePots.tsx` to achieve compliant contrast ratios (>= 4.5:1) meeting WCAG AA requirements.
  - `23f3d7b` (`F7-3/S2`): `fix(F7-3/S2): align board cluster pot container contrast`
    - Aligns board cluster pot container styling and background blending in `BoardCluster.tsx` to maintain contrast compliance across all felt backgrounds.

### Quality Gate Sign-Off

- **Reviewer 1 (`reviewer_tier5_1`):** `APPROVE` (908 backend, 1059 frontend tests passed)
- **Reviewer 2 (`reviewer_tier5_2`):** `APPROVE` (security invariants, 320px geometry, WCAG AA contrast)
- **Challenger 1 (`challenger_tier5_1`):** `APPROVE` (empirical STOMP spoofing, stale token 401s, BCrypt zero cleartext memory)
- **Challenger 2 (`challenger_tier5_2`):** `APPROVE` (215 stress tests on 320px bounds, 31 radial felt gradient contrast calculations 6.18:1 to 19.81:1)
- **Forensic Auditor (`auditor_tier5`):** `CLEAN` (authentic implementations, zero hardcoded test outputs or facades)


## Tier 6 Implementation & Verification Completion

Completed 2026-10-30. All 5 Tier 6 findings (`B9-1`, `B10-2`, `B10-8`, `B10-1/F8-4`, `F2-1`) implemented, remediated, and verified across `Poker` and `frontend-poker` via 10 discrete vertical slice commits plus 2 remediation commits:

### Discrete Vertical Slice Commits

- **`Poker` (Backend):**
  - `ba5510f` (`B9-1/S1`): `fix(B9-1/S1): roll back or evict in-memory aggregate on durable mutation failure`
    - Preserves pre-mutation state snapshots in `RecoveredAggregate` and rolls back or evicts in-memory aggregates in `DurableMutationAspect` when durable mutations throw exceptions.
  - `0e9fabf` (`B9-1/S2`): `fix(B9-1/S2): coordinate aggregate rollback and eviction across RoomService and GameLifecycleService`
    - Coordinates aggregate rollback and eviction across `RoomService` and `GameLifecycleService`, preventing stale state divergence between memory and disk on mutation failure.
  - `2b3933c` (`B10-2/S1`): `fix(B10-2/S1): truncate torn trailing frames to valid offset in EncryptedWalStore.readWal`
    - Detects torn trailing frames at EOF in `EncryptedWalStore.readWal`, logs a warning, and truncates the corrupted trailing bytes to the last valid frame offset.
  - `1d2ffed` (`B10-2/S2`): `fix(B10-2/S2): harden torn frame truncation on partial headers and compaction recovery`
    - Hardens torn frame truncation against incomplete frame header fragments (1–7 bytes) at EOF and handles torn frames cleanly during WAL compaction recovery.
  - `ad59410` (`B10-8/S1`): `fix(B10-8/S1): add quarantine capability for corrupted room WAL files in EncryptedWalStore`
    - Adds `quarantine(roomId, reason)` to `EncryptedWalStore`, atomically isolating unrecoverable WAL files to `.wal.corrupted` and purging them from active in-memory failed state.
  - `6d6ad3a` (`B10-8/S2`): `fix(B10-8/S2): quarantine corrupted room aggregates during startup recovery`
    - Wraps per-room recovery in `PersistenceRecovery` with error isolation, quarantining corrupted rooms on startup so uncorrupted rooms continue to restore cleanly.
  - `1ba6ad9` (`B10-1/S1`): `fix(B10-1/S1): enforce persistence disabled override in e2e profile`
    - Enforces persistence disabled override (`poker.persistence.enabled=false`) under the Spring Boot `e2e` profile in `application-e2e.properties` and validates precedence via `ConfigContractTest`.
  - `c11db1f` (`B10-8/remediate`): `fix(B10-8/remediate): quarantine corrupted WALs in recoverAll and snapshot identity mismatch`
    - Catches unhandled runtime exceptions in `EncryptedWalStore.recoverAll()` to quarantine corrupted WAL files and isolates snapshot room identity mismatches in `PersistenceRecovery` via quarantine without aborting recovery.

- **`frontend-poker` (Frontend):**
  - `e47cef5` (`F8-4/S1`): `fix(F8-4/S1): pass persistence disabled CLI arg in Playwright webServer`
    - Configures Playwright `webServer` command in `playwright.config.ts` with `--poker.persistence.enabled=false` and `--spring.profiles.active=e2e`, isolating test runs from production persistence.
  - `673075e` (`F2-1/S1`): `fix(F2-1/S1): route non-JSON HTTP responses through normalizeErrorMessage`
    - Routes non-JSON HTTP error responses (502, 503, 504 HTML error gateways) in `api.ts` through `normalizeErrorMessage` instead of rethrowing raw response text.
  - `c4f5b4b` (`F2-1/S2`): `fix(F2-1/S2): sanitize and bound error messages in normalizeErrorMessage`
    - Sanitizes, strips HTML tags, escapes control characters, bounds length (256 chars), and provides safe fallback messages in `payloads.ts` for all non-JSON error payloads.
  - `5598602` (`F2-1/remediate`): `fix(F2-1/remediate): fix test TypeScript compilation and payload regex lint directive`
    - Resolves test mock typings across `BoardCluster.test.tsx`, `GameReviewView.test.tsx`, `GameProvider.ownership.test.tsx`, and `claimRecovery.test.ts`, cleans up untracked temporary test debris, and suppresses ESLint control character regex rule.

### Quality Gate Sign-Off

- **Lead Reviewer (`reviewer_tier6_1`):** Remediation requested for `recoverAll()`, snapshot mismatch quarantine, and TS compilation; re-verified by `reviewer_tier6_recheck`.
- **Invariants Reviewer (`reviewer_tier6_2`):** `APPROVE` (Concurrency and persistence invariants pass, 86 persistence tests green).
- **Backend Concurrency Challenger (`challenger_tier6_1`):** `APPROVE` (7/7 adversarial persistence tests pass, 85/85 persistence tests pass, 940/940 full backend suite tests pass).
- **Frontend Scoping Challenger (`challenger_tier6_2`):** `APPROVE` (129 empirical adversarial tests passed covering HTML injection, stack traces, bounding, and character escaping).
- **Forensic Auditor (`auditor_tier6`):** `CLEAN` (Binary integrity veto passed: 0 hardcoded test results, 0 facades, authentic rollback and quarantine state).
- **Recheck Reviewer (`reviewer_tier6_recheck`):** `APPROVE` (86 backend persistence tests green, `npm.cmd run build` exits 0, `npm.cmd run lint` clean, 170 targeted frontend tests green).
