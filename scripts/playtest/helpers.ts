import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ─── Server payload shapes (only the fields the playtest reads) ────────────────────────────────

/** Wire format: rank then suit letter, e.g. "10S", "QH". */
export type Card = string;

export interface PlayerState {
    id: string;
    name: string;
    chips: number;
    currentBet: number;
    status: string;
    isAllIn: boolean;
    isCurrentPlayer: boolean;
    hasFolded: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
    handRank: string | null;
    bestHand: Card[] | null;
    isWinner: boolean | null;
    chipsWon: number | null;
    holeCards: Card[] | null;
    disconnectDeadlineEpochMs: number | null;
    isReadyForNextHand: boolean | null;
}

export interface GameState {
    pot: number;
    pots: number[] | null;
    uncalledAmount: number | null;
    phase: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
    currentBet: number;
    communityCards: Card[] | null;
    players: PlayerState[];
    currentPlayerName: string | null;
    winners: string[] | null;
    isAutoAdvancing: boolean | null;
    isReadyCountdownActive: boolean | null;
    readyCountdownDeadlineEpochMs: number | null;
    claimWinAvailable: boolean | null;
    claimWinPlayerName: string | null;
    handSettled: boolean | null;
    carryOverAmount: number | null;
    legalActions: string[] | null;
    minimumBetAmount: number | null;
    minimumRaiseAmount: number | null;
    handNumber: number;
    readyGateState: 'CLOSED' | 'COUNTING_DOWN' | 'WAITING_FOR_PLAYERS';
    serverTimeEpochMs: number;
    stateRevision: number;
    turnDeadlineEpochMs: number | null;
    gameEnd?: { winner: string; winnerChips?: number; isForfeit: boolean; abandoned?: boolean; reason?: string; message: string };
}

export interface Probe {
    me: string | null;
    status: number;
    state: GameState | null;
    hole: Card[] | null;
}

// ─── Tables ────────────────────────────────────────────────────────────────────────────────────

export interface RoomOptions {
    smallBlind?: number;
    bigBlind?: number;
    buyIn?: number;
    maxPlayers?: number;
    password?: string;
}

export interface TableOptions extends RoomOptions {
    /** One browser context per player, so `context.setOffline` affects a single player. */
    separateContexts?: boolean;
}

export interface Table {
    roomName: string;
    buyIn: number;
    smallBlind: number;
    bigBlind: number;
    names: string[];
    page: (name: string) => Page;
    context: (name: string) => BrowserContext;
    /** Every WebSocket text frame each player's page received, in order. */
    frames: (name: string) => string[];
}

export function uniqueRoom(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
}

/** Throws the visible alert text if the lobby form was rejected. */
export async function expectRoomLobby(page: Page): Promise<void> {
    const lobby = page.getByText(/game lobby/i);
    const alert = page.getByRole('alert');
    await expect(lobby.or(alert).first()).toBeVisible({ timeout: 15_000 });
    if (!(await lobby.isVisible()) && (await alert.isVisible())) {
        throw new Error(`Lobby form rejected: ${(await alert.innerText()).trim()}`);
    }
}

export async function fillCreateForm(page: Page, roomName: string, playerName: string, opts: RoomOptions = {}): Promise<void> {
    await page.goto('/');
    const form = page.getByRole('region', { name: /create table/i });
    await form.getByLabel(/room name/i).fill(roomName);
    await form.getByLabel(/player alias/i).fill(playerName);
    if (opts.password !== undefined) await form.getByLabel(/password/i).fill(opts.password);
    await form.getByLabel(/small blind/i).fill(String(opts.smallBlind ?? 10));
    await form.getByLabel(/big blind/i).fill(String(opts.bigBlind ?? 20));
    await form.getByLabel(/buy-in/i).fill(String(opts.buyIn ?? 1000));
    if (opts.maxPlayers !== undefined) await page.locator('#max-players').fill(String(opts.maxPlayers));
}

export async function createRoomUI(page: Page, roomName: string, playerName: string, opts: RoomOptions = {}): Promise<void> {
    await fillCreateForm(page, roomName, playerName, opts);
    await page.getByRole('button', { name: /create game/i }).click();
    await expectRoomLobby(page);
}

export async function fillJoinForm(page: Page, roomName: string, playerName: string, password?: string): Promise<void> {
    await page.goto('/');
    const form = page.getByRole('region', { name: /quick join/i });
    await form.getByLabel(/room name/i).fill(roomName);
    await form.getByLabel(/player alias/i).fill(playerName);
    if (password !== undefined) await form.getByLabel(/password/i).fill(password);
}

export async function joinRoomUI(page: Page, roomName: string, playerName: string, password?: string): Promise<void> {
    await fillJoinForm(page, roomName, playerName, password);
    await page.getByRole('button', { name: /^join game$/i }).click();
    await expectRoomLobby(page);
}

function captureFrames(page: Page, into: string[]): void {
    page.on('websocket', ws => {
        ws.on('framereceived', frame => {
            into.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'));
        });
    });
}

