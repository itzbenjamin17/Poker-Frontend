import path from 'path';
import { test, expect, act, checkOrCall, startGame, waitForActor } from './helpers';

const GATES: Array<{ width: number; height: number; prompt: boolean }> = [
    { width: 600, height: 800, prompt: false },
    { width: 599, height: 800, prompt: true },
    { width: 600, height: 799, prompt: true },
    { width: 667, height: 265, prompt: false },
    { width: 666, height: 265, prompt: true },
    { width: 700, height: 264, prompt: true },
    { width: 1024, height: 600, prompt: false },
    { width: 1024, height: 599, prompt: true },
];

const TEN = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'];
const SCREENS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 844, height: 390 },
    { width: 750, height: 340 }, // iPhone 14 in Safari, landscape
    { width: 667, height: 375 },
];

test.describe('Viewport', () => {
    test('the rotate prompt appears exactly below the minimum window sizes', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        const ann = t.page('Ann');

        // Confirm the room lobby itself is usable (not gated or clipped) at the 667x265 mobile floor.
        await ann.setViewportSize({ width: 667, height: 265 });
        await expect(ann.getByLabel('Rotate device prompt')).toBeHidden();
        await expect(ann.getByRole('region', { name: 'Game lobby' })).toBeVisible();
        await expect(ann.getByRole('button', { name: /start game/i })).toBeVisible();

        await startGame(t);
        for (const { width, height, prompt } of GATES) {
            await ann.setViewportSize({ width, height });
            await expect(ann.getByLabel('Rotate device prompt'), `${width}x${height}`).toBeVisible({ visible: prompt });
        }
    });

    // Screenshots land in test-results/playtest/screens/ for a visual review; this test only proves every seat renders.
    test('a full ten-player table shows every seat, the board and the hero at desktop to phone sizes', async ({ tables, browserName }, testInfo) => {
        // WebKit stalls background pages, so ten players in one browser miss heartbeats and reconnect mid-test.
        test.skip(browserName === 'webkit', 'ten background WebKit pages cannot hold their connections');
        test.setTimeout(240_000);
        const t = await tables(TEN);
        await startGame(t);
        const ann = t.page('Ann');
        for (const { width, height } of SCREENS) {
            // Keep the hand moving so no seat's 20s turn timer expires (and removes that player) mid-check.
            const state = await waitForActor(ann);
            await act(t.page(state.currentPlayerName!), checkOrCall(state.currentPlayerName!, state));
            await ann.setViewportSize({ width, height });
            await expect(ann.getByRole('group', { name: 'Ann hero seat' })).toBeVisible();
            for (const name of TEN.slice(1)) await expect(ann.getByRole('group', { name: `${name} seat` })).toBeVisible();
            await expect(ann.getByRole('region', { name: 'Board cluster' })).toBeVisible();
            await ann.screenshot({ path: path.join(testInfo.project.outputDir, 'screens', `ten-players-${width}x${height}.png`), scale: 'css' });
        }
    });
});
