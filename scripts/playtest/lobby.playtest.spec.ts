import path from 'path';
import {
    test, expect, confirmLeave, expectMainLobby, expectRoomLobby, fillCreateForm, fillJoinForm, joinRoomUI,
    startGame, stateOf, uniqueRoom, type Page,
} from './helpers';
import { INACTIVITY_WARNING_WINDOW_MS, PLAYTEST_TIMINGS } from './timings';

interface CreateFields { roomName: string; playerName: string; password: string; smallBlind: string; bigBlind: string; buyIn: string }

const VALID: CreateFields = { roomName: 'Valid Room', playerName: 'Tester', password: '', smallBlind: '10', bigBlind: '20', buyIn: '1000' };

const INVALID_CREATES: Array<{ title: string; fields: Partial<CreateFields>; error: string; maxLength?: [keyof CreateFields, number] }> = [
    { title: 'blank room name', fields: { roomName: '   ' }, error: 'Room name is required.' },
    { title: 'blank alias', fields: { playerName: '' }, error: 'Player alias is required.' },
    { title: '51-character room name', fields: { roomName: 'r'.repeat(51) }, error: 'Room name must be at most 50 characters.', maxLength: ['roomName', 50] },
    { title: '31-character alias', fields: { playerName: 'a'.repeat(31) }, error: 'Alias must be at most 30 characters.', maxLength: ['playerName', 30] },
    { title: 'HTML in the room name', fields: { roomName: '<b>x</b>' }, error: 'Room name cannot contain HTML tags.' },
    { title: 'zero-width space in the alias', fields: { playerName: 'a​b' }, error: 'Player alias cannot contain format characters.' },
    { title: '51-character password', fields: { password: 'p'.repeat(51) }, error: 'Password must be at most 50 characters.', maxLength: ['password', 50] },
    { title: 'password over 72 UTF-8 bytes', fields: { password: '\u{1F600}'.repeat(19) }, error: 'Password must be at most 72 UTF-8 bytes.' },
    { title: 'small blind of 0', fields: { smallBlind: '0' }, error: 'Small blind must be between 1 and 10,000.' },
    { title: 'fractional small blind', fields: { smallBlind: '1.5' }, error: 'Small blind must be between 1 and 10,000.' },
    { title: 'big blind under twice the small blind', fields: { smallBlind: '10', bigBlind: '15' }, error: 'Big blind must be at least 2× the small blind.' },
    { title: 'buy-in under 20', fields: { buyIn: '19' }, error: 'Buy-in must be between 20 and 1,000,000 chips.' },
    { title: 'buy-in under the big blind', fields: { smallBlind: '20', bigBlind: '40', buyIn: '30' }, error: 'Buy-in must be at least the big blind amount.' },
];

function countRequests(page: Page, fragment: string): () => number {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes(fragment)) count++;
    });
    return () => count;
}

async function submitAndExpectAlert(page: Page, button: RegExp, message: RegExp | string): Promise<void> {
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByRole('alert').filter({ hasText: message }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: button })).toBeVisible();
}

test.describe('Lobby forms', () => {
    for (const { title, fields, error, maxLength } of INVALID_CREATES) {
        test(`create rejects ${title} without calling the server`, async ({ page }) => {
            const creates = countRequests(page, '/api/room/create');
            await page.goto('/');
            const form = page.getByRole('region', { name: /create table/i });
            const values = { ...VALID, ...fields };
            const inputs = {
                roomName: form.getByLabel(/room name/i), playerName: form.getByLabel(/player alias/i), password: form.getByLabel(/password/i),
                smallBlind: form.getByLabel(/small blind/i), bigBlind: form.getByLabel(/big blind/i), buyIn: form.getByLabel(/buy-in/i),
            };
            for (const key of Object.keys(inputs) as Array<keyof CreateFields>) await inputs[key].fill(values[key]);

            if (maxLength && (await inputs[maxLength[0]].inputValue()).length <= maxLength[1]) {
                // The field itself refuses the extra characters, so the over-long value can't be submitted.
                expect((await inputs[maxLength[0]].inputValue()).length).toBe(maxLength[1]);
                return;
            }
            await submitAndExpectAlert(page, /create game/i, error);
            expect(creates()).toBe(0);
        });
    }

    test('join rejects a blank room name and HTML in the alias without calling the server', async ({ page }) => {
        const joins = countRequests(page, '/api/room/join');
        await fillJoinForm(page, '  ', 'Tester');
        await submitAndExpectAlert(page, /^join game$/i, 'Room name is required.');
        await fillJoinForm(page, 'Some Room', '<i>me</i>');
        await submitAndExpectAlert(page, /^join game$/i, 'Player alias cannot contain HTML tags.');
        expect(joins()).toBe(0);
    });
});

