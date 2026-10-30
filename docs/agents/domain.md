# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root for the canonical ubiquitous language and avoided synonyms.
- **`docs/ai/PROJECT.md`** as the canonical project context.
- **`GEMINI.md`** at the repo root for compatibility with older workflows.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── GEMINI.md
├── docs/ai/PROJECT.md
├── docs/adr/
│   ├── 0001-adaptive-table-first-game-page.md
│   ├── 0002-auth-keyed-gameview-and-session-isolation.md
│   ├── 0003-in-process-game-session-and-transport-port.md
│   ├── 0004-tab-scoped-authentication-via-session-storage.md
│   ├── 0005-monotonic-attempt-revision-and-abort-guard.md
│   ├── 0006-centralized-error-normalization-and-html-guard.md
│   ├── 0007-routerless-state-driven-view-selection.md
│   ├── 0008-parametric-elliptical-seating-geometry.md
│   ├── 0009-versioned-offline-envelope-storage-for-post-game-review.md
│   ├── 0010-client-side-diagnostic-redaction-and-console-gating.md
│   └── 0011-runtime-payload-decoding-and-validation-boundary.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap to capture via `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0004 (tab-scoped authentication via session storage) — but worth reopening because…_
