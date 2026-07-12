import { test, expect, type BrowserContext, type Page } from './fixtures';

const eligibleViewports = [
  { width: 900, height: 500 },
  { width: 1100, height: 700 },
  { width: 1440, height: 900 },
] as const;

function expectInside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}

function expectNoOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const overlaps = a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
  expect(overlaps).toBe(false);
}

async function expectAdaptiveTable(page: Page, viewportWidth: number) {
  const pokerTable = page.getByRole('region', { name: /^poker table$/i });
  const actionDock = page.getByRole('region', { name: /action dock/i });
  const totalPot = page.getByLabel(/main pot|total pot/i);
  const heroSeat = page.getByRole('group', { name: /host hero seat/i });
  const opponentSeats = page.getByRole('group', { name: /player [2-6] seat/i });
  const communityCards = page.getByRole('img', { name: /queen of hearts|jack of hearts|ten of hearts/i });
  const visibleHoleCards = page.getByRole('img', { name: /ace of spades|king of spades/i });
  const hiddenHoleCards = page.getByLabel('Hidden Card');
  const foldAction = page.getByRole('button', { name: /fold/i });
  const raiseAction = page.getByRole('button', { name: /^Raise$/i, expanded: false });

  await expect(pokerTable).toBeVisible();
  await expect(actionDock).toBeVisible();
  await expect(totalPot).toBeVisible();
  await expect(heroSeat).toBeVisible();
  await expect(opponentSeats).toHaveCount(5);
  await expect(communityCards).toHaveCount(3);
  await expect(visibleHoleCards).toHaveCount(2);
  await expect(hiddenHoleCards).toHaveCount(10);
  await expect(foldAction).toBeVisible();
  await expect(raiseAction).toBeVisible();

  const viewport = page.viewportSize();
  const tableBox = await pokerTable.boundingBox();
  const dockBox = await actionDock.boundingBox();
  const potBox = await totalPot.boundingBox();
  const heroBox = await heroSeat.boundingBox();
  const foldBox = await foldAction.boundingBox();
  const raiseBox = await raiseAction.boundingBox();

  expect(viewport).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(potBox).not.toBeNull();
  expect(heroBox).not.toBeNull();
  expect(foldBox).not.toBeNull();
  expect(raiseBox).not.toBeNull();

  const viewportBox = { x: 0, y: 0, width: viewport!.width, height: viewport!.height };
  expectInside(tableBox!, viewportBox);
  expectInside(dockBox!, viewportBox);
  expectInside(potBox!, tableBox!);
  expectInside(heroBox!, tableBox!);
  expectInside(foldBox!, viewportBox);
  expect(potBox!.y + potBox!.height).toBeLessThan(heroBox!.y);
  expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
  expect(foldBox!.y).toBeGreaterThanOrEqual(dockBox!.y - 1);
  expect(raiseBox!.y).toBeGreaterThanOrEqual(dockBox!.y - 1);

  await raiseAction.click();
  const raiseAmount = page.getByLabel(/raise amount/i);
  await expect(raiseAmount).toBeVisible();
  const raiseAmountBox = await raiseAmount.boundingBox();
  expect(raiseAmountBox).not.toBeNull();
  expectInside(raiseAmountBox!, dockBox!);
  expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
  await page.getByRole('button', { name: /cancel/i }).click();

  for (const seat of await opponentSeats.all()) {
    const seatBox = await seat.boundingBox();
    expect(seatBox).not.toBeNull();
    expectInside(seatBox!, tableBox!);
  }

  for (const card of [...await communityCards.all(), ...await visibleHoleCards.all(), ...await hiddenHoleCards.all()]) {
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expectInside(cardBox!, tableBox!);
  }

  if (viewportWidth >= 1024) {
    const potBreakdownBox = await page.getByRole('region', { name: /pot breakdown/i }).boundingBox();
    const communityBoxes = await Promise.all((await communityCards.all()).map((card) => card.boundingBox()));
    const communityBottom = Math.max(...communityBoxes.map((box) => box!.y + box!.height));
    expect(potBreakdownBox).not.toBeNull();
    expect(potBreakdownBox!.y).toBeGreaterThanOrEqual(communityBottom - 1);
  } else {
    const compactDetailsBox = await page.getByRole('button', { name: /show pot details/i }).boundingBox();
    const communityBoxes = await Promise.all((await communityCards.all()).map((card) => card.boundingBox()));
    const communityBottom = Math.max(...communityBoxes.map((box) => box!.y + box!.height));
    expect(compactDetailsBox).not.toBeNull();
    expect(compactDetailsBox!.y).toBeGreaterThanOrEqual(communityBottom - 1);
  }
}

