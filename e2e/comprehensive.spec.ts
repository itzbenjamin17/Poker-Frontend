import { test, expect, type Page, type BrowserContext } from '@playwright/test';

// Helper to create and join a room
async function joinRoom(page: Page, roomName: string, playerName: string, isCreate: boolean = false) {
    await page.goto('/');
    if (isCreate) {
        const createRegion = page.getByRole('region', { name: /create table/i });
        await createRegion.getByLabel(/room name/i).fill(roomName);
        await createRegion.getByLabel(/player alias/i).fill(playerName);
        await page.getByRole('button', { name: /establish table/i }).click();
    } else {
        const joinRegion = page.getByRole('region', { name: /quick join/i });
        await joinRegion.getByLabel(/room name/i).fill(roomName);
        await joinRegion.getByLabel(/player alias/i).fill(playerName);
        await page.getByRole('button', { name: /enter vault/i }).click();
    }
    await expect(page.getByText(/game lobby/i)).toBeVisible({ timeout: 15000 });
}

test.describe('Comprehensive Poker Scenarios', () => {
    
    test('Scenario 1: Golden Path - 3 Player Full Hand', async ({ browser }) => {
        test.setTimeout(120000);
        const roomName = `GoldenPath-${Date.now()}`;
        const players = ['Alice', 'Bob', 'Charlie'];
        const contexts: BrowserContext[] = [];
        const pages: Page[] = [];

        for (const name of players) {
            const context = await browser.newContext();
            contexts.push(context);
            const page = await context.newPage();
            pages.push(page);
            await joinRoom(page, roomName, name, name === 'Alice');
        }

        await pages[0].getByRole('button', { name: /start game/i }).click();
        
        // Wait for the game to start (pot or blinds visible)
        await expect(pages[0].getByText(/\$/).first()).toBeVisible({ timeout: 15000 });

        // Play Pre-flop until FLOP appears
        for (let i = 0; i < 15; i++) {
            // Check if FLOP is already visible
            if (await pages[0].getByText('FLOP').isVisible()) break;

            const activePage = await findActivePlayerPage(pages);
            if (!activePage) {
                // If no active player found, check if FLOP appeared while waiting
                if (await pages[0].getByText('FLOP').isVisible()) break;
                await pages[0].waitForTimeout(1000);
                continue;
            }
            
            const actionBtn = activePage.locator('button').filter({ hasText: /Call|Check|All In/i }).first();
            if (await actionBtn.isVisible()) {
                await actionBtn.click({ force: true });
            }
            // Small wait for state propagation
            await pages[0].waitForTimeout(1000);
        }

        await expect(pages[0].getByText('FLOP')).toBeVisible({ timeout: 15000 });
        for (const context of contexts) await context.close();
    });

    test('Scenario 2: Uncontested Win', async ({ browser }) => {
        const roomName = `Uncontested-${Date.now()}`;
        const hostContext = await browser.newContext();
        const guestContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        await joinRoom(hostPage, roomName, 'Host', true);
        await joinRoom(guestPage, roomName, 'Guest');

        await hostPage.getByRole('button', { name: /start game/i }).click();
        
        for (let i = 0; i < 5; i++) {
            const activePage = await findActivePlayerPage([hostPage, guestPage]);
            if (activePage === hostPage) {
                await hostPage.getByRole('button', { name: /fold/i }).click({ force: true });
                break;
            } else if (activePage === guestPage) {
                await guestPage.getByRole('button', { name: /call|check/i }).first().click({ force: true });
            }
            await hostPage.waitForTimeout(1000);
        }

        // Use .first() to avoid strict mode violation
        await expect(guestPage.getByText(/won|round result/i).first()).toBeVisible({ timeout: 20000 });

        await hostContext.close();
        await guestContext.close();
    });

    test('Scenario 3: All-In Showdown', async ({ browser }) => {
        test.setTimeout(120000);
        const roomName = `AllIn-${Date.now()}`;
        const hostContext = await browser.newContext();
        const guestContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        await hostPage.goto('/');
        const createRegion = hostPage.getByRole('region', { name: /create table/i });
        await createRegion.getByLabel(/room name/i).fill(roomName);
        await createRegion.getByLabel(/player alias/i).fill('P1');
        await createRegion.getByLabel(/buy-in/i).fill('40'); // Small buy-in relative to 10/20 blinds
        await hostPage.getByRole('button', { name: /establish table/i }).click();

        await joinRoom(guestPage, roomName, 'P2');
        await hostPage.getByRole('button', { name: /start game/i }).click();

        // Push all-in for both players to trigger showdown
        for (let i = 0; i < 40; i++) {
            // Check if we already reached showdown or next hand's ready state
            if (await hostPage.getByText(/round result|READY/i).first().isVisible()) break;

            // Fast check for active player
            let activePage: Page | null = null;
            for (const p of [hostPage, guestPage]) {
                const actionBtns = p.locator('button').filter({ hasText: /Fold|Call|Check|All In|Raise|Bet/i });
                if (await actionBtns.first().isVisible()) {
                    activePage = p;
                    break;
                }
            }

            if (activePage) {
                // Click any available action button - with small buy-in, these will lead to all-in
                const actionBtn = activePage.locator('button').filter({ hasText: /Call|Check|All In|Raise|Bet/i }).first();
                if (await actionBtn.isVisible()) {
                    await actionBtn.click({ force: true });
                }
            }
            
            await hostPage.waitForTimeout(1000);
        }

        await expect(hostPage.getByText(/round result|READY/i).first()).toBeVisible({ timeout: 40000 });

        await hostContext.close();
        await guestContext.close();
    });

    test('Scenario 4: Connection & Session Resiliency', async ({ browser }) => {
        const roomName = `Resiliency-${Date.now()}`;
        const context = await browser.newContext();
        const page = await context.newPage();

        await joinRoom(page, roomName, 'LoneWolf', true);
        await page.reload();
        await expect(page.getByText(roomName)).toBeVisible({ timeout: 15000 });
        await context.close();
    });

    test('Scenario 5: Validation UI', async ({ browser }) => {
        const page = await browser.newPage();
        await page.goto('/');
        const createRegion = page.getByRole('region', { name: /create table/i });
        const roomInput = createRegion.getByLabel(/room name/i);
        await roomInput.fill('A'.repeat(60));
        const val = await roomInput.inputValue();
        expect(val.length).toBeLessThanOrEqual(50);
        await page.close();
    });
});

async function findActivePlayerPage(pages: Page[]): Promise<Page | null> {
    for (let attempt = 0; attempt < 40; attempt++) {
        for (const page of pages) {
            const actionBtns = page.locator('button').filter({ hasText: /Fold|Call|Check|All In|Raise/i });
            const count = await actionBtns.count();
            for (let i = 0; i < count; i++) {
                if (await actionBtns.nth(i).isVisible()) {
                    return page;
                }
            }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}
