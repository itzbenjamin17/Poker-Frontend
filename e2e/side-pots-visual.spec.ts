import { test, expect, type BrowserContext } from './fixtures';

test.describe('Item 35: Visual rendering of side pots in multi-way all-in', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('visually renders main pot and side pots on table in 3-way unequal stack all-in scenario', async ({
    browser,
  }) => {
    // Desktop viewport where pot breakdown is always visible
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    contexts.push(context);

    const page = await context.newPage();
    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;

    const roomId = 'SIDE_POT_ROOM';

    await page.addInitScript(
      ({ authToken, rId }) => {
        window.localStorage.setItem(
          'poker-auth',
          JSON.stringify({
            token: authToken,
            roomId: rId,
            playerName: 'PlayerA',
            playerId: 'p-1',
          }),
        );
        window.localStorage.setItem('poker-e2e-mock', 'true');
      },
      { authToken: token, rId: roomId },
    );

    // Mock room info
    await page.route(`**/api/room/${roomId}`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          roomId,
          roomName: 'Unequal All-In Arena',
          players: [
            { name: 'PlayerA', isHost: true },
            { name: 'PlayerB', isHost: false },
            { name: 'PlayerC', isHost: false },
          ],
          gameStarted: true,
        }),
      }),
    );

    // Mock multi-way all-in game state with unequal stacks:
    // Player A was all-in for 100 (pot contribution 100)
    // Player B was all-in for 200 (pot contribution 200)
    // Player C called 200 (pot contribution 200)
    // Main Pot = 100 * 3 = 300
    // Side Pot 1 = 100 * 2 = 200
    // Total Pot = 500
    await page.route(`**/api/game/${roomId}/state`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          gameId: roomId,
          phase: 'ALL_IN',
          pot: 500,
          pots: [300, 200], // Main pot: $300, Side pot 1: $200
          currentBet: 200,
          communityCards: ['AH', 'KD', 'QS', 'JH', 'TC'],
          currentPlayerId: null,
          currentPlayerName: null,
          legalActions: [],
          players: [
            { id: 'p-1', name: 'PlayerA', chips: 0, currentBet: 100, status: 'ACTIVE', hasFolded: false },
            { id: 'p-2', name: 'PlayerB', chips: 0, currentBet: 200, status: 'ACTIVE', hasFolded: false },
            { id: 'p-3', name: 'PlayerC', chips: 100, currentBet: 200, status: 'ACTIVE', hasFolded: false },
          ],
        }),
      }),
    );

    await page.route(`**/api/game/${roomId}/private-state`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
      }),
    );

    await page.goto('/');

    // 1. Prominent pot badge switches to "Main Pot" and displays $300
    const mainPotBadge = page.getByLabel('Main Pot');
    await expect(mainPotBadge).toBeVisible();
    await expect(mainPotBadge).toContainText('$300');

    // 2. Pot Breakdown region displays both Main Pot ($300) and Side Pot 1 ($200)
    const breakdownRegion = page.getByRole('region', { name: /pot breakdown/i });
    await expect(breakdownRegion).toBeVisible();

    await expect(breakdownRegion.getByText('Main Pot')).toBeVisible();
    await expect(breakdownRegion.getByText('$300')).toBeVisible();

    await expect(breakdownRegion.getByText('Side Pot 1')).toBeVisible();
    await expect(breakdownRegion.getByText('$200')).toBeVisible();
  });
});