test.describe('Lobby rules', () => {
    test('the server rejects a duplicate room, a taken alias in any case, an unknown room, a full room and a late join', async ({ tables }) => {
        const t = await tables(['Ann', 'Ben'], { maxPlayers: 3 });
        const outsider = await t.context('Ann').newPage();

        await fillCreateForm(outsider, t.roomName, 'Zed');
        await submitAndExpectAlert(outsider, /create game/i, /already taken/i);
        await fillJoinForm(outsider, t.roomName, 'ann');
        await submitAndExpectAlert(outsider, /^join game$/i, /player name already taken/i);
        await fillJoinForm(outsider, uniqueRoom('missing'), 'Zed');
        await submitAndExpectAlert(outsider, /^join game$/i, /not found|may not exist/i);

        await joinRoomUI(await t.context('Ann').newPage(), t.roomName, 'Cal');
        await fillJoinForm(outsider, t.roomName, 'Dee');
        await submitAndExpectAlert(outsider, /^join game$/i, /room is full/i);

        await t.page('Ann').getByRole('button', { name: /start game/i }).click();
        await expect(t.page('Ann').getByLabel(/total pot|main pot/i).first()).toBeVisible();
        await fillJoinForm(outsider, t.roomName, 'Eve');
        await submitAndExpectAlert(outsider, /^join game$/i, /already started/i);
    });

    test('names are trimmed: a padded room name and alias can be joined by their trimmed form', async ({ page }) => {
        const room = uniqueRoom('trim');
        await fillCreateForm(page, `  ${room}  `, '  Ann  ');
        await page.getByRole('button', { name: /create game/i }).click();
        await expectRoomLobby(page);
        await expect(page.getByText(room, { exact: true }).first()).toBeVisible();
        const guest = await page.context().newPage();
        await joinRoomUI(guest, room, 'Ben');
        await expect(guest.getByText('Ann', { exact: true })).toBeVisible();
    });

    test('room lobby: only the host can start once two players are in, and leaving asks first', async ({ tables }) => {
        const t = await tables(['Ann'], { maxPlayers: 3 });
        const ann = t.page('Ann');
        const start = ann.getByRole('button', { name: /start game/i });
        await expect(start).toBeDisabled();
        await expect(ann.getByText(/1 \/ 3 players joined/i)).toBeVisible();

        const ben = await t.context('Ann').newPage();
        await joinRoomUI(ben, t.roomName, 'Ben');
        await expect(ann.getByText('Ben', { exact: true })).toBeVisible();
        await expect(ann.getByText(/2 \/ 3 players joined/i)).toBeVisible();
        await expect(start).toBeEnabled();
        await expect(ben.getByText('Waiting for host to start...')).toBeVisible();
        await expect(ben.getByRole('button', { name: /start game/i })).toHaveCount(0);

        const leave = ben.getByRole('button', { name: /leave table/i });
        await leave.click();
        await ben.getByRole('dialog').getByRole('button', { name: 'Stay' }).click();
        await expect(ben.getByRole('dialog')).toBeHidden();
        await leave.click();
        await expect(ben.getByRole('dialog')).toBeVisible();
        await ben.keyboard.press('Escape');
        await expect(ben.getByRole('dialog')).toBeHidden();
        await expect(ben.getByText(/game lobby/i)).toBeVisible();

        await confirmLeave(ben, /leave table/i);
        await expectMainLobby(ben);
        await expect(ann.getByText('Ben', { exact: true })).toBeHidden();
        await expect(start).toBeDisabled();
    });

    test('copy room code puts the room name on the clipboard, and a clipboard failure says so', async ({ tables, browserName }) => {
        test.skip(browserName === 'webkit', 'WebKit has no clipboard permissions for Playwright to grant');
        const t = await tables(['Ann']);
        const ann = t.page('Ann');
        await t.context('Ann').grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
        await ann.getByRole('button', { name: /copy room code/i }).click();
        await expect(ann.getByText('Copied')).toBeVisible();
        expect(await ann.evaluate(() => navigator.clipboard.readText())).toBe(t.roomName);

        await ann.evaluate(() => {
            Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('denied')) });
        });
        await ann.getByRole('button', { name: /copy room code/i }).click();
        await expect(ann.getByText('Could not copy room code.')).toBeVisible();
    });

    test('double-clicking CREATE GAME and START GAME creates one room and starts one game', async ({ page }) => {
        const creates = countRequests(page, '/api/room/create');
        const starts = countRequests(page, '/start-game');
        const room = uniqueRoom('dbl');
        await fillCreateForm(page, room, 'Ann');
        await page.getByRole('button', { name: /create game/i }).dblclick();
        await expectRoomLobby(page);
        expect(creates()).toBe(1);

        const ben = await page.context().newPage();
        await joinRoomUI(ben, room, 'Ben');
        await page.getByRole('button', { name: /start game/i }).dblclick();
        await expect(page.getByLabel(/total pot|main pot/i).first()).toBeVisible();
        expect(starts()).toBe(1);
        expect((await stateOf(page)).handNumber).toBe(1);
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    test('an idle lobby warns everyone, then closes for everyone', async ({ tables }) => {
        test.setTimeout(PLAYTEST_TIMINGS.lobbyInactivityMs + 60_000);
        const t = await tables(['Ann', 'Ben']);
        const warnAfter = PLAYTEST_TIMINGS.lobbyInactivityMs - INACTIVITY_WARNING_WINDOW_MS;
        await Promise.all(t.names.map(name =>
            expect(t.page(name).getByText('Lobby Inactivity Warning')).toBeVisible({ timeout: warnAfter + 10_000 })));
        // The closing notice is brief, so watch every page at once.
        await Promise.all(t.names.map(async name => {
            await expect(t.page(name).getByText(/lobby closed due to inactivity/i)).toBeVisible({ timeout: INACTIVITY_WARNING_WINDOW_MS + 15_000 });
            await expectMainLobby(t.page(name));
        }));
    });
});

