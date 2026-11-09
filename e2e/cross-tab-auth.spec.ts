import { test, expect } from './fixtures';

test.describe('Tab-local authentication', () => {
  test('a second tab does not adopt tab A auth or follow tab A leave', async ({
    page,
    context,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `CrossTab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const hostName = 'HostAlice';
    const guestName = 'GuestBob';

    // 1. Setup host (tabA), guest (guestPage), and observer (tabB) in the same BrowserContext
    const tabA = page;
    const guestPage = await context.newPage();

    // Host creates room
    await createRoom(tabA, roomName, hostName);
    await expect(tabA.getByText(/game lobby/i)).toBeVisible();

    // Guest joins room
    await joinRoom(guestPage, roomName, guestName);
    await expect(tabA.getByText(guestName)).toBeVisible();

    // 2. Open Tab B in the SAME BrowserContext (simulating unauthenticated tab)
    const tabB = await context.newPage();
    await tabB.goto('/');

    // Tab B starts with an independent, unauthenticated session.
    await expect(tabB.getByRole('button', { name: /create game/i })).toBeVisible();

    // 3. Start game so host and guest are at active game table
    await tabA.getByRole('button', { name: /start game/i }).click();

    // Tab A and guestPage enter the game while Tab B stays in its own unauthenticated lobby.
    await expect(tabA.getByRole('button', { name: /leave table/i })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /leave table/i })).toBeVisible();
    await expect(tabB.getByRole('button', { name: /create game/i })).toBeVisible();

    // 4. Tab A clicks "Leave Table"
    tabA.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await tabA.getByRole('button', { name: /leave table/i }).click();

    // Tab A clears auth and returns to lobby home
    await expect(tabA.getByRole('button', { name: /create game/i })).toBeVisible();

    // Tab B remains in its independent lobby throughout.
    await expect(tabB.getByRole('button', { name: /create game/i })).toBeVisible();

    // Guest transitions to game review screen with explicit winner and forfeit outcome
    const reviewRegion = guestPage.getByRole('region', { name: /game review/i });
    await expect(reviewRegion).toBeVisible({ timeout: 15000 });
    await expect(reviewRegion).toContainText(/GuestBob wins!/i);
    await expect(reviewRegion).toContainText(/won by forfeit/i);
  });
});
