import { test, expect, type BrowserContext } from './fixtures';

test.describe('Game Table Flow', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('Two players can complete a simple betting round', async ({ browser, createRoom, joinRoom }) => {
    const roomName = `Game-E2E-${Math.floor(Math.random() * 1000)}`;
    const hostName = 'Host';
    const guestName = 'Guest';

    // 1. Setup Lobby
    const hostContext = await browser.newContext();
    contexts.push(hostContext);
    const guestContext = await browser.newContext();
    contexts.push(guestContext);
    
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    await createRoom(hostPage, roomName, hostName);
    await joinRoom(guestPage, roomName, guestName);

    await expect(hostPage.getByRole('heading', { name: guestName })).toBeVisible();

    // 2. Start Game
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Wait for transition to Game View
    // Heads-up rules: Guest (Dealer/SB) posts $10, Host (BB) posts $20, resulting in a $30 initial pot.
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('$30');
    await expect(guestPage.getByLabel(/total pot/i)).toContainText('$30');

    // Verify Hole Cards are present (at least the components exist)
    // Local player has 2 cards visible, opponent has 2 cards hidden
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(2); 
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);

    // 3. Simple Action (Determine who is current player)
    // In Heads-up play, Guest (index 1, Dealer/SB) acts first pre-flop.
    // Guest calls the $20 big blind (contributing $10 more).
    const guestCallBtn = guestPage.getByRole('button', { name: /call/i });
    await expect(guestCallBtn).toBeVisible();
    await guestCallBtn.click();

    // Host (index 0, Big Blind) receives the turn and has the option to Check.
    const hostCheckBtn = hostPage.getByRole('button', { name: /check/i });
    await expect(hostCheckBtn).toBeVisible();
    await hostCheckBtn.click();

    // 4. Verify Phase Change (Flop dealt)
    // Pot should be $40 now (20 from Host + 20 from Guest)
    await expect(hostPage.getByLabel(/total pot/i)).toContainText('$40');
    
    // Should see 3 community cards
    // Total cards on screen: 2 (hole) + 3 (community) = 5
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(5);
  });
});