test('a started game cannot be joined even by a returning name', async ({ tables }) => {
    const t = await tables(['Ann', 'Ben']);
    await startGame(t);
    const page = await t.context('Ann').newPage();
    await fillJoinForm(page, t.roomName, 'Ben');
    await submitAndExpectAlert(page, /^join game$/i, /already started/i);
});

test('closing every tab and opening a new one offers to rejoin each held seat, and resumes the one clicked', async ({ tables }, testInfo) => {
    const t = await tables(['Ann', 'Ben']);
    const context = t.context('Ann');
    await t.page('Ann').close();
    await t.page('Ben').close();

    const fresh = await context.newPage();
    await fresh.goto('/');
    const seats = fresh.getByRole('region', { name: /your seats/i });
    await expect(seats.getByRole('button', { name: `Rejoin ${t.roomName} as Ann` })).toBeVisible();
    await expect(seats.getByRole('button', { name: `Rejoin ${t.roomName} as Ben` })).toBeVisible();
    await fresh.screenshot({ path: path.join(testInfo.project.outputDir, 'screens', `rejoin-panel-${testInfo.project.name}.png`), scale: 'css' });

    await seats.getByRole('button', { name: `Rejoin ${t.roomName} as Ben` }).click();
    await expectRoomLobby(fresh);
    expect((await fresh.evaluate(() => JSON.parse(sessionStorage.getItem('poker-auth') ?? 'null')))?.playerName).toBe('Ben');

    // Leaving gives the seat up, so a later tab offers only Ann. (Ben leaves: the host leaving would close the room.)
    await confirmLeave(fresh);
    await expectMainLobby(fresh);
    const later = await context.newPage();
    await later.goto('/');
    await expect(later.getByRole('button', { name: `Rejoin ${t.roomName} as Ann` })).toBeVisible();
    await expect(later.getByRole('button', { name: /as Ben$/ })).toHaveCount(0);
});
