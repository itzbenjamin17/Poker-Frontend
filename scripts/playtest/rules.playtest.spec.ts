import {
    test, expect, act, actionButton, checkOrCall, expectChipsConserved, playHand, playerIn, probe, readyUp,
    startGame, stateOf, waitForActor, waitForSettled, type GameState, type Page, type Policy,
} from './helpers';
import { bestHand, expectedWinners } from './handEvaluator';
import { mulberry32, randomInt } from '../../src/test/prng';

/** Visible action buttons must be exactly the server's legal actions, with the right call amount and slider bounds. */
async function expectDockMatchesServer(page: Page, actor: string, state: GameState): Promise<void> {
    const legal = new Set(state.legalActions ?? []);
    const me = playerIn(state, actor);
    const owed = state.currentBet - me.currentBet;
    await expect(actionButton(page, legal.has('FOLD') ? 'FOLD' : legal.has('CHECK') ? 'CHECK' : 'CALL')).toBeVisible();
    await expect(actionButton(page, 'FOLD')).toBeVisible({ visible: legal.has('FOLD') });
    await expect(actionButton(page, 'CHECK')).toBeVisible({ visible: legal.has('CHECK') });
    await expect(actionButton(page, 'CALL')).toBeVisible({ visible: legal.has('CALL') && !legal.has('CHECK') });
    await expect(actionButton(page, 'BET')).toBeVisible({ visible: legal.has('BET') });
    await expect(actionButton(page, 'RAISE')).toBeVisible({ visible: legal.has('RAISE') });
    await expect(actionButton(page, 'ALL_IN')).toBeVisible({ visible: legal.has('ALL_IN') });
    if (legal.has('CALL') && !legal.has('CHECK')) {
        await expect(actionButton(page, 'CALL')).toHaveText(`Call ${Math.min(owed, me.chips).toLocaleString()}`);
    }
    if (legal.has('ALL_IN')) {
        await expect(actionButton(page, 'ALL_IN')).toHaveText(`All In ${me.chips.toLocaleString()}`);
    }
    for (const kind of ['BET', 'RAISE'] as const) {
        if (!legal.has(kind)) continue;
        await actionButton(page, kind).click();
        const slider = page.getByLabel('Raise amount');
        const minimum = kind === 'BET' ? state.minimumBetAmount : state.minimumRaiseAmount;
        await expect(slider, `${kind} slider minimum`).toHaveAttribute('min', String(minimum));
        await expect(slider, `${kind} slider maximum`).toHaveAttribute('max', String(Math.max(minimum ?? 0, me.chips)));
        await page.getByRole('button', { name: /^cancel$/i }).click();
    }
}

/** Checks each contender's rank and the winners against the independent evaluator (single-pot hands only). */
function expectShowdownMatchesEvaluator(settled: GameState, label: string): void {
    const board = settled.communityCards ?? [];
    const contenders = settled.players.filter(p => !p.hasFolded && p.holeCards);
    if (board.length < 5 || contenders.length < 2) return;
    const holes = Object.fromEntries(contenders.map(p => [p.name, p.holeCards ?? []]));
    for (const p of contenders) {
        expect(p.handRank, `${label}: ${p.name} holds ${holes[p.name].join(' ')} on ${board.join(' ')}`)
            .toBe(bestHand([...holes[p.name], ...board]).category);
    }
    expect([...(settled.winners ?? [])].sort(), `${label}: winners on ${board.join(' ')}`).toEqual(expectedWinners(board, holes));
}

function seatIndex(state: GameState, predicate: (p: GameState['players'][number]) => boolean): number {
    return state.players.findIndex(predicate);
}

function expectedPotLayers(contributions: number[]): { pots: number[]; uncalled: number } {
    const levels = [...new Set(contributions)].sort((a, b) => a - b);
    const pots: number[] = [];
    let previous = 0;
    for (const level of levels) {
        pots.push((level - previous) * contributions.filter(c => c >= level).length);
        previous = level;
    }
    const topIsAlone = levels.length > 1 && contributions.filter(c => c === levels[levels.length - 1]).length === 1;
    return { pots: topIsAlone ? pots.slice(0, -1) : pots, uncalled: topIsAlone ? pots[pots.length - 1] : 0 };
}

