// @vitest-environment node
import { Client } from '@stomp/stompjs';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { isJwtValid } from '../../services/api';
import * as fixtures from '../fixtures';
import { server } from '../mocks/server';

describe('shared test infrastructure (node)', () => {
    describe('fixtures', () => {
        it('returns a deterministic far-future JWT from createMockJwt() unaffected by fake system time', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
            const tokenNow = fixtures.createMockJwt();
            expect(isJwtValid(tokenNow)).toBe(true);

            vi.setSystemTime(new Date('2050-01-01T00:00:00Z'));
            const tokenFuture = fixtures.createMockJwt();
            expect(tokenFuture).toBe(tokenNow);
            expect(isJwtValid(tokenFuture)).toBe(true);
        });

        it('supports numeric exp and custom claim objects in createMockJwt()', () => {
            const numericToken = fixtures.createMockJwt(1_234_567_890);
            const numericPayload = JSON.parse(atob(numericToken.split('.')[1])) as { exp: number };
            expect(numericPayload.exp).toBe(1_234_567_890);

            const tokenA = fixtures.createMockJwt({ sub: 'alice', jti: 'tok-a', exp: 2_000_000_000 });
            const tokenB = fixtures.createMockJwt({ sub: 'bob', jti: 'tok-b', exp: 2_000_000_000 });
            expect(tokenA).not.toBe(tokenB);

            const payloadA = JSON.parse(atob(tokenA.split('.')[1])) as { exp: number; sub: string; jti: string };
            expect(payloadA).toEqual({ exp: 2_000_000_000, sub: 'alice', jti: 'tok-a' });
        });

        it('builds an expired JWT relative to nowMs via createExpiredJwt()', () => {
            const nowMs = Date.UTC(2026, 5, 1, 12, 0, 0);
            vi.useFakeTimers();
            vi.setSystemTime(nowMs);

            const expired = fixtures.createExpiredJwt(nowMs);
            expect(isJwtValid(expired)).toBe(false);
        });

        it('returns fresh AuthResponse objects from createMockAuth() and freezes mockAuth', () => {
            const authA = fixtures.createMockAuth();
            const authB = fixtures.createMockAuth({ playerName: 'Alice' });

            expect(authA).not.toBe(authB);
            expect(isJwtValid(authA.token)).toBe(true);
            expect(authB.playerName).toBe('Alice');

            expect(Object.isFrozen(fixtures.mockAuth)).toBe(true);
            const firstReadToken = fixtures.mockAuth.token;
            const secondReadToken = fixtures.mockAuth.token;
            expect(secondReadToken).toBe(firstReadToken);
            expect(isJwtValid(firstReadToken)).toBe(true);
        });

        it('provides typed valid builders and raw malformed payload builders', () => {
            const player = fixtures.createValidPlayer({ name: 'Alice', chips: 500 });
            const game = fixtures.createValidGameState({ players: [{ id: 'p-a', name: 'Alice' }] });
            const room = fixtures.createValidRoomData({ roomName: 'VIP Room' });
            const rawGame = fixtures.createRawGameStatePayload({ pot: 'bad-money' });
            const rawRoom = fixtures.createRawRoomDataPayload({ maxPlayers: 'not-a-number' });

            expect(player.name).toBe('Alice');
            expect(game.players[0].name).toBe('Alice');
            expect(room.roomName).toBe('VIP Room');
            expect(rawGame.pot).toBe('bad-money');
            expect(rawRoom.maxPlayers).toBe('not-a-number');
        });
    });

    describe('STOMP client isolation', () => {
        it('does not globally mock @stomp/stompjs unless mocks/stomp is imported', () => {
            const client = new Client();
            expect(client.constructor.name).not.toBe('MockStompClient');
        });
    });

    describe('MSW in @vitest-environment node', () => {
        it('intercepts fetch via server.use in node environment', async () => {
            server.use(
                http.get('http://localhost/test-node-msw', () => HttpResponse.json({ ok: true }))
            );

            const res = await fetch('http://localhost/test-node-msw');
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ ok: true });
        });

        it('resets per-test handlers after the previous node test', async () => {
            await expect(fetch('http://localhost/test-node-msw')).rejects.toThrow();
        });

        it('validates room requests, auth headers, and returns RFC 9457 problem+json 404 defaults', async () => {
            const badJoin = await fetch('http://localhost/api/room/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName: '   ', playerName: 'Alice' }),
            });
            expect(badJoin.status).toBe(400);
            expect(badJoin.headers.get('content-type')).toContain('application/problem+json');

            const badCreate = await fetch('http://localhost/api/room/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: '  ' }),
            });
            expect(badCreate.status).toBe(400);
            expect(badCreate.headers.get('content-type')).toContain('application/problem+json');

            const sentinelJoin = await fetch('http://localhost/api/room/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName: 'INVALID', playerName: 'Alice' }),
            });
            expect(sentinelJoin.status).toBe(200);

            const badAuthRoom = await fetch('http://localhost/api/room/room-1', {
                headers: { Authorization: 'Basic abc' },
            });
            expect(badAuthRoom.status).toBe(401);
            expect(badAuthRoom.headers.get('content-type')).toContain('application/problem+json');

            for (const path of ['state', 'private-state', 'review']) {
                const defaultRes = await fetch(`http://localhost/api/game/g-1/${path}`);
                expect(defaultRes.status).toBe(404);
                expect(defaultRes.headers.get('content-type')).toContain('application/problem+json');
            }
        });
    });

    describe('global afterEach hygiene in node', () => {
        const helper = { greet: () => 'real' };

        it('mutates fake timers, env, globals, and spies without manual cleanup', () => {
            vi.useFakeTimers();
            vi.stubEnv('VITE_DEBUG_STOMP', 'true');
            vi.stubGlobal('__TEST_INFRA_GLOBAL__', 'leaked');
            vi.spyOn(helper, 'greet').mockReturnValue('mocked');

            expect(vi.isFakeTimers()).toBe(true);
            expect(import.meta.env.VITE_DEBUG_STOMP).toBe('true');
            expect((globalThis as Record<string, unknown>).__TEST_INFRA_GLOBAL__).toBe('leaked');
            expect(helper.greet()).toBe('mocked');
        });

        it('starts the next test with clean real timers, envs, globals, and spies', () => {
            expect(vi.isFakeTimers()).toBe(false);
            expect(import.meta.env.VITE_DEBUG_STOMP).not.toBe('true');
            expect((globalThis as Record<string, unknown>).__TEST_INFRA_GLOBAL__).toBeUndefined();
            expect(helper.greet()).toBe('real');
        });
    });
});
