# Frontend Poker

Plain-English domain vocabulary and code terms for the multiplayer poker client.

## Session, Auth & Networking

**GameSession**:
The client-side controller for an active table that holds the current room, public game, and private card state, processes server updates, and runs countdown timers outside of React components.
_Avoid_: GameContext, GameStore, GameController

**GameTransport**:
The real-time messaging connection between the browser and the server—backed by STOMP over WebSockets in production and an in-memory fake in tests.
_Avoid_: WebSocketClient, SocketWrapper, NetworkBridge

**SessionSnapshot**:
A read-only snapshot of the current room, table, and connection state that `GameSession` hands to React (`useSyncExternalStore`) whenever the UI needs to re-render.
_Avoid_: ContextState, GlobalState, StoreSnapshot

**AuthSession (`useAuthSession`)**:
The login credentials (`roomId`, `playerName`, and JWT `token`) stored in a single browser tab's `sessionStorage` so a user can open multiple tabs as different players without them overwriting each other.
_Avoid_: UserContext, UserCredentials, LocalLogin

**Session Hydration (`useSessionHydration`)**:
The initial REST fetch when opening or refreshing a room that loads the current room and game state from the server before live WebSocket updates take over.
_Avoid_: InitialSync, BootstrapFetch

## Table Presentation & Gameplay

**HeroSeat**:
The bottom-center seat on the poker table reserved for the local player viewing the screen.
_Avoid_: LocalPlayerSeat, UserAnchor, CenterPod

**tableGeometry (`useSeatLayout`)**:
The layout math module that sizes the table to fit its container and spaces 2 to 10 players evenly around the oval table relative to `HeroSeat`.
_Avoid_: ParametricSeating, SeatLayout, TableGrid, CoordinateMap

**GamePhase**:
The current stage of a poker hand: `PRE_FLOP`, `FLOP`, `TURN`, `RIVER`, or `SHOWDOWN`.
_Avoid_: HandPhase, Street, RoundStatus

**PokerAction**:
A gameplay move chosen by the player whose turn it is: `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE`, or `ALL_IN`.
_Avoid_: TableAction, Move, TableCommand, UserAction

## Post-Match Review & Local Storage

**GameReviewView (`GameEndResult`)**:
The end-of-game screen (`GameReviewView`) and final match data (`GameEndResult`) showing the winner, final standings, and final board after the match finishes.
_Avoid_: GameReview, GameOverScreen, SummaryView, EndGameDialog

**PersistedGameEndEnvelope (`gameEndStorage`)**:
The wrapper saved in the browser tab's `sessionStorage` (`poker-game-end:<roomId>`) that pairs the final `GameEndResult` with the player's `roomId`, `playerName`, and `token` so the end-of-game screen still works after a page refresh even if the server has already deleted the finished room.
_Avoid_: GameEndEnvelope, ResultCache, ReviewStorage, TerminalState

## Validation, Errors & Logging

**payloads (`decodePublicGameState`, `decodePrivatePlayerState`, `decodeRoomUpdate`)**:
Runtime validation functions in `src/lib/payloads.ts` that check every incoming REST response and WebSocket message to make sure its fields have the expected types before the app uses them.
_Avoid_: PayloadDecoder, TypeCaster, JsonParser, ResponseUnwrapper

**normalizeErrorMessage**:
The helper in `src/lib/payloads.ts` that cleans up server error responses into short, safe user-facing messages by stripping out raw HTML pages, stack traces, and overly long text.
_Avoid_: NormalizedError, ErrorResponse, RawError, ServerFault

**logger (`src/security/logger.ts`)**:
The development console logger that automatically replaces tokens, passwords, and private hole cards with `[REDACTED]` so secrets are never printed to the browser console.
_Avoid_: DiagnosticRedaction, LogSanitizer, ConsoleMasking, DataFilter