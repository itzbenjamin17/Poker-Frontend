import {
    test, expect, act, checkOrCall, playHand, playerIn, probe, startGame, stateOf, waitForSettled,
    type GameState, type Page, type Table,
} from './helpers';
import { PLAYTEST_TIMINGS } from './timings';

interface StompMessage { destination: string; body: unknown }

/** Parses the server's STOMP MESSAGE frames out of raw WebSocket text frames. */
function stompMessages(frames: string[]): StompMessage[] {
    const messages: StompMessage[] = [];
    for (const raw of frames) {
        for (const frame of raw.split('\u0000')) {
            if (!frame.startsWith('MESSAGE')) continue;
            const split = frame.indexOf('\n\n');
            const destination = /\ndestination:([^\n]*)/.exec(frame.slice(0, split))?.[1] ?? '';
            try {
                messages.push({ destination, body: JSON.parse(frame.slice(split + 2)) });
            } catch {
                // Non-JSON bodies are not game payloads.
            }
        }
    }
    return messages;
}

async function waitForTable(page: Page): Promise<void> {
    await expect(page.getByLabel(/total pot|main pot/i).first()).toBeVisible({ timeout: 20_000 });
}

async function disconnectDeadlineOf(observer: Page, name: string): Promise<number | null> {
    const state = await stateOf(observer);
    const seat = state.players.find(p => p.name === name);
    return seat?.disconnectDeadlineEpochMs ?? null;
}

