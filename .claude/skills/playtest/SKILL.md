---
name: playtest
description: Full playtest of the poker app against the real backend — automated Playwright suite plus manual checks in the built-in browser, ending in a pass/fail report.
disable-model-invocation: true
---

# Playtest

You are the **playtester** for this poker app (frontend here, Spring Boot backend in `../Poker`). Your output is evidence: a report a developer can act on without rerunning anything. Source files stay as you found them; defects go in the report, never into a fix.

Work in four steps. Each ends on its completion criterion.

## 1. Preflight

- Run `git status --short` in both repositories and keep the output for the report.
- Create `.scratch/playtest/`; logs, screenshots and the report go there.
- Port 8080 must be free, since the suite starts its own backend. If something is listening, stop it (see [Backend configs](#backend-configs)).

**Done when:** both repositories' status is recorded and port 8080 is free.

## 2. Automated suite

Run `npm run playtest > .scratch/playtest/automated.log 2>&1` in the background. It takes about 5 minutes (the backend's first start adds 1–2 more). The config starts Vite and a backend with the short timers in `scripts/playtest/timings.ts`, and `global-setup.ts` refuses to run against a backend with other timings.

What it covers, so you can skip it in step 3: lobby and form validation, the server's lobby rules, betting rules and legal actions, blinds rotation, side pots, showdown ranks and winners checked against an independent evaluator, chip conservation, random-play soak, turn timeouts, the ready gate, refresh, offline, disconnect/reconnect, grace expiry, claim-win, two tabs for one player, hole-card privacy over the WebSocket, leaving, busting to game over, review persistence after server cleanup, viewport gates, and a 10-player table.

Triage every failure:

1. Read its `error-context.md` and screenshot under `test-results/playtest/`.
2. Rerun failures once with `npx playwright test -c playwright.playtest.config.ts --last-failed`. The random-play soak records its seed as a test annotation in the HTML report (`playwright-report/playtest/`); set `PLAYTEST_SEED=<seed>` to replay the same choices.
3. A failure that passes on rerun is **FLAKY**. One that reproduces is a **FAIL**: say whether the app or the spec is wrong, citing the evidence. A spec that is wrong is still reported, and left as is.

**Done when:** every test is listed as PASS, FAIL or FLAKY, and every FAIL/FLAKY has a cause and an evidence path.

## 3. Manual checks

Work through every check in [MANUAL-CHECKS.md](MANUAL-CHECKS.md) in order. These are what automation can't judge: how things look, whether copy reads well, keyboard use, and scenarios that need a different backend config or a server restart.

Harness:

- **Frontend:** `preview_start` with name `frontend` (from `.claude/launch.json`) serves Vite on :5173.
- **Players:** open one built-in-browser tab per player with `preview_start` and `url` `http://localhost:5173`. Each tab keeps its own login in `sessionStorage`, so every tab is a separate player. Write down which tab is which player.
- **Reading the screen:** use `get_page_text` / `read_page` for text, and `computer` screenshots when the look is the point. Save screenshots that back a finding to `.scratch/playtest/`.
- **Authoritative state:** run this with `javascript_tool` in a player's tab to see what the server holds. It's read-only, and its tokens never go in the report:

  ```js
  const a = JSON.parse(sessionStorage.getItem('poker-auth'));
  const h = { Authorization: `Bearer ${a.token}` };
  const s = await (await fetch(`/api/game/${a.roomId}/state`, { headers: h })).json();
  ({ me: a.playerName, hand: s.handNumber, phase: s.phase, pot: s.pot, pots: s.pots, actor: s.currentPlayerName,
     legal: s.legalActions, stacks: s.players.map(p => [p.name, p.chips, p.status]) })
  ```

  Chips are conserved when the stacks plus `pot` equal players × buy-in (minus stacks taken by players who left).
- **Errors:** check `read_console_messages` with `onlyErrors` after each check. A new error is a finding.

Record every check as **PASS**, **FAIL**, **BLOCKED** (couldn't run it: say why) or **NOT-SEEN** (a chance event that never happened).

**Done when:** every ID in MANUAL-CHECKS.md has a result, and every FAIL has repro steps, expected vs actual, and evidence.

## 4. Report and teardown

Write `.scratch/playtest/REPORT.md`:

1. **Summary:** totals per result, the run's date, and both repos' `git status`.
2. **Findings:** one entry per defect, worst first: severity (blocker / major / minor / cosmetic), title, steps to reproduce, expected, actual, evidence path, and test ID or check ID.
3. **Automated results:** one line per test.
4. **Manual results:** a table of ID | result | notes.
5. **For a human:** the HUMAN items from MANUAL-CHECKS.md, copied as a to-do list.

Then stop the backend, stop the `frontend` preview server, and close the tabs you opened.

**Done when:** REPORT.md exists with all five sections, and nothing you started is still running.

## Backend configs

Every config uses the `test` and `frontend-e2e` profiles, so no `.env` is needed. Environment variables set the timings. Use the full property-derived names shown here: the short names in the backend's `.env.example` only feed placeholders that these profiles overwrite.

Start (PowerShell, in the background, logging to `.scratch/playtest/backend.log`):

```powershell
Set-Location ..\Poker; <env assignments>; .\mvnw.cmd spring-boot:test-run "-Dspring-boot.run.profiles=test,frontend-e2e" *> ..\frontend-poker\.scratch\playtest\backend.log
```

It's ready when `curl -s --retry 40 --retry-connrefused --retry-delay 3 http://localhost:8080/actuator/health` reports `UP`. Stop it with:

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

| Config | Env assignments | Used for |
| --- | --- | --- |
| **FAST** | `$env:POKER_GAME_TURN_ALLOWANCE_MS='20000'; $env:POKER_ROOM_DISCONNECT_GRACE_PERIOD_MS='30000'; $env:POKER_GAME_READY_COUNTDOWN_MS='10000'; $env:POKER_GAME_GAME_END_DISPLAY_DELAY_MS='15000'; $env:POKER_GAME_AUTO_ADVANCE_STEP_DELAY_MS='1000'; $env:POKER_GAME_FINAL_SHOWDOWN_DISPLAY_DELAY_MS='2000'; $env:POKER_ROOM_LOBBY_INACTIVITY_MS='150000'` | Most manual checks (same timings as the suite) |
| **DEFAULTS** | `$env:POKER_GAME_READY_COUNTDOWN_MS='30000'; $env:POKER_GAME_GAME_END_DISPLAY_DELAY_MS='20000'` | Real timings (60 s turns, 4 s runout, 2 min grace) |
| **RATE** | FAST plus `$env:POKER_RATE_LIMITING_ENABLED='true'` | Rate-limit checks |
| **PERSIST** | FAST plus `$env:POKER_PERSISTENCE_ENABLED='true'; $env:POKER_PERSISTENCE_DIRECTORY="$PWD\..\frontend-poker\.scratch\playtest\wal"; $env:POKER_GAME_TURN_ALLOWANCE_MS='180000'; $env:POKER_GAME_READY_COUNTDOWN_MS='180000'; $env:POKER_GAME_GAME_END_DISPLAY_DELAY_MS='180000'` (long timers, so state can be compared across a ~40 s restart) | Restart recovery |
| **ABANDON** | `$env:POKER_GAME_READY_COUNTDOWN_MS='10000'; $env:POKER_ROOM_DISCONNECT_GRACE_PERIOD_MS='600000'; $env:POKER_GAME_GAME_INACTIVITY_ALLOWANCE_MS='150000'` | Game abandonment |

Switching configs means stopping the backend and starting it again. The backend keeps rooms in memory (except under PERSIST), so tabs from the previous config fall back to the main lobby. That's expected.
