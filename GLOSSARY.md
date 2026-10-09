# Frontend Poker

Domain vocabulary and ubiquitous language for the multiplayer poker client.

## Language

**GameSession**:
The in-process domain model that encapsulates table state transitions, hand progression, and timer lifecycles.
_Avoid_: GameContext, GameStore, GameController

**GameTransport**:
The communication port that abstracts real-time message exchange between the client and game server.
_Avoid_: WebSocketClient, SocketWrapper, NetworkBridge

**SessionSnapshot**:
An immutable state projection produced by GameSession for UI presentation and test assertion.
_Avoid_: ContextState, GlobalState, StoreSnapshot

**HandPhase**:
The current stage of a poker hand: Pre-Flop, Flop, Turn, River, or Showdown.
_Avoid_: GameState, Street, RoundStatus

**TableAction**:
A gameplay move published by an active player: Fold, Check, Call, Bet, or Raise.
_Avoid_: Move, TableCommand, UserAction
