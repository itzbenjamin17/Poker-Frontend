# 0010: Client-Side Diagnostic Redaction and Console Output Gating

We decided to route all client diagnostic logging through a centralized redacting logger that strips tokens, passwords, authorization headers, private queues, and hole cards, and suppresses all console outputs in production builds.

## Context

Multiplayer poker clients exchange confidential authentication tokens and secret hole cards over STOMP and REST. Many players livestream their matches on Twitch/YouTube or share screenshots and screen recordings while playing. If client code uses standard `console.log` for debugging, secret hole cards or authentication tokens printed to the browser DevTools console can easily leak to viewers, compromising fair play and account security.

## Decision

1. **Centralized Redacting Logger**: Channel all logging in `src/security/logger.ts` through `logger.log`, `logger.warn`, `logger.error`, and `logger.debug`.
2. **Recursive Redaction**: Deeply inspect and sanitize strings and objects:
   - Redact sensitive keys: `token`, `password`, `authorization`, `holeCards`.
   - Redact STOMP frames directed to `/user/queue/private`.
   - Mask HTTP `Bearer [REDACTED]` authorization headers and JSON hole card arrays.
3. **Production Gating**: In production builds (`import.meta.env.PROD`), gate and silence `console.log` and debug outputs completely. In development (`import.meta.env.DEV`), output redacted diagnostic entries.

## Consequences

- Prevents accidental credential theft or card snooping during screen sharing, live streaming, or browser diagnostics.
- Provides developers with clear, redacted debugging output during local development without risking data leaks.
- Keeps production browser console output clean and performant.
