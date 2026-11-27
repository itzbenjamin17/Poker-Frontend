import { test as baseTest, expect, type Page } from '@playwright/test';

export interface CreateRoomOptions {
  buyIn?: string;
  smallBlind?: string;
  bigBlind?: string;
  password?: string;
}

export interface JoinRoomOptions {
  password?: string;
}

async function expectGameLobbyOrThrowAlert(page: Page) {
  const gameLobby = page.getByText(/game lobby/i);
  const alert = page.getByRole('alert');
  await expect(gameLobby.or(alert).first()).toBeVisible({ timeout: 15000 });
  if ((await alert.count()) > 0 && (await alert.first().isVisible())) {
    const messages = (await alert.allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    throw new Error(messages.join(' | ') || 'Unknown lobby error');
  }
  await expect(gameLobby).toBeVisible({ timeout: 15000 });
}

export const test = baseTest.extend<{
  createRoom: (page: Page, roomName: string, playerName: string, options?: CreateRoomOptions) => Promise<void>;
  joinRoom: (page: Page, roomName: string, playerName: string, options?: JoinRoomOptions) => Promise<void>;
}>({
  // Playwright's runtime fixture parser requires object-destructuring syntax on parameter 1.
  // eslint-disable-next-line no-empty-pattern
  createRoom: async ({}, provide) => {
    await provide(async (pageArg, roomName, playerName, options) => {
      await pageArg.goto('/');
      const createRegion = pageArg.getByRole('region', { name: /create table/i });
      await createRegion.getByLabel(/room name/i).fill(roomName);
      await createRegion.getByLabel(/player alias/i).fill(playerName);
      if (options?.password !== undefined) {
        await createRegion.getByLabel(/password/i).fill(options.password);
      }

      const smallBlind = options?.smallBlind ?? '10';
      const bigBlind = options?.bigBlind ?? '20';

      await createRegion.getByLabel(/small blind/i).fill(smallBlind);
      await createRegion.getByLabel(/big blind/i).fill(bigBlind);
      if (options?.buyIn !== undefined) {
        await createRegion.getByLabel(/buy-in/i).fill(options.buyIn);
      }

      await pageArg.getByRole('button', { name: /create game/i }).click();
      await expectGameLobbyOrThrowAlert(pageArg);
    });
  },
  // eslint-disable-next-line no-empty-pattern
  joinRoom: async ({}, provide) => {
    await provide(async (pageArg, roomName, playerName, options) => {
      await pageArg.goto('/');
      const joinRegion = pageArg.getByRole('region', { name: /quick join/i });
      await joinRegion.getByLabel(/room name/i).fill(roomName);
      await joinRegion.getByLabel(/player alias/i).fill(playerName);
      if (options?.password !== undefined) {
        await joinRegion.getByLabel(/password/i).fill(options.password);
      }
      await pageArg.getByRole('button', { name: /^join game$/i }).click();
      await expectGameLobbyOrThrowAlert(pageArg);
    });
  },
});

export { expect };
export type { Page, BrowserContext } from '@playwright/test';
