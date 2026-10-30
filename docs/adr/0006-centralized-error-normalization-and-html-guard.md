# 0006: Centralized Error Normalization and HTML Leakage Guard

We decided to route all API and network errors through a centralized `normalizeErrorMessage` utility that strips HTML tags and limits message length to <= 80 characters.

## Context

When network gateways, reverse proxies (Nginx), or Spring Boot controllers return non-JSON error responses (such as 500 internal server error pages, HTML error templates, or Java stack traces), raw markup was previously passed directly into user-facing toast alerts and modal banners. This leaked server internals, broke UI layouts, and degraded user experience.

## Decision

1. **Centralized Normalizer**: Route all error extraction in `src/services/api.ts` and `src/domain/payloads.ts` through `normalizeErrorMessage()`.
2. **HTML & Tag Stripping**: Strip all HTML tags (`<...>`), doctype declarations, and XML comments via regex before presenting text to the user.
3. **Length Bounding**: Truncate overly long technical messages to a maximum of 80 characters, appending an ellipsis when truncated.
4. **Friendly Fallbacks**: Provide clear, human-readable fallback messages (e.g. `"Failed to connect to room"`) when server responses cannot be safely decoded.

## Consequences

- Completely eliminates raw HTML markup and server stack traces from leaking into the UI.
- Keeps toast notifications and banners compact, predictable, and accessible.
- Centralizes error parsing across all REST endpoints in a single audited location.
