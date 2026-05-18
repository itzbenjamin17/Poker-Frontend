import { test, expect } from '@playwright/test';

test.describe('Lobby and Room Lifecycle', () => {
  test('Host can create a room and Guest can join', async ({ browser }) => {
    const roomName = `E2E-Room-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'HostPlayer';
    const guestName = 'GuestPlayer';

    // 1. Host creates a room
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await hostPage.goto('/');

    const createRegion = hostPage.getByRole('region', { name: /create table/i });
    await createRegion.getByLabel(/room name/i).fill(roomName);
    await createRegion.getByLabel(/player alias/i).fill(hostName);
    await hostPage.getByRole('button', { name: /establish table/i }).click();

    // Verify Host is in the lobby
    await expect(hostPage.getByText(/game lobby/i)).toBeVisible();
    await expect(hostPage.getByText(roomName)).toBeVisible();
    await expect(hostPage.getByRole('heading', { name: hostName })).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /start game/i })).toBeVisible();

    // 2. Guest joins the room
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto('/');

    // Guest uses the "Quick Join" form
    const joinRegion = guestPage.getByRole('region', { name: /quick join/i });
    await joinRegion.getByLabel(/room name/i).fill(roomName);
    await joinRegion.getByLabel(/player alias/i).fill(guestName);
    await guestPage.getByRole('button', { name: /enter vault/i }).click();

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

    await hostContext.close();
    await guestContext.close();
  });
});
