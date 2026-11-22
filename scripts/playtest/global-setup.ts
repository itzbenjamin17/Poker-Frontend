import { PLAYTEST_TIMINGS } from './timings';

const API = 'http://localhost:8080/api';
const TOLERANCE_MS = 2_000;

async function post(path: string, body?: unknown, token?: string): Promise<Response> {
    return fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

/**
 * Fails fast when the backend on :8080 was not started with the playtest timings (for example a
 * normal `npm run backend:e2e` run that Playwright reused), since every timer spec would then lie.
 */
export default async function globalSetup(): Promise<void> {
    const roomName = `pt-setup-${Date.now()}`;
    const created = await post('/room/create', {
        roomName, playerName: 'SetupA', maxPlayers: 2, smallBlind: 10, bigBlind: 20, buyIn: 1000,
    });
    if (!created.ok) throw new Error(`Playtest setup: create room failed (${created.status}): ${await created.text()}`);
    const host = await created.json() as { token: string; roomId: string };
    const joined = await post('/room/join', { roomName, playerName: 'SetupB' });
    if (!joined.ok) throw new Error(`Playtest setup: join failed (${joined.status}): ${await joined.text()}`);
    const guest = await joined.json() as { token: string };

    const started = await post(`/room/${host.roomId}/start-game`, undefined, host.token);
    if (started.status !== 204) throw new Error(`Playtest setup: start failed (${started.status})`);
    const stateRes = await fetch(`${API}/game/${host.roomId}/state`, { headers: { Authorization: `Bearer ${host.token}` } });
    const state = await stateRes.json() as { turnDeadlineEpochMs: number; serverTimeEpochMs: number };
    await post(`/room/${host.roomId}/leave`, undefined, guest.token);
    await post(`/room/${host.roomId}/leave`, undefined, host.token);

    const turnMs = state.turnDeadlineEpochMs - state.serverTimeEpochMs;
    if (Math.abs(turnMs - PLAYTEST_TIMINGS.turnAllowanceMs) > TOLERANCE_MS) {
        throw new Error(
            `The backend on :8080 has a ${Math.round(turnMs / 1000)}s turn allowance, not the playtest's `
            + `${PLAYTEST_TIMINGS.turnAllowanceMs / 1000}s. Stop it and rerun: the playtest config starts `
            + 'its own backend with scripts/playtest/timings.ts.',
        );
    }
}
