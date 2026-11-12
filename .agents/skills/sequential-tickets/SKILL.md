---
name: sequential-tickets
description: Execute an approved sequence of frontend tickets when work must stay ordered and independently reviewable. Use for multi-ticket refactors; use geometry-refactor for table seating changes.
---

# Sequential frontend tickets

Use this workflow when the user has approved an ordered set of frontend tickets. Follow the order and keep each ticket reviewable on its own.

1. Read [project context](../../../docs/ai/PROJECT.md), the current [agent instructions](../../../AGENTS.md), and any relevant ADRs. Check the working tree and preserve existing edits.
2. Confirm the ticket order, acceptance criteria, and file ownership boundaries from the supplied plan. Work only on the current ticket's scope; carry a dependency forward only when the approved order requires it.
3. Select a reviewer for each ticket: use `fast-reviewer` for presentational UI, accessibility, forms, and routine configuration; use `deep-reviewer` for session state, transport, authentication, concurrency, and geometry. Establish the right evidence before editing: feature and bug logic need a meaningful failing test that fails for the intended reason; refactors need passing behavioral or characterization coverage first. Never manufacture a red test for a refactor.
4. Implement the ticket, run the narrowest relevant check (for example, `npm run test -- --run src/path/to/feature.test.ts`), and review its diff against acceptance criteria and neighboring contracts before moving on. Keep full check logs under `.scratch/`; report each command, status, test count when applicable, and log path.
5. At integration, review the combined diff and run `npm run build` and `npm run test:all` for code changes. `test:all` includes Playwright's standard suite, which requires its configured backend and browser prerequisites. Run lint when the scope or project instructions call for it. Documentation-only changes use the documentation review exception in `AGENTS.md`.
6. Finish with a `deep-reviewer` pass for the combined changes affecting `GameSession`, transport, authentication, or shared geometry. Review them against the relevant ADRs and invariants; preserve session state outside React and measured table geometry contracts.
7. When staging is authorized, stage each ticket's explicit paths with `git add <file>`. Commit per ticket only when commits are also authorized. Report completed tickets, checks and logs, review findings, and any unmet prerequisite.
