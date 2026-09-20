import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { isJwtValid, getErrorMessage, pokerApi } from '../api';

function toBase64Url(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(payload: Record<string, unknown>): string {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const pl = toBase64Url(JSON.stringify(payload));
    return `${header}.${pl}.fake-signature`;
}

describe('api service', () => {
    describe('isJwtValid', () => {
        it('returns true for valid token expiring in 1 hour', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            expect(isJwtValid(token)).toBe(true);
        });

        it('returns false for expired token expired 1 hour ago', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
            expect(isJwtValid(token)).toBe(false);
        });

        it('returns false for malformed token with fewer or more than 3 parts', () => {
            expect(isJwtValid('header.payload')).toBe(false);
            expect(isJwtValid('header.payload.sig.extra')).toBe(false);
            expect(isJwtValid('single-string')).toBe(false);
        });

        it('returns false for token with non-base64 payload', () => {
            expect(isJwtValid('header.invalid-base64^^^.sig')).toBe(false);
        });

        it('returns true for token without exp claim', () => {
            const token = createJwt({ sub: 'player-1', name: 'Alice' });
            expect(isJwtValid(token)).toBe(true);
        });
    });

    describe('fetchApi auth-expired event handling via pokerApi', () => {
        let dispatchSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        });

        afterEach(() => {
            dispatchSpy.mockRestore();
        });

        it('dispatches auth-expired and throws status 401 for locally expired token', async () => {
            const expiredToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });

            await expect(pokerApi.getRoomInfo('room-1', expiredToken)).rejects.toMatchObject({
                status: 401,
                message: 'Session expired',
            });

            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'auth-expired' })
            );
        });

        it('dispatches auth-expired and throws status 401 when server returns 401', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse(null, { status: 401 });
                })
            );

            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 401,
            });

            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'auth-expired' })
            );
        });

        it('dispatches auth-expired and throws status 403 when server returns 403', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse(null, { status: 403 });
                })
            );

            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 403,
            });

            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'auth-expired' })
            );
        });
    });

    describe('error normalization', () => {
        it('handles network failure (TypeError) with status 0 and connection message', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

            try {
                await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                    status: 0,
                    message: 'Unable to reach the server. Check your connection.',
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('extracts message field from JSON error response', async () => {
            const res = new Response(JSON.stringify({ message: 'Custom failure message' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe('Custom failure message');

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return HttpResponse.json({ message: 'Room not found in registry' }, { status: 404 });
                })
            );
            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 404,
                message: 'Room not found in registry',
            });
        });

        it('extracts error field from JSON error response', async () => {
            const res = new Response(JSON.stringify({ error: 'Specific error description' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe('Specific error description');

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return HttpResponse.json({ error: 'Unauthorized operation' }, { status: 400 });
                })
            );
            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 400,
                message: 'Unauthorized operation',
            });
        });

        it('normalizes 429 rate limit to standard rate limit message', async () => {
            const res = new Response('Too many requests raw', { status: 429 });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe('Too many requests. Please try again later.');

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse('rate limited', { status: 429 });
                })
            );
            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 429,
                message: 'Too many requests. Please try again later.',
            });
        });

        it('falls back to "Request failed" on empty body 500 response', async () => {
            const res = new Response('', { status: 500 });
            const msg = await getErrorMessage(res, 'Request failed');
            expect(msg).toBe('Request failed');

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse('', { status: 500 });
                })
            );
            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 500,
                message: 'Request failed',
            });
        });
    });
});
