import { test, expect, type BrowserContext } from './fixtures';

test.describe('Connection Resilience', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('Player can reconnect and restore game state after refresh', async ({ browser, createRoom, joinRoom }) => {
    const roomName = `Resilience-E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'Host';
    const guestName = 'Guest';

    // 1. Initial Setup and Game Start
    const hostContext = await browser.newContext();
    contexts.push(hostContext);
    const guestContext = await browser.newContext();
    contexts.push(guestContext);

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    await createRoom(hostPage, roomName, hostName);
    await joinRoom(guestPage, roomName, guestName);

    await expect(hostPage.getByText(guestName )).toBeVisible();
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Verify both are in the game
    // Heads-up rules: Host (Dealer/SB) posts $10, Guest (BB) posts $20, resulting in a $30 initial pot.
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('30');
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('30');

    // 2. Simulate Disconnect (Refresh Guest Page)
    await guestPage.reload();

    // The same tab retains its sessionStorage auth across refresh.
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('30');
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);

    // 3. A new browser context has an independent tab session and cannot
    // recover the previous tab's auth automatically.
    await guestContext.close();

    const newGuestContext = await browser.newContext();
    contexts.push(newGuestContext);
    const newGuestPage = await newGuestContext.newPage();
    await newGuestPage.goto('/');

    await expect(newGuestPage.getByRole('button', { name: /create game/i })).toBeVisible();
  });
});