async function expectForfeitWinFor(table: Table, winner: string, timeout = 20_000): Promise<void> {
    const page = table.page(winner);
    await expect(page.getByRole('heading', { name: /game over/i })).toBeVisible({ timeout });
    await expect(page.getByText(`${winner} wins!`)).toBeVisible();
    // Claim-win and grace expiry both report the opponent as disconnected.
    await expect(page.getByText(/lost connection and didn't return in time\./)).toBeVisible();
}

test.describe('Connection', () => {
    test('refreshing mid-hand restores the same seat, chips and hole cards', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        await startGame(t);
        const before = await probe(t.page('Ben'));
        await t.page('Ben').reload();
        await waitForTable(t.page('Ben'));
        const after = await probe(t.page('Ben'));
        expect(after.me).toBe('Ben');
        expect(after.hole).toEqual(before.hole);
        expect(playerIn(after.state!, 'Ben').chips).toBe(playerIn(before.state!, 'Ben').chips);
        await expect(t.page('Ben').getByRole('img', { name: /of/i })).toHaveCount(2);
    });

    test('going offline shows the reconnect overlay at once and recovers when back online', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben'], { separateContexts: true });
        await startGame(t);
        const ben = t.page('Ben');

        await t.context('Ben').setOffline(true);
        await expect(ben.getByText('Reconnecting / restoring table…')).toBeVisible({ timeout: 3_000 });
        const isInert = (selector: string) => ben.locator(selector).first().evaluate(el => el.closest('[inert]') !== null);
        expect(await isInert('[aria-label="Action dock"]'), 'the dock is inert under the overlay').toBe(true);
        expect(await isInert('[aria-label="Room Header"]'), 'the header stays usable').toBe(false);

        await t.context('Ben').setOffline(false);
        await expect(ben.getByText('Reconnecting / restoring table…')).toBeHidden({ timeout: 20_000 });
        const [annState, benState] = [await stateOf(t.page('Ann')), await stateOf(ben)];
        expect([benState.handNumber, benState.stateRevision]).toEqual([annState.handNumber, annState.stateRevision]);
    });

    test('when recovery keeps failing, Retry connection appears and restores the table', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben'], { separateContexts: true });
        await startGame(t);
        const ben = t.page('Ben');
        // Simulate the server being unreachable for Ben alone while his browser is online.
        let blocked = true;
        await ben.route('**/api/**', route => (blocked ? route.abort() : route.continue()));
        await ben.routeWebSocket(/\/ws/, ws => (blocked ? ws.close() : ws.connectToServer()));

        await t.context('Ben').setOffline(true);
        await expect(ben.getByText('Reconnecting / restoring table…')).toBeVisible({ timeout: 3_000 });
        await t.context('Ben').setOffline(false);
        const retry = ben.getByRole('button', { name: /retry connection/i });
        await expect(retry, 'Retry appears once automatic recovery gives up').toBeVisible({ timeout: 45_000 });

        blocked = false;
        await retry.click();
        await expect(ben.getByText('Reconnecting / restoring table…')).toBeHidden({ timeout: 20_000 });
        expect((await stateOf(ben)).handNumber).toBe((await stateOf(t.page('Ann'))).handNumber);
    });

    test('a player who leaves the page is shown as reconnecting and gets the seat back on return', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        const away = start.currentPlayerName!;
        const stays = t.names.find(n => n !== away)!;
        const dealt = (await probe(t.page(away))).hole;

        await t.page(away).goto('about:blank');
        await expect.poll(() => disconnectDeadlineOf(t.page(stays), away)).not.toBeNull();
        const state = await stateOf(t.page(stays));
        const graceLeft = playerIn(state, away).disconnectDeadlineEpochMs! - state.serverTimeEpochMs;
        expect(Math.abs(graceLeft - PLAYTEST_TIMINGS.disconnectGraceMs)).toBeLessThan(5_000);
        await expect(t.page(stays).getByText(`Waiting for ${away} to reconnect...`)).toBeVisible();

        await t.page(away).goto('/');
        await waitForTable(t.page(away));
        await expect.poll(() => disconnectDeadlineOf(t.page(stays), away)).toBeNull();
        expect((await probe(t.page(away))).hole).toEqual(dealt);
        await expect(t.page(away).getByRole('button', { name: /^call\b/i })).toBeVisible();
    });

    test('when the only opponent disconnects, the remaining player can claim the win', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        const away = t.names.find(n => n !== start.currentPlayerName)!;
        const claimer = start.currentPlayerName!;

        await t.page(away).goto('about:blank');
        const claim = t.page(claimer).getByRole('button', { name: /claim the win/i });
        await expect(claim).toBeVisible({ timeout: 10_000 });
        await claim.click();
        await expectForfeitWinFor(t, claimer);
    });

    test('a disconnect between hands pauses the table, and grace expiry ends it as a forfeit', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        await act(t.page(start.currentPlayerName!), 'FOLD');
        await waitForSettled(t.page('Ann'));

        await t.page('Ben').goto('about:blank');
        // The gate moves to waiting when the countdown expires with fewer than two eligible players.
        await expect.poll(async () => (await stateOf(t.page('Ann'))).readyGateState, {
            message: 'table waits for players', timeout: PLAYTEST_TIMINGS.readyCountdownMs + 5_000,
        }).toBe('WAITING_FOR_PLAYERS');
        await expectForfeitWinFor(t, 'Ann', PLAYTEST_TIMINGS.disconnectGraceMs + 15_000);
    });

    test('a second tab for the same player keeps them connected until both tabs close', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        await startGame(t);
        const first = t.page('Ben');
        const auth = await first.evaluate(() => sessionStorage.getItem('poker-auth'));
        const second = await t.context('Ben').newPage();
        await second.addInitScript(value => {
            if (value && !sessionStorage.getItem('poker-auth')) sessionStorage.setItem('poker-auth', value);
        }, auth);
        await second.goto('/');
        await waitForTable(second);
        expect((await probe(second)).me).toBe('Ben');

        await first.close();
        // Give a wrongly-handled close time to surface as a disconnect.
        await t.page('Ann').waitForTimeout(3_000);
        expect(await disconnectDeadlineOf(t.page('Ann'), 'Ben'), 'one closed tab is not a disconnect').toBeNull();

        await second.close();
        await expect.poll(() => disconnectDeadlineOf(t.page('Ann'), 'Ben'), { message: 'closing the last tab disconnects' }).not.toBeNull();
    });

    test('no player receives another player\'s hole cards before showdown', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal']);
        const start = await startGame(t);
        const dealt: Record<string, string[]> = {};
        for (const name of t.names) {
            const view = await probe(t.page(name));
            dealt[name] = view.hole ?? [];
            expect(view.state!.players.every(p => p.holeCards === null), `${name}'s public state hides all hole cards`).toBe(true);
        }
        expect(start.handNumber).toBe(1);
        await playHand(t, checkOrCall);

        for (const name of t.names) {
            const messages = stompMessages(t.frames(name));
            const showdownAt = messages.findIndex(m => m.destination.startsWith('/game/') && (m.body as GameState).phase === 'SHOWDOWN');
            expect(showdownAt, `${name} received the showdown`).toBeGreaterThan(0);
            for (const message of messages.slice(0, showdownAt)) {
                if (message.destination.startsWith('/game/')) {
                    const leaked = (message.body as GameState).players.filter(p => p.holeCards !== null).map(p => p.name);
                    expect(leaked, `${name} got public hole cards before showdown`).toEqual([]);
                } else {
                    const cards = (message.body as { holeCards?: string[] | null }).holeCards;
                    if (cards) expect(cards, `${name}'s private queue only carries their own cards`).toEqual(dealt[name]);
                }
            }
        }
    });
});
