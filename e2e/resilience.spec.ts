import { test, expect } from '@playwright/test';

test.describe('Connection Resilience', () => {
  test('Player can reconnect and restore game state after refresh', async ({ browser }) => {
    const roomName = `Resilience-E2E-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'Host';
    const guestName = 'Guest';

    // 1. Initial Setup and Game Start
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    await hostPage.goto('/');
    const createRegion = hostPage.getByRole('region', { name: /create table/i });
    await createRegion.getByLabel(/room name/i).fill(roomName);
    await createRegion.getByLabel(/player alias/i).fill(hostName);
    await hostPage.getByRole('button', { name: /establish table/i }).click();

    await guestPage.goto('/');
    const joinRegion = guestPage.getByRole('region', { name: /quick join/i });
    await joinRegion.getByLabel(/room name/i).fill(roomName);
    await joinRegion.getByLabel(/player alias/i).fill(guestName);
    await guestPage.getByRole('button', { name: /enter vault/i }).click();

    await expect(hostPage.getByRole('heading', { name: guestName })).toBeVisible();
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Verify both are in the game
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('$30');
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('$30');

    // 2. Simulate Disconnect (Refresh Guest Page)
    await guestPage.reload();

    // Verify Guest re-hydrates into the Game View automatically
    // It should skip the Lobby because of persistent auth in localStorage
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('$30');
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);

    // 3. Simulate Full Browser Close / Reopen
    // Extract auth data from Guest's localStorage to ensure we're "the same person"
    const storageState = await guestContext.storageState();
    await guestContext.close();

    // Re-open with same storage state
    const newGuestContext = await browser.newContext({ storageState });
    const newGuestPage = await newGuestContext.newPage();
    await newGuestPage.goto('/');

    // Verify Guest is back at the table
    await expect(newGuestPage.getByLabel(/total pot/i)).toContainText('$30');
    await expect(newGuestPage.getByRole('heading', { name: hostName })).toBeVisible();

    await hostContext.close();
    await newGuestContext.close();
  });
});
