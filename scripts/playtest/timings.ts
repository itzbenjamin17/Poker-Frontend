/**
 * Backend timings for the playtest suite: the single source of truth for both the backend the
 * config starts and the waits in the specs.
 *
 * The env names are the full property-derived names (`poker.game.ready-countdown-ms` ->
 * `POKER_GAME_READY_COUNTDOWN_MS`). They outrank the `test`/`frontend-e2e` profile files; the short
 * names in the backend's `.env.example` only feed placeholders those profiles overwrite.
 */
export const PLAYTEST_TIMINGS = {
    turnAllowanceMs: 20_000,
    disconnectGraceMs: 30_000,
    readyCountdownMs: 10_000,
    gameEndDisplayMs: 15_000,
    autoAdvanceStepMs: 1_000,
    finalShowdownDisplayMs: 2_000,
    lobbyInactivityMs: 150_000,
} as const;

export const PLAYTEST_BACKEND_ENV: Record<string, string> = {
    POKER_GAME_TURN_ALLOWANCE_MS: String(PLAYTEST_TIMINGS.turnAllowanceMs),
    POKER_ROOM_DISCONNECT_GRACE_PERIOD_MS: String(PLAYTEST_TIMINGS.disconnectGraceMs),
    POKER_GAME_READY_COUNTDOWN_MS: String(PLAYTEST_TIMINGS.readyCountdownMs),
    POKER_GAME_GAME_END_DISPLAY_DELAY_MS: String(PLAYTEST_TIMINGS.gameEndDisplayMs),
    POKER_GAME_AUTO_ADVANCE_STEP_DELAY_MS: String(PLAYTEST_TIMINGS.autoAdvanceStepMs),
    POKER_GAME_FINAL_SHOWDOWN_DISPLAY_DELAY_MS: String(PLAYTEST_TIMINGS.finalShowdownDisplayMs),
    POKER_ROOM_LOBBY_INACTIVITY_MS: String(PLAYTEST_TIMINGS.lobbyInactivityMs),
};

/** Client-side constant: inactivity warnings appear this long before the deadline. */
export const INACTIVITY_WARNING_WINDOW_MS = 120_000;
