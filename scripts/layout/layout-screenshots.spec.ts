import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { setupStompWebSocketMock } from '../../e2e/support/stompWsMock';

const viewports = [
    { name: 'iPhone14Landscape', width: 844, height: 390 },
    { name: 'Tablet', width: 1024, height: 768 },
    { name: 'Laptop', width: 1366, height: 768 },
    { name: 'Desktop', width: 1920, height: 1080 },
    // New wacky ones at the edges of the gates
    { name: 'MobileLandscape_Min', width: 667, height: 375 },
    { name: 'Desktop_MinHeight', width: 1024, height: 600 },
    { name: 'DesktopWide_MinHeight', width: 1920, height: 600 },
    { name: 'Portrait_MinWidth', width: 600, height: 800 }
];

const screenshotDir = process.env.ARTIFACT_DIR
    ? path.resolve(process.env.ARTIFACT_DIR)
    : path.resolve(process.cwd(), 'test-results', 'layout-screenshots');

// Overwrite only screenshots produced by this suite; preserve unrelated artifacts.
fs.mkdirSync(screenshotDir, { recursive: true });

test.describe('Layout Screenshots 3 to 10 players', () => {
    test.setTimeout(120000); // 2 minutes for all

    for (let numPlayers = 3; numPlayers <= 10; numPlayers++) {
        test(`Capture ${numPlayers} players layout`, async ({ browser }) => {
            const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
            const page = await context.newPage();

            const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
            const roomId = `ROOM_${numPlayers}P`;

            await page.addInitScript(({ authToken, id }) => {
                window.localStorage.setItem('poker-auth', JSON.stringify({
                    token: authToken,
                    roomId: id,
                    playerName: 'Host',
                    message: 'Success',
                }));
            }, { authToken: token, id: roomId });

            await setupStompWebSocketMock(page);

            const generatePlayers = (count: number) => {
                const players = [];
                for (let i = 1; i <= count; i++) {
                    players.push({
                        id: `p-${i}`,
                        name: i === 1 ? 'Host' : `Player ${i}`,
                        chips: 1000 - (i * 10),
                        currentBet: i === 1 ? 20 : i === 2 ? 10 : 0,
                        status: 'ACTIVE',
                        hasFolded: false,
                        isBigBlind: i === 1,
                        isSmallBlind: i === 2
                    });
                }
                return players;
            };

            const mockRoom = {
                roomId,
                roomName: `Test Room ${numPlayers}P`,
                maxPlayers: numPlayers,
                buyIn: 1000,
                smallBlind: 10,
                bigBlind: 20,
                createdAt: '2026-01-01T00:00:00.000Z',
                hostName: 'Host',
                currentPlayers: numPlayers,
                canStartGame: false,
                players: generatePlayers(numPlayers).map(p => ({ name: p.name, isHost: p.id === 'p-1', joinedAt: '2026-01-01T00:00:00.000Z' })),
                gameStarted: true,
            };

            await page.route(`**/api/room/${roomId}`, (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(mockRoom),
            }));

            // 1. Regular State Mock (FLOP)
            const mockFlopState = {
                gameId: roomId,
                maxPlayers: numPlayers,
                phase: 'FLOP',
                pot: 80,
                pots: [30, 20, 15, 10, 5],
                currentBet: 20,
                communityCards: ['QH', 'JH', 'TH'],
                currentPlayerId: 'p-1',
                currentPlayerName: 'Host',
                legalActions: ['FOLD', 'CALL', 'RAISE'],
                players: generatePlayers(numPlayers),
                isGameOver: false
            };

            await page.route(`**/api/game/${roomId}/state`, (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(mockFlopState),
            }));

            await page.route(`**/api/game/${roomId}/private-state`, (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
            }));

            await page.goto(`http://localhost:5173/room/${roomId}`);
            
            // Wait for poker table
            await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
            await page.waitForTimeout(500); // UI init

            for (const vp of viewports) {
                await page.setViewportSize({ width: vp.width, height: vp.height });
                await page.waitForTimeout(800);
                await page.screenshot({ path: path.join(screenshotDir, `regular_${numPlayers}p_${vp.name}.png`) });
                await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
                
            }

            // 2. Showdown State Mock
            const mockShowdownState = {
                ...mockFlopState,
                phase: 'SHOWDOWN',
                communityCards: ['QH', 'JH', 'TH', '2S', '2D'],
                isGameOver: true,
                showdownWinner: {
                    playerId: 'p-1',
                    handRank: 'Royal Flush',
                    bestHand: ['AS', 'KS', 'QH', 'JH', 'TH'],
                    payouts: { 'p-1': 80 }
                },
                players: mockFlopState.players.map(p => ({
                    ...p,
                    holeCards: p.id === 'p-1' ? ['AS', 'KS'] : ['9H', '8H'],
                    handRank: p.id === 'p-1' ? 'Royal Flush' : 'Two Pair',
                    bestHand: p.id === 'p-1' ? ['AS', 'KS', 'QH', 'JH', 'TH'] : ['QH', 'JH', '9H', '8H', 'TH'],
                    isWinner: p.id === 'p-1',
                    chipsWon: p.id === 'p-1' ? 80 : 0
                }))
            };

            await page.unroute(`**/api/game/${roomId}/state`);
            await page.route(`**/api/game/${roomId}/state`, (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(mockShowdownState),
            }));

            // Force refresh state
            await page.reload();
            await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
            await page.waitForTimeout(1500);
            await page.waitForTimeout(500);

            for (const vp of viewports) {
                await page.setViewportSize({ width: vp.width, height: vp.height });
                await page.waitForTimeout(800);
                await page.screenshot({ path: path.join(screenshotDir, `showdown_${numPlayers}p_${vp.name}.png`) });
                await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
            }

            await context.close();
        });
    }
});

