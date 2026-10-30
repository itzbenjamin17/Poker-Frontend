# Frontend Poker

Domain vocabulary and ubiquitous language for the multiplayer poker client.

## Core Session & Transport

**GameSession**:
The in-process domain model that encapsulates table state transitions, hand progression, and timer lifecycles.
_Avoid_: GameContext, GameStore, GameController

**GameTransport**:
The communication port that abstracts real-time message exchange between the client and game server.
_Avoid_: WebSocketClient, SocketWrapper, NetworkBridge

**SessionSnapshot**:
An immutable state projection produced by GameSession for UI presentation and test assertion.
_Avoid_: ContextState, GlobalState, StoreSnapshot

**AuthSession**:
The tab-scoped credentials and player identity bound to a specific room.
_Avoid_: UserContext, UserCredentials, LocalLogin

## Table Presentation & Geometry

**HeroSeat**:
The reserved table position at bottom-center anchored to the local authenticated player.
_Avoid_: LocalPlayerSeat, UserAnchor, CenterPod

**ParametricSeating**:
The dynamic elliptical positioning system that spaces opponent seats evenly around the table oval.
_Avoid_: SeatLayout, TableGrid, CoordinateMap

**HandPhase**:
The current stage of a poker hand: Pre-Flop, Flop, Turn, River, or Showdown.
_Avoid_: GameState, Street, RoundStatus

**TableAction**:
A gameplay move published by an active player: Fold, Check, Call, Bet, or Raise.
_Avoid_: Move, TableCommand, UserAction

## Post-Match & Storage

**GameReview**:
The terminal post-match screen presenting champion-ordered standings and game summaries.
_Avoid_: GameOverScreen, SummaryView, EndGameDialog

**GameEndEnvelope**:
An auth-bound local cache entry preserving terminal review data across reloads.
_Avoid_: ResultCache, ReviewStorage, TerminalState

## Safety & Boundaries

**NormalizedError**:
A sanitized, length-bounded user-facing error message stripped of HTML tags, doctypes, and stack traces.
_Avoid_: ErrorResponse, RawError, ServerFault

**PayloadDecoder**:
A defensive runtime validation boundary that verifies and normalizes incoming network messages before consumption.
_Avoid_: TypeCaster, JsonParser, ResponseUnwrapper

**DiagnosticRedaction**:
A privacy boundary that strips sensitive credentials and secret cards from diagnostic logs.
_Avoid_: LogSanitizer, ConsoleMasking, DataFilter
