import { test, expect } from './fixtures';

test.describe('Connection Resilience', () => {
  test('Player can reconnect and restore game state after refresh', async ({
    page,
    context,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `Resilience-E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'Host';
    const guestName = 'Guest';

    // 1. Initial Setup and Game Start
    const hostPage = page;
    const guestPage = await context.newPage();

    await createRoom(hostPage, roomName, hostName);
    await joinRoom(guestPage, roomName, guestName);

    await expect(hostPage.getByText(guestName)).toBeVisible();
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Verify both are in the game
    // Heads-up rules: Host (Dealer/SB) posts $10, Guest (BB) posts $20, resulting in a $30 initial pot.
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('30');
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('30');

    // 2. Simulate Disconnect (Refresh Guest Page)
    await guestPage.reload();

    // The same tab retains its sessionStorage auth across refresh while hostPage remains unaffected.
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('30');
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('30');

    // 3. A new tab in the same context has an independent tab session and starts unauthenticated.
    await guestPage.close();

    const newGuestPage = await context.newPage();
    await newGuestPage.goto('/');

    await expect(newGuestPage.getByRole('button', { name: /create game/i })).toBeVisible();
  });
});