test.describe('Rules', () => {
    test('heads-up: the small blind acts first pre-flop and the big blind first after the flop', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const start = await startGame(t);
        const sb = start.players.find(p => p.isSmallBlind);
        const bb = start.players.find(p => p.isBigBlind);
        expect(sb && bb && sb.name !== bb.name).toBe(true);
        expect(sb!.currentBet).toBe(t.smallBlind);
        expect(bb!.currentBet).toBe(t.bigBlind);
        expect(start.pot).toBe(t.smallBlind + t.bigBlind);
        expect(start.currentPlayerName).toBe(sb!.name);
        await expect(actionButton(t.page(bb!.name), 'FOLD')).toBeHidden();

        await act(t.page(sb!.name), 'CALL');
        await act(t.page(bb!.name), 'CHECK');
        const flop = await waitForActor(t.page('Ann'));
        expect(flop.phase).toBe('FLOP');
        expect(flop.communityCards).toHaveLength(3);
        expect(flop.currentPlayerName).toBe(bb!.name);
    });

    test('three-handed: blinds and first action rotate one seat clockwise every hand', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal']);
        let state = await startGame(t);
        const seen: Array<{ sb: number; bb: number; first: number }> = [];
        for (let hand = 0; hand < 3; hand++) {
            state = await waitForActor(t.page('Ann'));
            const sb = seatIndex(state, p => p.isSmallBlind);
            const bb = seatIndex(state, p => p.isBigBlind);
            const first = seatIndex(state, p => p.name === state.currentPlayerName);
            expect(bb, `hand ${hand + 1}: big blind sits after the small blind`).toBe((sb + 1) % 3);
            expect(first, `hand ${hand + 1}: first to act sits after the big blind`).toBe((bb + 1) % 3);
            seen.push({ sb, bb, first });
            const settled = await playHand(t, () => 'FOLD');
            expectChipsConserved(settled, 3 * t.buyIn, `after hand ${hand + 1}`);
            if (hand < 2) await readyUp(t);
        }
        expect(seen[1].sb).toBe((seen[0].sb + 1) % 3);
        expect(seen[2].sb).toBe((seen[1].sb + 1) % 3);
    });

    test('the action dock offers exactly the legal actions, amounts and bet limits on every turn', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal']);
        await startGame(t);
        let betPlaced = false;
        const policy: Policy = (_actor, state) => {
            if (state.phase === 'FLOP' && !betPlaced && state.legalActions?.includes('BET')) {
                betPlaced = true;
                return { bet: state.minimumBetAmount ?? t.bigBlind };
            }
            return checkOrCall(_actor, state);
        };
        const settled = await playHand(t, policy, { beforeAct: (actor, state, page) => expectDockMatchesServer(page, actor, state) });
        expect(betPlaced).toBe(true);
        expectChipsConserved(settled, 3 * t.buyIn, 'after the hand');
    });

    test('showdowns: chips are conserved and every rank and winner matches an independent evaluator', async ({ tables }) => {
        test.setTimeout(240_000);
        const t = await tables(['Ann', 'Ben', 'Cal']);
        await startGame(t);
        for (let hand = 1; hand <= 5; hand++) {
            const dealt: Record<string, string[]> = {};
            for (const name of t.names) dealt[name] = (await probe(t.page(name))).hole ?? [];
            const settled = await playHand(t, checkOrCall);
            expectChipsConserved(settled, 3 * t.buyIn, `after hand ${hand}`);
            const board = settled.communityCards ?? [];
            expect(board, `hand ${hand} reached the river`).toHaveLength(5);
            const contenders = settled.players.filter(p => !p.hasFolded);
            expect(contenders).toHaveLength(3);
            for (const p of contenders) expect(p.holeCards, `${p.name}'s revealed cards are the ones dealt`).toEqual(dealt[p.name]);
            expectShowdownMatchesEvaluator(settled, `hand ${hand}`);
            const won = contenders.filter(p => p.isWinner).map(p => p.chipsWon ?? 0);
            if (won.length > 1) expect(Math.max(...won) - Math.min(...won), 'split pot shares').toBeLessThanOrEqual(1);
            if (hand < 5) await readyUp(t);
        }
    });

    test('unequal all-ins build the right side pot and uncalled refund, then run out to showdown', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben', 'Cal'], { buyIn: 200, smallBlind: 10, bigBlind: 20 });
        await startGame(t);
        await playHand(t, () => 'FOLD');
        const hand2 = await readyUp(t);
        const startStacks = Object.fromEntries(hand2.players.map(p => [p.name, p.chips + p.currentBet]));
        expect(new Set(Object.values(startStacks)).size, `stacks differ: ${JSON.stringify(startStacks)}`).toBe(3);

        const shove: Policy = (_actor, state) => (state.legalActions?.includes('ALL_IN') ? 'ALL_IN' : 'CALL');
        for (let i = 0; i < 3; i++) {
            const state = await waitForActor(t.page('Ann')).catch(() => null);
            if (!state) break;
            await act(t.page(state.currentPlayerName!), shove(state.currentPlayerName!, state));
        }

        const runout = await stateOf(t.page('Ann'));
        const contributions = runout.players.map(p => startStacks[p.name] - p.chips);
        const expected = expectedPotLayers(contributions);
        expect(runout.isAutoAdvancing || runout.handSettled, 'board runs out with nobody left to act').toBe(true);
        if (!runout.handSettled) {
            expect(runout.pots).toEqual(expected.pots);
            expect(runout.uncalledAmount ?? 0).toBe(expected.uncalled);
            for (const name of t.names) await expect(actionButton(t.page(name), 'FOLD')).toBeHidden();
            const sidePots = t.page('Ann').getByTestId('side-pot-chip');
            await expect(sidePots).toContainText(`+${expected.pots.length - 1} Side Pot${expected.pots.length > 2 ? 's' : ''}`);
            await sidePots.click();
            await expect(t.page('Ann').getByText(/side pot/i).first()).toBeVisible();
            if (expected.uncalled > 0) await expect(t.page('Ann').getByText(/uncalled/i).first()).toBeVisible();
        }

        const settled = await waitForSettled(t.page('Ann'));
        expect(settled.communityCards).toHaveLength(5);
        expectChipsConserved(settled, 3 * t.buyIn, 'after the all-in hand');
    });

    // Rerun a failure with PLAYTEST_SEED=<seed from the annotation> to replay the same choices.
    test('random play soak: four players taking random legal actions keep every chip accounted for', async ({ tables }) => {
        test.setTimeout(300_000);
        const seed = Number(process.env.PLAYTEST_SEED ?? Date.now() % 1_000_000);
        test.info().annotations.push({ type: 'seed', description: String(seed) });
        const random = mulberry32(seed);
        const t = await tables(['Ann', 'Ben', 'Cal', 'Dee'], { buyIn: 300, smallBlind: 5, bigBlind: 10 });
        await startGame(t);

        const randomLegal: Policy = (actor, state) => {
            const legal = new Set(state.legalActions ?? []);
            const chips = playerIn(state, actor).chips;
            const roll = random();
            const minRaise = state.minimumRaiseAmount ?? Infinity;
            const minBet = state.minimumBetAmount ?? Infinity;
            if (legal.has('RAISE') && roll < 0.15 && chips > minRaise) return { raise: randomInt(random, minRaise, chips) };
            if (legal.has('BET') && roll < 0.3 && chips > minBet) return { bet: randomInt(random, minBet, chips) };
            if (legal.has('ALL_IN') && roll > 0.97) return 'ALL_IN';
            if (legal.has('FOLD') && !legal.has('CHECK') && roll > 0.8) return 'FOLD';
            if (legal.has('CHECK')) return 'CHECK';
            if (legal.has('CALL')) return 'CALL';
            return legal.has('ALL_IN') ? 'ALL_IN' : 'FOLD';
        };

        // Busted players lose access to the game (HTTP 403), so always observe through someone with chips.
        let stillIn = [...t.names];
        for (let hand = 1; hand <= 12; hand++) {
            const settled = await playHand(t, randomLegal, { observer: t.page(stillIn[0]), maxActions: 120 });
            const label = `seed ${seed}, hand ${hand}`;
            expectChipsConserved(settled, 4 * t.buyIn, label);
            if (!settled.players.some(p => p.isAllIn)) expectShowdownMatchesEvaluator(settled, label);
            stillIn = settled.players.filter(p => p.chips > 0).map(p => p.name);
            if (stillIn.length < 2 || hand === 12) break;
            await readyUp(t, stillIn);
        }
    });
});
