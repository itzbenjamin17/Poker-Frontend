import { test as baseTest, expect, type Page } from '@playwright/test';

export interface CreateRoomOptions {
  buyIn?: string;
  smallBlind?: string;
  bigBlind?: string;
}

export const test = baseTest.extend<{
  createRoom: (page: Page, roomName: string, playerName: string, options?: CreateRoomOptions) => Promise<void>;
  joinRoom: (page: Page, roomName: string, playerName: string) => Promise<void>;
}>({
  createRoom: async ({}, use) => {
    await use(async (page, roomName, playerName, options) => {
      await page.goto('/');
      const createRegion = page.getByRole('region', { name: /create table/i });
      await createRegion.getByLabel(/room name/i).fill(roomName);
      await createRegion.getByLabel(/player alias/i).fill(playerName);
      
      if (options?.smallBlind) {
        await createRegion.getByLabel(/small blind/i).fill(options.smallBlind);
      }
      if (options?.bigBlind) {
        await createRegion.getByLabel(/big blind/i).fill(options.bigBlind);
      }
      if (options?.buyIn) {
        await createRegion.getByLabel(/buy-in/i).fill(options.buyIn);
      }

      await page.getByRole('button', { name: /establish table/i }).click();
      await expect(page.getByText(/game lobby/i)).toBeVisible({ timeout: 15000 });
    });
  },
  joinRoom: async ({}, use) => {
    await use(async (page, roomName, playerName) => {
      await page.goto('/');
      const joinRegion = page.getByRole('region', { name: /quick join/i });
      await joinRegion.getByLabel(/room name/i).fill(roomName);
      await joinRegion.getByLabel(/player alias/i).fill(playerName);
      await page.getByRole('button', { name: /enter vault/i }).click();
      await expect(page.getByText(/game lobby/i)).toBeVisible({ timeout: 15000 });
    });
  },
});

export { expect };
export type { Page, BrowserContext } from '@playwright/test';