async function openTable(browser: Browser, owned: BrowserContext[], names: string[], opts: TableOptions): Promise<Table> {
    const roomName = uniqueRoom('pt');
    const pages = new Map<string, Page>();
    const contexts = new Map<string, BrowserContext>();
    const frames = new Map<string, string[]>();
    let shared: BrowserContext | null = null;

    for (const [i, name] of names.entries()) {
        let context: BrowserContext;
        if (opts.separateContexts) {
            context = await browser.newContext();
            owned.push(context);
        } else {
            if (!shared) {
                shared = await browser.newContext();
                owned.push(shared);
            }
            context = shared;
        }
        const page = await context.newPage();
        const received: string[] = [];
        captureFrames(page, received);
        pages.set(name, page);
        contexts.set(name, context);
        frames.set(name, received);
        if (i === 0) {
            await createRoomUI(page, roomName, name, { maxPlayers: Math.max(names.length, 2), ...opts });
        } else {
            await joinRoomUI(page, roomName, name, opts.password);
        }
    }

    const lookup = <T>(map: Map<string, T>, name: string): T => {
        const value = map.get(name);
        if (value === undefined) throw new Error(`No player named ${name} at this table`);
        return value;
    };
    return {
        roomName,
        buyIn: opts.buyIn ?? 1000,
        smallBlind: opts.smallBlind ?? 10,
        bigBlind: opts.bigBlind ?? 20,
        names,
        page: name => lookup(pages, name),
        context: name => lookup(contexts, name),
        frames: name => lookup(frames, name),
    };
}

/** `tables(names, opts)` opens one page per player (the first creates the room); contexts close after the test. */
export const test = base.extend<{ tables: (names: string[], opts?: TableOptions) => Promise<Table> }>({
    tables: async ({ browser }, provide) => {
        const owned: BrowserContext[] = [];
        await provide((names, opts = {}) => openTable(browser, owned, names, opts));
        await Promise.all(owned.map(context => context.close().catch(() => undefined)));
    },
});

export { expect };
export type { Page };

// ─── Authoritative state ───────────────────────────────────────────────────────────────────────

/** Reads the page's own tab auth and fetches the public and private state the server holds for it. */
export async function probe(page: Page): Promise<Probe> {
    return page.evaluate(async () => {
        const raw = sessionStorage.getItem('poker-auth');
        if (!raw) return { me: null, status: 0, state: null, hole: null };
        const auth = JSON.parse(raw) as { token: string; roomId: string; playerName: string };
        const headers = { Authorization: `Bearer ${auth.token}` };
        const pub = await fetch(`/api/game/${auth.roomId}/state`, { headers });
        const priv = await fetch(`/api/game/${auth.roomId}/private-state`, { headers });
        const state = pub.ok ? await pub.json() : null;
        const hole = priv.ok ? ((await priv.json()) as { holeCards?: unknown }).holeCards ?? null : null;
        return { me: auth.playerName, status: pub.status, state, hole } as never;
    });
}

/** The finished-game review the server keeps until cleanup (HTTP 200 with `gameEnd`), or the error status. */
export async function reviewOf(page: Page): Promise<{ status: number; state: GameState | null }> {
    return page.evaluate(async () => {
        const raw = sessionStorage.getItem('poker-auth');
        if (!raw) return { status: 0, state: null };
        const auth = JSON.parse(raw) as { token: string; roomId: string };
        const res = await fetch(`/api/game/${auth.roomId}/review`, { headers: { Authorization: `Bearer ${auth.token}` } });
        return { status: res.status, state: res.ok ? await res.json() : null } as never;
    });
}

export async function stateOf(page: Page): Promise<GameState> {
    const result = await probe(page);
    if (!result.state) throw new Error(`No game state for ${result.me ?? 'an unauthenticated page'} (HTTP ${result.status})`);
    return result.state;
}

export function playerIn(state: GameState, name: string): PlayerState {
    const player = state.players.find(p => p.name === name);
    if (!player) throw new Error(`${name} is not in the game state (${state.players.map(p => p.name).join(', ')})`);
    return player;
}

/**
 * Chips the table accounts for: stacks plus the pot. The server zeroes the pot when it pays a hand
 * out and leaves only unclaimed (carry-over) chips in it.
 */
export function chipsAccountedFor(state: GameState): number {
    return state.players.reduce((total, p) => total + p.chips, 0) + state.pot;
}

export function expectChipsConserved(state: GameState, expectedTotal: number, when: string): void {
    expect(chipsAccountedFor(state), `chip conservation ${when}: ${JSON.stringify(state.players.map(p => [p.name, p.chips]))} pot=${state.pot} settled=${state.handSettled}`)
        .toBe(expectedTotal);
}

// ─── Driving play ──────────────────────────────────────────────────────────────────────────────

export async function startGame(table: Table): Promise<GameState> {
    const host = table.page(table.names[0]);
    await host.getByRole('button', { name: /start game/i }).click();
    for (const name of table.names) {
        await expect(table.page(name).getByLabel(/total pot|main pot/i).first()).toBeVisible({ timeout: 15_000 });
    }
    return stateOf(host);
}

