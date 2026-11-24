import {
    test, expect, act, checkOrCall, expectMainLobby, playHand, readyUp, startGame, stateOf, waitForActor, waitForSettled,
} from './helpers';
import { PLAYTEST_TIMINGS } from './timings';

const TIMEOUT_MESSAGE = /removed from the table due to turn timeout/i;

test.describe('Timers', () => {
    test('the acting player sees a warning in the last ten seconds of their turn', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        const actor = start.currentPlayerName!;
        const other = t.names.find(n => n !== actor)!;
        const warning = t.page(actor).getByTestId('turn-warning');

        await expect(warning).toBeHidden();
        await expect(warning).toBeVisible({ timeout: PLAYTEST_TIMINGS.turnAllowanceMs });
        await expect(warning).toContainText(/\d+s left/);
        const state = await stateOf(t.page(actor));
        expect(state.turnDeadlineEpochMs! - state.serverTimeEpochMs).toBeLessThanOrEqual(10_500);
        await expect(t.page(other).getByTestId('turn-warning')).toBeHidden();
        await act(t.page(actor), 'FOLD');
    });

    // Heads-up, the timeout ends the match, so the idle player gets the shared game review rather
    // than the "removed due to turn timeout" message (which only appears while the game goes on).
    test('heads-up, an idle player times out and both players see who ran out of time', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        const idle = start.currentPlayerName!;
        const winner = t.names.find(n => n !== idle)!;

        for (const [name, note] of [[winner, `${idle} ran out of time on their turn.`], [idle, 'You ran out of time on your turn.']]) {
            const page = t.page(name);
            await expect(page.getByRole('heading', { name: /game over/i })).toBeVisible({ timeout: PLAYTEST_TIMINGS.turnAllowanceMs + 10_000 });
            await expect(page.getByText(`${winner} wins!`)).toBeVisible();
            await expect(page.getByText(note)).toBeVisible();
        }
    });

    test('three-handed, a timed-out player is removed and the others play on', async ({ tables }) => {
        test.setTimeout(150_000);
        const t = await tables(['Ann', 'Ben', 'Cal']);
        const start = await startGame(t);
        const idle = start.currentPlayerName!;
        const rest = t.names.filter(n => n !== idle);
        const observer = t.page(rest[0]);

        await expect(t.page(idle).getByText(TIMEOUT_MESSAGE)).toBeVisible({ timeout: PLAYTEST_TIMINGS.turnAllowanceMs + 10_000 });
        await expectMainLobby(t.page(idle), 20_000);
        await expect.poll(async () => {
            const state = await stateOf(observer);
            const seat = state.players.find(p => p.name === idle);
            return !seat || seat.status === 'OUT';
        }, { message: `${idle} leaves the game` }).toBe(true);

        const settled = await playHand(t, checkOrCall, { observer });
        expect(settled.handSettled).toBe(true);
        const next = await readyUp(t, rest);
        expect(next.handNumber).toBe(settled.handNumber + 1);
        expect(next.players.filter(p => p.status !== 'OUT').map(p => p.name).sort()).toEqual([...rest].sort());
    });

    test('ready gate: READY and UNREADY update the count everywhere and all-ready deals at once', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        await act(t.page(start.currentPlayerName!), 'FOLD');
        await waitForSettled(t.page('Ann'));

        const ann = t.page('Ann');
        const ben = t.page('Ben');
        await expect(ann.getByText(/\(0\/2( players ready)?\)/)).toBeVisible();
        await ann.getByRole('button', { name: /^ready$/i }).click();
        await expect(ben.getByText(/\(1\/2( players ready)?\)/)).toBeVisible();
        await ann.getByRole('button', { name: /cancel ready/i }).click();
        await expect(ben.getByText(/\(0\/2( players ready)?\)/)).toBeVisible();

        await ann.getByRole('button', { name: /^ready$/i }).click();
        const clickedAt = Date.now();
        await ben.getByRole('button', { name: /^ready$/i }).click();
        await expect.poll(async () => (await stateOf(ann)).handNumber).toBe(2);
        expect(Date.now() - clickedAt, 'next hand deals without waiting for the countdown')
            .toBeLessThan(PLAYTEST_TIMINGS.readyCountdownMs / 2);
    });

    test('when the ready countdown runs out the next hand is dealt automatically', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        await act(t.page(start.currentPlayerName!), 'FOLD');
        const settled = await waitForSettled(t.page('Ann'));
        const countdownMs = settled.readyCountdownDeadlineEpochMs! - settled.serverTimeEpochMs;
        expect(Math.abs(countdownMs - PLAYTEST_TIMINGS.readyCountdownMs)).toBeLessThan(1_500);

        const settledAt = Date.now();
        await expect.poll(async () => (await stateOf(t.page('Ann'))).handNumber, { timeout: PLAYTEST_TIMINGS.readyCountdownMs + 10_000 }).toBe(2);
        expect(Date.now() - settledAt, 'the hand waited for the countdown').toBeGreaterThan(PLAYTEST_TIMINGS.readyCountdownMs - 2_000);
        await waitForActor(t.page('Ann'));
    });
});
