import { test as baseTest, expect, type Page } from '@playwright/test';

export interface CreateRoomOptions {
  buyIn?: string;
  smallBlind?: string;
  bigBlind?: string;
}

async function expectGameLobbyOrThrowAlert(page: Page) {
  const gameLobby = page.getByText(/game lobby/i);
  const alert = page.getByRole('alert');
  await expect(gameLobby.or(alert).first()).toBeVisible({ timeout: 15000 });
  if (await alert.isVisible()) {
    const message = (await alert.innerText()).trim() || 'Unknown lobby error';
    throw new Error(message);
  }
}

export const test = baseTest.extend<{
  createRoom: (page: Page, roomName: string, playerName: string, options?: CreateRoomOptions) => Promise<void>;
  joinRoom: (page: Page, roomName: string, playerName: string) => Promise<void>;
}>({
  createRoom: async ({ page }, provide) => {
    void page;
    await provide(async (pageArg, roomName, playerName, options) => {
      await pageArg.goto('/');
      const createRegion = pageArg.getByRole('region', { name: /create table/i });
      await createRegion.getByLabel(/room name/i).fill(roomName);
      await createRegion.getByLabel(/player alias/i).fill(playerName);
      
      const smallBlind = options?.smallBlind ?? '10';
      const bigBlind = options?.bigBlind ?? '20';
      const buyIn = options?.buyIn ?? '1000';

      await createRegion.getByLabel(/small blind/i).fill(smallBlind);
      await createRegion.getByLabel(/big blind/i).fill(bigBlind);
      await createRegion.getByLabel(/buy-in/i).fill(buyIn);

      await pageArg.getByRole('button', { name: /establish table/i }).click();
      await expectGameLobbyOrThrowAlert(pageArg);
    });
  },
  joinRoom: async ({ page }, provide) => {
    void page;
    await provide(async (pageArg, roomName, playerName) => {
      await pageArg.goto('/');
      const joinRegion = pageArg.getByRole('region', { name: /quick join/i });
      await joinRegion.getByLabel(/room name/i).fill(roomName);
      await joinRegion.getByLabel(/player alias/i).fill(playerName);
      await pageArg.getByRole('button', { name: /enter vault/i }).click();
      await expectGameLobbyOrThrowAlert(pageArg);
    });
  },
});

export { expect };
export type { Page, BrowserContext } from '@playwright/test';
