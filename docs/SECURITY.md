# Security Overview - Vault Poker

## Authentication
- **JWT (JSON Web Tokens):** All non-public REST and WebSocket communication is secured via stateless JWT authentication.
- **Persistent Sessions:** Tokens are stored in the browser's `localStorage` to allow for session restoration upon page reload or accidental disconnection.
- **Secure Configuration:** The system requires a strong `JWT_SECRET` environment variable in production. It will fail to start if the secret is missing or too short.

## Rate Limiting and Throttling
- **REST API:**
    - Key endpoints (Room Creation, Joining) are limited to **5 attempts per 15 minutes** per Client IP + Target Path.
    - Global rate limiting ensures stability against brute force or API flooding.
- **WebSocket:**
    - Game actions (Fold, Call, Raise, Ready) are throttled to **5 messages per second** per session.
    - Violations result in immediate rejection of the action and potential connection termination for repeat offenders.

## Input Validation and Sanitization
- **Payload Limits:** JSON request bodies are strictly limited to **10KB** to prevent memory exhaustion or DoS attacks via oversized payloads.
- **Content Sanitization:**
    - All user-provided text (Room Names, Player Aliases) is trimmed of leading/trailing whitespace.
    - Control characters and malicious patterns are rejected early.
    - HTML5 and backend bean validation enforce numeric bounds and string lengths.

## Transport & WebSocket Security
- **Identity Isolation:** Private data (such as hole cards, seat validation keys, and server-side errors) is exclusively routed through Spring Boot user-specific private queues (`/user/queue/private`), avoiding predictable per-player subscription paths.
- **Content Security Policy (CSP):** The frontend implements a strict CSP that limits script execution to trusted origins, forbids inline scripts, and restricts connections to verified API/WebSocket endpoints.
- **WebSocket Encryption:** Production deployments should always use `WSS` (WebSocket Secure) over TLS.

## Logging and Observability
- **Environment Gating:** Verbose debug logging (including STOMP frames) is automatically disabled in production builds.
- **Sensitive Data:** Secrets and private keys are never logged or exposed in client-side responses.

## Accessibility-First & Automated Verification
- **Accessible State Mapping:** Visually abstract statuses (such as active turns, folded players, and showdown winners) are translated to hidden screen-reader-only labels (`sr-only`), ensuring that the system is fully inclusive and that automated testing can semantically verify state transitions without leaking private data in the HTML structure.
- **Continuous Integration Testing:** Automated integration and E2E suites mimic actual user operations (clicking buttons, filling inputs, and reading text) to verify that defensive security mechanisms (input bounds, session expiration redirectors) function flawlessly across all environments.
