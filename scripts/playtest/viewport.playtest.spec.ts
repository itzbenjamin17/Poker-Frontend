import path from 'path';
import { test, expect, startGame } from './helpers';

const GATES: Array<{ width: number; height: number; prompt: boolean }> = [
    { width: 600, height: 800, prompt: false },
    { width: 599, height: 800, prompt: true },
    { width: 600, height: 799, prompt: true },
    { width: 667, height: 320, prompt: false },
    { width: 666, height: 320, prompt: true },
    { width: 700, height: 319, prompt: true },
    { width: 1024, height: 600, prompt: false },
    { width: 1024, height: 599, prompt: true },
];

const TEN = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'];
const SCREENS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 844, height: 390 },
    { width: 667, height: 375 },
];

test.describe('Viewport', () => {
    test('the rotate prompt appears exactly below the minimum window sizes', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben']);
        await startGame(t);
        const ann = t.page('Ann');
        for (const { width, height, prompt } of GATES) {
            await ann.setViewportSize({ width, height });
            await expect(ann.getByLabel('Rotate device prompt'), `${width}x${height}`).toBeVisible({ visible: prompt });
        }
    });

    // Screenshots land in test-results/playtest/screens/ for a visual review; this test only proves every seat renders.
    test('a full ten-player table shows every seat, the board and the hero at desktop to phone sizes', async ({ tables }, testInfo) => {
        test.setTimeout(240_000);
        const t = await tables(TEN);
        await startGame(t);
        const ann = t.page('Ann');
        for (const { width, height } of SCREENS) {
            await ann.setViewportSize({ width, height });
            await expect(ann.getByRole('group', { name: 'Ann hero seat' })).toBeVisible();
            for (const name of TEN.slice(1)) await expect(ann.getByRole('group', { name: `${name} seat` })).toBeVisible();
            await expect(ann.getByRole('region', { name: 'Board cluster' })).toBeVisible();
            await ann.screenshot({ path: path.join(testInfo.project.outputDir, 'screens', `ten-players-${width}x${height}.png`) });
        }
    });
});
