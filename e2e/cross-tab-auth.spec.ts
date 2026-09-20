import { test, expect, type BrowserContext } from './fixtures';

test.describe('Item 33: Cross-tab authentication and synchronization', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('opening a second tab shares auth, and leaving in tab A redirects tab B to lobby', async ({
    browser,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `CrossTab-${Math.floor(Math.random() * 10000)}`;
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
    await expect(tabA.getByRole('heading', { name: guestName })).toBeVisible();

    // 2. Open Tab B in the SAME hostContext (simulating second browser tab for HostAlice)
    const tabB = await hostContext.newPage();
    await tabB.goto('/');

    // Tab B shares auth session and is immediately in the room
    await expect(tabB.getByText(/game lobby/i)).toBeVisible();
    await expect(tabB.getByText(roomName)).toBeVisible();

    // 3. Start game so host is at the active game table
    await tabA.getByRole('button', { name: /start game/i }).click();

    // Both tabs should transition to the Game Table view
    await expect(tabA.getByRole('button', { name: /leave table/i })).toBeVisible();
    await expect(tabB.getByRole('button', { name: /leave table/i })).toBeVisible();

    // 4. Tab A clicks "Leave Table"
    tabA.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await tabA.getByRole('button', { name: /leave table/i }).click();

    // Tab A clears auth and returns to lobby home
    await expect(tabA.getByRole('button', { name: /establish table/i })).toBeVisible();

    // 5. Tab B detects storage event (poker-auth removed) and returns to lobby home
    await expect(tabB.getByRole('button', { name: /establish table/i })).toBeVisible();
  });
});
