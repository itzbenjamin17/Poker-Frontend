import {
    test, expect, act, checkOrCall, confirmLeave, createRoomUI, expectChipsConserved, expectMainLobby, playHand,
    playerIn, readyUp, reviewOf, startGame, stateOf, waitForActor, type GameState, type Page, type Policy,
} from './helpers';
import { PLAYTEST_TIMINGS } from './timings';

const shove: Policy = (_actor, state) => (state.legalActions?.includes('ALL_IN') ? 'ALL_IN' : 'CALL');

async function waitForGone(observer: Page, name: string): Promise<GameState> {
    let latest: GameState | null = null;
    await expect.poll(async () => {
        latest = await stateOf(observer);
        const seat = latest.players.find(p => p.name === name);
        return !seat || seat.status === 'OUT' || seat.hasFolded;
    }, { message: `${name} leaves the hand` }).toBe(true);
    return latest as unknown as GameState;
}

test.describe('Leaving and game end', () => {
    test('leaving on your turn folds you out and the hand carries on without you', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal']);
        const start = await startGame(t);
        const leaver = start.currentPlayerName!;
        const rest = t.names.filter(n => n !== leaver);
        const leaverStack = playerIn(start, leaver).chips;

        await confirmLeave(t.page(leaver), /leave table/i);
        await expectMainLobby(t.page(leaver));
        const after = await waitForGone(t.page(rest[0]), leaver);
        expect(after.currentPlayerName).not.toBe(leaver);

        const settled = await playHand(t, checkOrCall, { observer: t.page(rest[0]) });
        expectChipsConserved(settled, 3 * t.buyIn - leaverStack, 'after the leaver took their stack');
        expect(settled.winners?.includes(leaver)).toBe(false);
    });

    test('the host leaving mid-game does not stop the game for the others', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal']);
        const start = await startGame(t);
        if (start.currentPlayerName === 'Ann') await act(t.page('Ann'), 'CALL');

        await confirmLeave(t.page('Ann'), /leave table/i);
        await expectMainLobby(t.page('Ann'));
        await waitForGone(t.page('Ben'), 'Ann');
        await playHand(t, checkOrCall, { observer: t.page('Ben') });
        const next = await readyUp(t, ['Ben', 'Cal']);
        expect(next.handNumber).toBe(2);
        await waitForActor(t.page('Ben'));
    });

    test('a heads-up leave gives the opponent a forfeit win whose review survives refresh and server cleanup', async ({ tables, page }) => {
        test.setTimeout(120_000);
        const t = await tables(['Ann', 'Ben']);
        await startGame(t);
        const ann = t.page('Ann');

        await confirmLeave(t.page('Ben'), /leave table/i);
        await expectMainLobby(t.page('Ben'));
        await expect(ann.getByRole('heading', { name: /game over/i })).toBeVisible();
        await expect(ann.getByText('Ann wins!')).toBeVisible();
        await expect(ann.getByText('Ben left the table.')).toBeVisible();

        await ann.reload();
        await expect(ann.getByRole('heading', { name: /game over/i })).toBeVisible();
        expect((await reviewOf(ann)).state?.gameEnd?.winner).toBe('Ann');

        await expect.poll(async () => (await reviewOf(ann)).status, {
            message: 'the server removes the finished game', timeout: PLAYTEST_TIMINGS.gameEndDisplayMs + 15_000,
        }).not.toBe(200);
        await ann.reload();
        await expect(ann.getByRole('heading', { name: /game over/i }), 'review is served from the tab after cleanup').toBeVisible();
        await expect(ann.getByText('Ann wins!')).toBeVisible();

        await ann.getByRole('button', { name: /^leave$/i }).click();
        await expectMainLobby(ann);
        await createRoomUI(page, t.roomName, 'Dee');
    });

    test('playing until one player busts ends the game with the right winner and standings', async ({ tables }) => {
        test.setTimeout(240_000);
        const t = await tables(['Ann', 'Ben'], { buyIn: 100, smallBlind: 10, bigBlind: 20 });
        await startGame(t);
        let winner: string | null = null;
        for (let hand = 1; hand <= 20 && !winner; hand++) {
            const settled = await playHand(t, shove);
            expectChipsConserved(settled, 2 * t.buyIn, `after hand ${hand}`);
            winner = settled.players.find(p => p.chips === 2 * t.buyIn)?.name ?? null;
            if (!winner) await readyUp(t);
        }
        expect(winner, 'someone busted within 20 all-in hands').not.toBeNull();

        let final: GameState | null = null;
        await expect.poll(async () => {
            final = (await reviewOf(t.page(winner!))).state;
            return Boolean(final?.gameEnd);
        }, { message: 'the game ends', timeout: 20_000 }).toBe(true);
        const gameEnd = (final as unknown as GameState).gameEnd!;
        expect(gameEnd.winner).toBe(winner);
        expect(gameEnd.winnerChips).toBe(2 * t.buyIn);
        expect(gameEnd.isForfeit).toBe(false);

        for (const name of t.names) {
            const page = t.page(name);
            await expect(page.getByRole('heading', { name: /game over/i })).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(`${winner} wins!`)).toBeVisible();
            await expect(page.getByText(`Finished with ${(2 * t.buyIn).toLocaleString()} chips`)).toBeVisible();
            await expect(page.getByText('(Won by forfeit)')).toBeHidden();
        }
    });
});