test.describe('Adaptive table-first foundation', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    contexts = [];
  });

  test('keeps the board cluster and hero seat usable across eligible viewport tiers', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    contexts.push(hostContext);

    const hostPage = await hostContext.newPage();
    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
    await hostPage.addInitScript(({ authToken }) => {
      window.localStorage.setItem('poker-auth', JSON.stringify({
        token: authToken,
        roomId: 'ROOM123',
        playerName: 'Host',
        playerId: 'p-1',
      }));
    }, { authToken: token });
    await hostPage.route('**/api/room/ROOM123', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        roomId: 'ROOM123',
        roomName: 'Adaptive Table',
        players: [
          { name: 'Host', isHost: true },
          { name: 'Guest', isHost: false },
        ],
        gameStarted: true,
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        gameId: 'ROOM123',
        phase: 'FLOP',
        pot: 30,
        pots: [20, 10],
        currentBet: 20,
        communityCards: ['QH', 'JH', 'TH'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'Host',
        legalActions: ['FOLD', 'CALL', 'RAISE'],
        players: [
          { id: 'p-1', name: 'Host', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
          { id: 'p-2', name: 'Player 2', chips: 990, currentBet: 10, status: 'ACTIVE', isSmallBlind: true },
          { id: 'p-3', name: 'Player 3', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-4', name: 'Player 4', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-5', name: 'Player 5', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-6', name: 'Player 6', chips: 1000, currentBet: 0, status: 'ACTIVE' },
        ],
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/private-state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
    }));
    await hostPage.goto('/');
    await expect(hostPage.getByLabel(/main pot/i)).toContainText('$20');

    for (const viewport of eligibleViewports) {
      await hostPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectAdaptiveTable(hostPage, viewport.width);
    }
  });

  test('keeps the waiting action dock visible without covering the table', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    contexts.push(hostContext);

    const hostPage = await hostContext.newPage();
    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
    await hostPage.addInitScript(({ authToken }) => {
      window.localStorage.setItem('poker-auth', JSON.stringify({
        token: authToken,
        roomId: 'ROOM123',
        playerName: 'Host',
        playerId: 'p-1',
      }));
    }, { authToken: token });
    await hostPage.route('**/api/room/ROOM123', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        roomId: 'ROOM123',
        roomName: 'Adaptive Table',
        players: [
          { name: 'Host', isHost: true },
          { name: 'Guest', isHost: false },
        ],
        gameStarted: true,
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        gameId: 'ROOM123',
        phase: 'FLOP',
        pot: 30,
        pots: [20, 10],
        currentBet: 20,
        communityCards: ['QH', 'JH', 'TH'],
        currentPlayerId: 'p-2',
        currentPlayerName: 'Player 2',
        players: [
          { id: 'p-1', name: 'Host', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
          { id: 'p-2', name: 'Player 2', chips: 990, currentBet: 10, status: 'ACTIVE', isSmallBlind: true },
          { id: 'p-3', name: 'Player 3', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-4', name: 'Player 4', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-5', name: 'Player 5', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-6', name: 'Player 6', chips: 1000, currentBet: 0, status: 'ACTIVE' },
        ],
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/private-state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
    }));
    await hostPage.goto('/');
    await expect(hostPage.getByRole('region', { name: /action dock/i })).toContainText(/waiting for player 2 to act/i);

    for (const viewport of eligibleViewports) {
      await hostPage.setViewportSize({ width: viewport.width, height: viewport.height });
      const pokerTable = hostPage.getByRole('region', { name: /^poker table$/i });
      const actionDock = hostPage.getByRole('region', { name: /action dock/i });
      const heroSeat = hostPage.getByRole('group', { name: /host hero seat/i });

      await expect(actionDock).toContainText(/waiting for player 2 to act/i);
      await expect(hostPage.getByRole('button', { name: /fold/i })).toHaveCount(0);

      const tableBox = await pokerTable.boundingBox();
      const dockBox = await actionDock.boundingBox();
      const heroBox = await heroSeat.boundingBox();
      expect(tableBox).not.toBeNull();
      expect(dockBox).not.toBeNull();
      expect(heroBox).not.toBeNull();
      expectInside(dockBox!, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
    }
  });

  test('keeps the collapsed round summary from covering the board cluster or hero seat', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    contexts.push(hostContext);

    const hostPage = await hostContext.newPage();
    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
    await hostPage.addInitScript(({ authToken }) => {
      window.localStorage.setItem('poker-auth', JSON.stringify({
        token: authToken,
        roomId: 'ROOM123',
        playerName: 'Host',
        playerId: 'p-1',
      }));
    }, { authToken: token });
    await hostPage.route('**/api/room/ROOM123', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        roomId: 'ROOM123',
        roomName: 'Adaptive Table',
        players: [
          { name: 'Host', isHost: true },
          { name: 'Guest', isHost: false },
        ],
        gameStarted: true,
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        gameId: 'ROOM123',
        phase: 'SHOWDOWN',
        pot: 1000,
        pots: [700, 300],
        currentBet: 0,
        communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
        currentPlayerId: '',
        currentPlayerName: '',
        winners: ['Host'],
        winningsPerPlayer: 1000,
        players: [
          { id: 'p-1', name: 'Host', chips: 1980, currentBet: 0, status: 'ACTIVE', handRank: 'TWO_PAIR', holeCards: ['AS', 'KS'], isWinner: true, chipsWon: 1000 },
          { id: 'p-2', name: 'Player 2', chips: 990, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-3', name: 'Player 3', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-4', name: 'Player 4', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-5', name: 'Player 5', chips: 1000, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-6', name: 'Player 6', chips: 1000, currentBet: 0, status: 'ACTIVE' },
        ],
      }),
    }));
    await hostPage.route('**/api/game/ROOM123/private-state', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
    }));

    await hostPage.goto('/');
    await expect(hostPage.getByRole('region', { name: /round result/i })).toContainText(/host won/i);

    for (const viewport of eligibleViewports) {
      await hostPage.setViewportSize({ width: viewport.width, height: viewport.height });
      const summary = hostPage.getByRole('region', { name: /round result/i });
      const totalPot = hostPage.getByLabel(/main pot|total pot/i);
      const heroSeat = hostPage.getByRole('group', { name: /host hero seat/i });

      await expect(summary).toBeVisible();
      const detailsToggle = summary.getByRole('button', { name: /show result details/i });
      await expect(detailsToggle).toBeVisible();

      const summaryBox = await summary.boundingBox();
      const potBox = await totalPot.boundingBox();
      const heroBox = await heroSeat.boundingBox();
      const detailsToggleBox = await detailsToggle.boundingBox();
      expect(summaryBox).not.toBeNull();
      expect(potBox).not.toBeNull();
      expect(heroBox).not.toBeNull();
      expect(detailsToggleBox).not.toBeNull();
      expect(detailsToggleBox!.width).toBeGreaterThanOrEqual(44);
      expect(detailsToggleBox!.height).toBeGreaterThanOrEqual(44);
      expectInside(summaryBox!, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      expectNoOverlap(summaryBox!, potBox!);
      expectNoOverlap(summaryBox!, heroBox!);

      await detailsToggle.click();
      await expect(summary.getByText(/main pot/i)).toBeVisible();
      await expect(summary.getByText(/side pot 1/i)).toBeVisible();
      const expandedSummaryBox = await summary.boundingBox();
      expect(expandedSummaryBox).not.toBeNull();
      expectInside(expandedSummaryBox!, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      expectNoOverlap(expandedSummaryBox!, potBox!);
      expectNoOverlap(expandedSummaryBox!, heroBox!);
      await expect(hostPage.getByRole('region', { name: /board cluster/i })).toBeVisible();
      const fullReviewTrigger = summary.getByRole('button', { name: /open full result review/i });
      const fullReviewTriggerBox = await fullReviewTrigger.boundingBox();
      expect(fullReviewTriggerBox).not.toBeNull();
      expect(fullReviewTriggerBox!.width).toBeGreaterThanOrEqual(44);
      expect(fullReviewTriggerBox!.height).toBeGreaterThanOrEqual(44);

      await fullReviewTrigger.click();
      const review = hostPage.getByRole('dialog', { name: /full result review/i });
      await expect(review).toBeVisible();
      await expect(review).toHaveCSS('transform', 'none');
      await expect(review.getByRole('img', { name: /ace of hearts/i })).toBeVisible();
      await expect(review.getByRole('img', { name: /ace of spades/i })).toBeVisible();
      await expect(review.getByText(/player outcomes/i)).toBeVisible();
      const reviewBox = await review.boundingBox();
      expect(reviewBox).not.toBeNull();
      expectInside(reviewBox!, { x: 0, y: 0, width: viewport.width, height: viewport.height });

      await review.getByRole('button', { name: /close full result review/i }).click();
      await expect(review).toHaveCount(0);
      await expect(summary.getByRole('button', { name: /open full result review/i })).toBeFocused();
      await summary.getByRole('button', { name: /hide result details/i }).click();
    }
  });
});
