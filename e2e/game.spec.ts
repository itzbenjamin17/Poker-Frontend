import { test, expect } from '@playwright/test';

test.describe('Game Table Flow', () => {
  test('Two players can complete a simple betting round', async ({ browser }) => {
    const roomName = `Game-E2E-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'Host';
    const guestName = 'Guest';

    // 1. Setup Lobby
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    await hostPage.goto('/');
    const createRegion = hostPage.getByRole('region', { name: /create table/i });
    await createRegion.getByLabel(/room name/i).fill(roomName);
    await createRegion.getByLabel(/player alias/i).fill(hostName);
    await hostPage.getByRole('button', { name: /establish table/i }).click();

    await guestPage.goto('/');
    const joinRegion = guestPage.getByRole('region', { name: /quick join/i });
    await joinRegion.getByLabel(/room name/i).fill(roomName);
    await joinRegion.getByLabel(/player alias/i).fill(guestName);
    await guestPage.getByRole('button', { name: /enter vault/i }).click();

    await expect(hostPage.getByRole('heading', { name: guestName })).toBeVisible();

    // 2. Start Game
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Wait for transition to Game View
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('$30'); // Pre-flop pot (10 SB + 20 BB)
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('$30');

    // Verify Hole Cards are present (at least the components exist)
    // Local player has 2 cards visible, opponent has 2 cards hidden
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(2); 
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);

    // 3. Simple Action (Determine who is current player)
    // In Heads-up, Dealer is SB and acts first pre-flop.
    // Let's find which page has action buttons
    const foldBtn = hostPage.getByRole('button', { name: /fold/i });
    const callBtn = hostPage.getByRole('button', { name: /call/i });

    if (await foldBtn.isVisible()) {
      await callBtn.click();
      // Guest should now have turn
      await expect(guestPage.getByRole('button', { name: /check/i })).toBeVisible();
      await guestPage.getByRole('button', { name: /check/i }).click();
    } else {
      await guestPage.getByRole('button', { name: /call/i }).click();
      await expect(hostPage.getByRole('button', { name: /check/i })).toBeVisible();
      await hostPage.getByRole('button', { name: /check/i }).click();
    }

    // 4. Verify Phase Change (Flop dealt)
    // Pot should be $40 now (20 from each)
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('$40');
    
    // Should see 3 community cards
    // The selector finds images with name containing "of" (like "Ace of Spades")
    // Total cards on host screen: 2 (hole) + 3 (community) = 5
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(5);

    await hostContext.close();
    await guestContext.close();
  });
});
