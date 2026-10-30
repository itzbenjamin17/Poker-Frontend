# 0011: Runtime Payload Decoding and Validation Boundary

We decided to process all incoming REST responses and STOMP WebSocket frames through explicit runtime decoders in `src/lib/payloads.ts` rather than relying on TypeScript compile-time type assertions.

## Context

TypeScript interfaces and type declarations are completely erased during JavaScript compilation. In real-time web applications, assuming that network responses conform to static interfaces (via `res.json() as GameStatePayload` or `JSON.parse(frame.body) as RoomEvent`) introduces silent failures. If the backend adds null fields, changes property names, or serializes unexpected enum variants, unvalidated payloads cause unhandled runtime exceptions inside React components (such as `TypeError: Cannot read properties of undefined`), crashing the UI.

## Decision

1. **Explicit Decoder Boundary**: Pass every inbound network response through a dedicated decoder function (`decodeGameStatePayload`, `decodePrivatePlayerPayload`, `decodeRoomDataResponse`, `decodeGameEndResult`).
2. **Defensive Normalization**:
   - Verify required primitive types (`typeof x === 'string'`, `typeof x === 'number'`).
   - Provide safe defaults for optional fields (e.g. empty arrays for missing side pots or player action lists).
   - Sanitize string fields and validate enum literals against known domain sets.
3. **Fail-Safe Parsing**: If an incoming payload is structurally corrupt or unparseable, log a redacted warning and discard the frame or trigger a graceful error banner rather than allowing the React component tree to crash.

## Consequences

- Prevents malformed or unexpected backend payloads from crashing the React rendering tree.
- Decouples client runtime stability from minor backend DTO variations or nullability changes.
- Requires maintaining explicit decoding logic alongside TypeScript type interfaces.