/** Waits until the server names a player to act (not during a runout or after the hand settles). */
export async function waitForActor(page: Page, timeout = 15_000): Promise<GameState> {
    let latest: GameState | null = null;
    await expect.poll(async () => {
        latest = (await probe(page)).state;
        return Boolean(latest?.currentPlayerName && !latest.isAutoAdvancing && !latest.handSettled && latest.phase !== 'SHOWDOWN');
    }, { timeout, message: 'waiting for a player to act' }).toBe(true);
    return latest as unknown as GameState;
}

export async function waitForSettled(page: Page, timeout = 30_000): Promise<GameState> {
    let latest: GameState | null = null;
    await expect.poll(async () => {
        latest = (await probe(page)).state;
        return Boolean(latest?.handSettled);
    }, { timeout, message: 'waiting for the hand to settle' }).toBe(true);
    return latest as unknown as GameState;
}

export type Action = 'FOLD' | 'CHECK' | 'CALL' | 'ALL_IN' | { bet: number } | { raise: number };

export function actionButton(page: Page, action: 'FOLD' | 'CHECK' | 'CALL' | 'ALL_IN' | 'BET' | 'RAISE') {
    const names = { FOLD: /^fold$/i, CHECK: /^check$/i, CALL: /^call\b/i, ALL_IN: /^all in\b/i, BET: /^bet$/i, RAISE: /^raise$/i };
    return page.getByRole('button', { name: names[action] });
}

/** Clicks the action through the UI as the acting player and waits for the server to apply it. */
export async function act(page: Page, action: Action): Promise<GameState> {
    const before = await stateOf(page);
    if (typeof action === 'string') {
        await actionButton(page, action).click();
    } else {
        const kind = 'bet' in action ? 'BET' : 'RAISE';
        const amount = 'bet' in action ? action.bet : action.raise;
        await actionButton(page, kind).click();
        await page.getByLabel('Raise amount').fill(String(amount));
        const confirmLabel = kind === 'BET' ? /^bet(\s+[\d,]+)?$/i : /^raise(\s+[\d,]+)?$/i;
        await page.getByRole('button', { name: confirmLabel }).click();
    }
    let after: GameState | null = null;
    await expect.poll(async () => {
        after = (await probe(page)).state;
        return Boolean(after && (after.handNumber !== before.handNumber || after.stateRevision > before.stateRevision));
    }, { message: `waiting for the server to apply ${JSON.stringify(action)}` }).toBe(true);
    return after as unknown as GameState;
}

export type Policy = (actor: string, state: GameState) => Action;

/** Check when possible, otherwise call. Never raises, so hands with equal stacks have a single pot. */
export const checkOrCall: Policy = (_actor, state) => (state.legalActions?.includes('CHECK') ? 'CHECK' : 'CALL');

export interface PlayHandOptions {
    /** Any seated player's page, used to read state. Defaults to the first player's. */
    observer?: Page;
    /** Runs on each turn before the action, from the actor's page. */
    beforeAct?: (actor: string, state: GameState, page: Page) => Promise<void>;
    maxActions?: number;
}

/** Plays the current hand to settlement with `policy`, acting from each actor's own page. */
export async function playHand(table: Table, policy: Policy, options: PlayHandOptions = {}): Promise<GameState> {
    const observer = options.observer ?? table.page(table.names[0]);
    const maxActions = options.maxActions ?? 60;
    for (let i = 0; i < maxActions; i++) {
        const state = await stateOf(observer);
        if (state.handSettled) return state;
        if (!state.currentPlayerName || state.isAutoAdvancing) {
            await expect.poll(async () => {
                const s = await stateOf(observer);
                return Boolean(s.handSettled || (s.currentPlayerName && !s.isAutoAdvancing));
            }, { timeout: 30_000 }).toBe(true);
            continue;
        }
        const actor = state.currentPlayerName;
        const actorPage = table.page(actor);
        const actorState = await waitForActor(actorPage);
        await options.beforeAct?.(actor, actorState, actorPage);
        await act(actorPage, policy(actor, actorState));
    }
    throw new Error(`Hand did not settle within ${maxActions} actions`);
}

/** Clicks READY for every listed player and waits for the next hand to be dealt. */
export async function readyUp(table: Table, names: string[] = table.names): Promise<GameState> {
    const observer = table.page(names[0]);
    const before = await stateOf(observer);
    for (const name of names) {
        const page = table.page(name);
        const ready = page.getByRole('button', { name: /^ready$/i });
        if (await ready.isVisible().catch(() => false)) await ready.click();
    }
    let next: GameState | null = null;
    await expect.poll(async () => {
        next = await stateOf(observer);
        return next.handNumber > before.handNumber && !next.handSettled;
    }, { timeout: 20_000, message: 'waiting for the next hand' }).toBe(true);
    return next as unknown as GameState;
}

export async function confirmLeave(page: Page, trigger: RegExp = /leave table|^leave$/i): Promise<void> {
    await page.getByRole('button', { name: trigger }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
}

/** The main lobby (create/join forms) is showing. */
export async function expectMainLobby(page: Page, timeout = 15_000): Promise<void> {
    await expect(page.getByRole('button', { name: /create game/i })).toBeVisible({ timeout });
}
