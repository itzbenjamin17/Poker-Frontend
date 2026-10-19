import { test, expect, type BrowserContext } from './fixtures';

test.describe('Tab-local authentication', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('a second tab does not adopt tab A auth or follow tab A leave', async ({
    browser,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `CrossTab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const hostName = 'HostAlice';
    const guestName = 'GuestBob';

    // 1. Setup host and guest in separate contexts to allow game start
    const hostContext = await browser.newContext();
    contexts.push(hostContext);
    const guestContext = await browser.newContext();
    contexts.push(guestContext);

    const tabA = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    // Host creates room
    await createRoom(tabA, roomName, hostName);
    await expect(tabA.getByText(/game lobby/i)).toBeVisible();

    // Guest joins room
    await joinRoom(guestPage, roomName, guestName);
    await expect(tabA.getByText(guestName )).toBeVisible();

    // 2. Open Tab B in the SAME hostContext (simulating second browser tab for HostAlice)
    const tabB = await hostContext.newPage();
    await tabB.goto('/');

    // Tab B starts with an independent, unauthenticated session.
    await expect(tabB.getByRole('button', { name: /create game/i })).toBeVisible();

    // 3. Start game so host is at the active game table
    await tabA.getByRole('button', { name: /start game/i }).click();

    // Tab A enters the game while Tab B stays in its own lobby.
    await expect(tabA.getByRole('button', { name: /leave table/i })).toBeVisible();
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
  });
});

