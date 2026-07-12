import { test, expect, type Page, type BrowserContext } from './fixtures';

test.describe('Comprehensive Poker Scenarios', () => {
    let contexts: BrowserContext[] = [];

    test.afterEach(async () => {
        for (const context of contexts) {
            await context.close().catch(() => {});
        }
        contexts = [];
    });

    test('Scenario 1: Golden Path - 3 Player Pre-flop Round to Flop', async ({ browser, createRoom, joinRoom }) => {
        const roomName = `GoldenPath-${Date.now()}`;
        const players = ['Alice', 'Bob', 'Charlie'];
        const pages: Page[] = [];

        // Setup 3 players sequentially
        for (const name of players) {
            const context = await browser.newContext();
            contexts.push(context);
            const page = await context.newPage();
            pages.push(page);
            if (name === 'Alice') {
                await createRoom(page, roomName, name);
            } else {
                await joinRoom(page, roomName, name);
            }
        }

        // Host starts the game
        await pages[0].getByRole('button', { name: /start game/i }).click();
        
        // Wait for the game to start (pot or blinds visible)
        // 3-player rules: Alice (index 0, BB posts $20), Bob (index 1, Dealer posts $0), Charlie (index 2, SB posts $10)
        // Blinds are posted automatically resulting in $30 initial pot
        await expect(pages[0].getByLabel(/total pot/i)).toContainText('$30');
        await expect(pages[1].getByLabel(/total pot/i)).toContainText('$30');
        await expect(pages[2].getByLabel(/total pot/i)).toContainText('$30');

        // Pre-flop Betting Round:
        // 1. Bob (Dealer, index 1) acts first pre-flop. Bob calls the $20 big blind (posts $20).
        const bobCallBtn = pages[1].getByRole('button', { name: /call/i });
        await expect(bobCallBtn).toBeVisible();
        await bobCallBtn.click();

        // 2. Charlie (Small Blind, index 2) acts second. Charlie already posted $10, so he calls $10 more ($20 total).
        const charlieCallBtn = pages[2].getByRole('button', { name: /call/i });
        await expect(charlieCallBtn).toBeVisible();
        await charlieCallBtn.click();

        // 3. Alice (Big Blind, index 0) acts third. Alice matches the current bet of $20, so she checks.
        const aliceCheckBtn = pages[0].getByRole('button', { name: /check/i });
        await expect(aliceCheckBtn).toBeVisible();
        await aliceCheckBtn.click();

        // Phase change to Flop!
        // Pot is now $60 ($20 from each player).
        await expect(pages[0].getByLabel(/total pot/i)).toContainText('$60');
        await expect(pages[0].getByText('FLOP')).toBeVisible();
    });

    test('Scenario 2: Uncontested Win', async ({ browser, createRoom, joinRoom }) => {
        const roomName = `Uncontested-${Date.now()}`;
        const hostContext = await browser.newContext();
        contexts.push(hostContext);
        const guestContext = await browser.newContext();
        contexts.push(guestContext);

        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        await createRoom(hostPage, roomName, 'Host');
        await joinRoom(guestPage, roomName, 'Guest');

        await hostPage.getByRole('button', { name: /start game/i }).click();
        
        // Heads-up: Guest (Dealer/SB, index 1) acts first pre-flop. Guest folds.
        const foldBtn = guestPage.getByRole('button', { name: /fold/i });
        await expect(foldBtn).toBeVisible();
        await foldBtn.click();

        // Host immediately wins the uncontested hand. Verify the showdown / round result displays.
        await expect(hostPage.getByText(/won|round result/i).first()).toBeVisible({ timeout: 20000 });
    });

    test('Scenario 3: All-In Showdown', async ({ browser, createRoom, joinRoom }) => {
        const roomName = `AllIn-${Date.now()}`;
        const hostContext = await browser.newContext();
        contexts.push(hostContext);
        const guestContext = await browser.newContext();
        contexts.push(guestContext);

        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        // Create table with custom buy-in of 40 (Small buy-in relative to 10/20 blinds)
        await createRoom(hostPage, roomName, 'P1', { buyIn: '40' });
        await joinRoom(guestPage, roomName, 'P2');
        await hostPage.getByRole('button', { name: /start game/i }).click();

        // Pre-flop:
        // P1 (BB, index 0) posted $20, has $20 left. P2 (Dealer/SB, index 1) posted $10, has $30 left.
        // P2 calls $10 (total $20 bet).
        const callBtn = guestPage.getByRole('button', { name: /call/i });
        await expect(callBtn).toBeVisible();
        await callBtn.click();

        // P1 checks.
        const checkBtn = hostPage.getByRole('button', { name: /check/i });
        await expect(checkBtn).toBeVisible();
        await checkBtn.click();

        // Flop phase:
        // Pot is $40. Both P1 and P2 have $20 left.
        await expect(hostPage.getByLabel(/total pot/i)).toContainText('$40');

        // P1 (BB, acts first postflop) bets all-in by putting $20.
        // First click Bet to expand amount controls
        const betBtn = hostPage.getByRole('button', { name: /^bet$/i });
        await expect(betBtn).toBeVisible();
        await betBtn.click();

        // Now enter the amount and click Bet to submit
        const raiseInput = hostPage.getByLabel('Raise amount');
        await expect(raiseInput).toBeVisible();
        await raiseInput.fill('20');
        await betBtn.click();

        // P2 is facing a $20 bet, calls $20.
        const p2CallBtn = guestPage.getByRole('button', { name: /call/i });
        await expect(p2CallBtn).toBeVisible();
        await p2CallBtn.click();

        // Showdown modal is displayed since both players are all-in.
        await expect(hostPage.getByText(/round result|won/i).first()).toBeVisible({ timeout: 20000 });
    });
    test('Scenario 4: Full Hand to River (Checking it down)', async ({ browser, createRoom, joinRoom }) => {
        const roomName = `FullHand-${Date.now()}`;
        const hostContext = await browser.newContext();
        contexts.push(hostContext);
        const guestContext = await browser.newContext();
        contexts.push(guestContext);

        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        await createRoom(hostPage, roomName, 'Host');
        await joinRoom(guestPage, roomName, 'Guest');

        await hostPage.getByRole('button', { name: /start game/i }).click();

        // Pre-flop: Host (BB, index 0, $20), Guest (Dealer/SB, index 1, $10). Guest acts first.
        const guestCallBtn = guestPage.getByRole('button', { name: /call/i });
        await expect(guestCallBtn).toBeVisible();
        await guestCallBtn.click(); // Guest calls $10

        const hostCheckBtn = hostPage.getByRole('button', { name: /check/i });
        await expect(hostCheckBtn).toBeVisible();
        await hostCheckBtn.click(); // Host checks

        // Flop
        await expect(hostPage.getByText('FLOP')).toBeVisible();
        
        // Post-flop, BB (Host) acts first
        await expect(hostPage.getByRole('button', { name: /check/i })).toBeVisible();
        await hostPage.getByRole('button', { name: /check/i }).click();

        await expect(guestPage.getByRole('button', { name: /check/i })).toBeVisible();
        await guestPage.getByRole('button', { name: /check/i }).click();

        // Turn
        await expect(hostPage.getByText('TURN', { exact: true })).toBeVisible();

        await expect(hostPage.getByRole('button', { name: /check/i })).toBeVisible();
        await hostPage.getByRole('button', { name: /check/i }).click();

        await expect(guestPage.getByRole('button', { name: /check/i })).toBeVisible();
        await guestPage.getByRole('button', { name: /check/i }).click();

        // River
        await expect(hostPage.getByText('RIVER', { exact: true })).toBeVisible();

        await expect(hostPage.getByRole('button', { name: /check/i })).toBeVisible();
        await hostPage.getByRole('button', { name: /check/i }).click();

        await expect(guestPage.getByRole('button', { name: /check/i })).toBeVisible();
        await guestPage.getByRole('button', { name: /check/i }).click();

        // Showdown
        await expect(hostPage.getByText(/round result|won/i).first()).toBeVisible({ timeout: 20000 });
    });
});
