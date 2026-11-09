import { test, expect } from './fixtures';

test.describe('Lobby and Room Lifecycle', () => {
  test('Host can create a room and Guest can join', async ({ page, context, createRoom, joinRoom }) => {
    const roomName = `E2E-Room-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'HostPlayer';
    const guestName = 'GuestPlayer';

    // 1. Host creates a room
    const hostPage = page;
    await createRoom(hostPage, roomName, hostName);

    // Verify Host is in the lobby
    await expect(hostPage.getByText(/game lobby/i)).toBeVisible();
    await expect(hostPage.getByText(roomName).first()).toBeVisible();
    await expect(hostPage.getByText(hostName)).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /start game/i })).toBeVisible();

    // 2. Guest joins the room
    const guestPage = await context.newPage();
    await joinRoom(guestPage, roomName, guestName);

    // Verify Guest is in the same lobby
    await expect(guestPage.getByText(/game lobby/i)).toBeVisible();
    await expect(guestPage.getByText(roomName).first()).toBeVisible();
    await expect(guestPage.getByText(guestName)).toBeVisible();

    // Guest should NOT see the start game button
    await expect(guestPage.getByRole('button', { name: /start game/i })).not.toBeVisible();
    await expect(guestPage.getByText(/waiting for host to start/i)).toBeVisible();

    // 3. Verify synchronization (both see each other)
    await expect(hostPage.getByText(guestName)).toBeVisible();
    await expect(guestPage.getByText(hostName)).toBeVisible();
  });

  test('Password-protected room rejects missing/wrong password and admits matching password', async ({
    page,
    context,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `E2E-Pass-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'HostPlayer';
    const guestName = 'GuestPlayer';
    const password = 'CorrectHorse1!';

    // Host creates room with password
    const hostPage = page;
    await createRoom(hostPage, roomName, hostName, { password });

    // Guest attempts to join without a password
    const guestPage = await context.newPage();
    await guestPage.goto('/');
    const joinRegion = guestPage.getByRole('region', { name: /quick join/i });
    await joinRegion.getByLabel(/room name/i).fill(roomName);
    await joinRegion.getByLabel(/player alias/i).fill(guestName);
    await guestPage.getByRole('button', { name: /join game/i }).click();

    await expect(guestPage.getByRole('alert')).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /join game/i })).toBeVisible();

    // Guest attempts to join with wrong password
    await joinRegion.getByLabel(/password/i).fill('WrongPass');
    await guestPage.getByRole('button', { name: /join game/i }).click();

    // Verify guest sees error alert and stays on join form
    await expect(guestPage.getByRole('alert')).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /join game/i })).toBeVisible();

    // Guest joins with matching password
    await joinRoom(guestPage, roomName, guestName, { password });

    // Verify both Host and Guest see each other in the game lobby
    await expect(hostPage.getByText(guestName)).toBeVisible();
    await expect(guestPage.getByText(hostName)).toBeVisible();
  });

  test('Host leaving pre-game lobby destroys the room and redirects waiting guest', async ({
    page,
    context,
    createRoom,
    joinRoom,
  }) => {
    const roomName = `E2E-Leave-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'HostPlayer';
    const guestName = 'GuestPlayer';

    // Host creates room; Guest joins room
    const hostPage = page;
    await createRoom(hostPage, roomName, hostName);

    const guestPage = await context.newPage();
    await joinRoom(guestPage, roomName, guestName);

    // Verify both see each other in the game lobby
    await expect(hostPage.getByText(guestName)).toBeVisible();
    await expect(guestPage.getByText(hostName)).toBeVisible();

    // Register dialog handler on hostPage
    hostPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Host clicks LEAVE TABLE in the lobby header
    await hostPage.getByRole('button', { name: /leave table/i }).click();

    // Verify hostPage returns to the main lobby
    await expect(hostPage.getByRole('button', { name: /create game/i })).toBeVisible();

    // Verify guestPage receives the HOST_LEFT notification and automatically redirects back to the main lobby
    await expect(guestPage.getByText(/host left the lobby/i)).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /create game/i })).toBeVisible({ timeout: 15000 });
  });
});
