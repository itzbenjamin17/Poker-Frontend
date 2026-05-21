import { test, expect, type BrowserContext } from './fixtures';

test.describe('Lobby and Room Lifecycle', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('Host can create a room and Guest can join', async ({ browser, createRoom, joinRoom }) => {
    const roomName = `E2E-Room-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'HostPlayer';
    const guestName = 'GuestPlayer';

    // 1. Host creates a room
    const hostContext = await browser.newContext();
    contexts.push(hostContext);
    const hostPage = await hostContext.newPage();
    await createRoom(hostPage, roomName, hostName);

    // Verify Host is in the lobby
    await expect(hostPage.getByText(/game lobby/i)).toBeVisible();
    await expect(hostPage.getByText(roomName)).toBeVisible();
    await expect(hostPage.getByRole('heading', { name: hostName })).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /start game/i })).toBeVisible();

    // 2. Guest joins the room
    const guestContext = await browser.newContext();
    contexts.push(guestContext);
    const guestPage = await guestContext.newPage();
    await joinRoom(guestPage, roomName, guestName);

    // Verify Guest is in the same lobby
    await expect(guestPage.getByText(/game lobby/i)).toBeVisible();
    await expect(guestPage.getByText(roomName)).toBeVisible();
    await expect(guestPage.getByRole('heading', { name: guestName })).toBeVisible();
    
    // Guest should NOT see the start game button
    await expect(guestPage.getByRole('button', { name: /start game/i })).not.toBeVisible();
    await expect(guestPage.getByText(/waiting for host to start/i)).toBeVisible();

    // 3. Verify synchronization (both see each other)
    await expect(hostPage.getByRole('heading', { name: guestName })).toBeVisible();
    await expect(guestPage.getByRole('heading', { name: hostName })).toBeVisible();
  });
});
