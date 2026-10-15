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

        it('returns false when decoded payload is a non-object primitive or array', () => {
            const primitiveToken = `eyJhbGciOiJIUzI1NiJ9.${toBase64Url('"just-a-string"')}.sig`;
            const numberToken = `eyJhbGciOiJIUzI1NiJ9.${toBase64Url('12345')}.sig`;
            const arrayToken = `eyJhbGciOiJIUzI1NiJ9.${toBase64Url('[1,2,3]')}.sig`;
            expect(isJwtValid(primitiveToken)).toBe(false);
            expect(isJwtValid(numberToken)).toBe(false);
            expect(isJwtValid(arrayToken)).toBe(false);
        });

        it('correctly decodes unpadded Base64Url payload requiring = padding', () => {
            const token = createJwt({ sub: 'a', exp: Math.floor(Date.now() / 1000) + 3600 });
            const payloadPart = token.split('.')[1];
            expect(payloadPart.includes('=')).toBe(false);
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
                expect.objectContaining({ type: 'auth-expired', detail: { token: expiredToken } })
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
                expect.objectContaining({ type: 'auth-expired', detail: { token: validToken } })
            );
        });

        it('does not dispatch auth-expired on 403 domain rejection and throws status 403 with server message', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

            server.use(
                http.post('/api/room/:roomId/start-game', () => {
                    return HttpResponse.json(
                        { message: 'Only the room host can start the game' },
                        { status: 403 }
                    );
                })
            );

            await expect(pokerApi.startGame('room-1', validToken)).rejects.toMatchObject({
                status: 403,
                message: 'Only the room host can start the game',
            });

            expect(dispatchSpy).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'auth-expired' })
            );
        });
    });

    describe('error normalization', () => {
        it('throws status 408 ApiError when request times out after 15 seconds', async () => {
            vi.useFakeTimers();
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            });

            try {
                const promise = pokerApi.getRoomInfo('room-1', validToken);
                const assertion = expect(promise).rejects.toMatchObject({
                    status: 408,
                    message: 'Request timed out. Please try again.',
                });
                await vi.advanceTimersByTimeAsync(15000);
                await assertion;
            } finally {
                fetchSpy.mockRestore();
                vi.useRealTimers();
            }
        });
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

    describe('room responses with ApiResponse envelope', () => {
        it.each([
            ['HTML', () => new HttpResponse('<html>not json</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
            ['JSON null', () => HttpResponse.json(null, { status: 200 })],
        ])('rejects a 200 OK %s room response as a malformed upstream response', async (_label, response) => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(http.get('/api/room/:roomId', response));

            await expect(pokerApi.getRoomInfo('room-1', validToken)).rejects.toMatchObject({
                status: 502,
                message: 'The server returned an invalid response. Please try again.',
            });
        });

        it('createRoom cleanly handles and normalizes ApiResponse<TokenResponse>', async () => {
            const result = await pokerApi.createRoom({
                roomName: 'High Roller',
                playerName: 'Alice',
                maxPlayers: 6,
                smallBlind: 10,
                bigBlind: 20,
                buyIn: 500,
            });

            expect(result).toEqual({
                message: 'Room created successfully',
                token: expect.any(String),
                roomId: 'ABCD',
                playerName: 'Alice',
            });
        });

        it('joinRoom cleanly handles and normalizes ApiResponse<TokenResponse>', async () => {
            const result = await pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
            });

            expect(result).toEqual({
                message: 'Successfully joined room',
                token: expect.any(String),
                roomId: 'Room99',
                playerName: 'Bob',
            });
        });

        it('joinRoom throws ApiError with message from backend error response', async () => {
            await expect(pokerApi.joinRoom({
                roomName: 'INVALID',
                playerName: 'Bob',
            })).rejects.toMatchObject({
                status: 404,
                message: 'Room not found',
            });
        });

        it('throws status 500 ApiError when auth endpoint returns malformed or empty data envelope', async () => {
            server.use(
                http.post('/api/room/join', () => {
                    return HttpResponse.json({ message: 'OK', data: null }, { status: 200 });
                })
            );

            await expect(pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
            })).rejects.toMatchObject({
                status: 500,
            });
        });
    });

    describe('createStompClient and logger security', () => {
        it('does not log raw STOMP CONNECT frames or Bearer tokens to console.log by default', async () => {
            const { createStompClient } = await import('../api');
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

            try {
                const secretToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAliceJ9.secret-signature';
                const client = createStompClient(secretToken);
                expect(client.reconnectDelay).toEqual(expect.any(Number));

                client.debug(`>>> CONNECT\nAuthorization:Bearer ${secretToken}\naccept-version:1.2,1.1,1.0\n\n\0`);

                expect(logSpy).not.toHaveBeenCalled();
                expect(debugSpy).not.toHaveBeenCalled();
            } finally {
                logSpy.mockRestore();
                debugSpy.mockRestore();
            }
        });

        it('redacts Bearer tokens and holeCards when VITE_DEBUG_STOMP=true is enabled', async () => {
            vi.stubEnv('VITE_DEBUG_STOMP', 'true');
            const { createStompClient } = await import('../api');
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

            try {
                const secretToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAliceJ9.secret-signature';
                const client = createStompClient(secretToken);

                client.debug(`>>> CONNECT\nAuthorization:Bearer ${secretToken}\naccept-version:1.2,1.1,1.0\n\n\0`);
                client.debug('<<< MESSAGE\ndestination:/user/queue/private\n\n{"holeCards":["AS","KS"]}\0');

                expect(debugSpy).toHaveBeenCalledTimes(2);
                expect(debugSpy.mock.calls[0][0]).not.toContain(secretToken);
                expect(debugSpy.mock.calls[0][0]).toContain('Bearer [REDACTED]');
                expect(debugSpy.mock.calls[1][0]).not.toContain('AS');
                expect(debugSpy.mock.calls[1][0]).toContain('[STOMP /user/queue/private frame redacted]');
            } finally {
                debugSpy.mockRestore();
                vi.unstubAllEnvs();
            }
        });

        it('redacts Bearer tokens and sensitive object keys in logger output', async () => {
            const { logger } = await import('../../security/logger');
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            try {
                const secretToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAliceJ9.secret-signature';
                logger.log(`Header Authorization: Bearer ${secretToken}`, {
                    token: secretToken,
                    password: 'my-secret-password',
                    holeCards: ['AS', 'KS'],
                    safeField: 'visible',
                });

                expect(logSpy).toHaveBeenCalledTimes(1);
                const [loggedMsg, loggedObj] = logSpy.mock.calls[0];
                expect(loggedMsg).not.toContain(secretToken);
                expect(loggedMsg).toContain('Bearer [REDACTED]');
                expect(loggedObj).toEqual({
                    token: '[REDACTED]',
                    password: '[REDACTED]',
                    holeCards: '[REDACTED]',
                    safeField: 'visible',
                });

                logger.warn('Private frame: {"holeCards":["AH","KH"]}');
                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).not.toContain('AH');
            } finally {
                logSpy.mockRestore();
                warnSpy.mockRestore();
            }
        });

        it('redacts serialized sensitive JSON and sensitive properties attached to Error instances', async () => {
            const { logger } = await import('../../security/logger');
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const sensitiveError = Object.assign(new Error('Request failed'), {
                token: 'secret-token',
                holeCards: ['AS', 'KS'],
                safeField: 'visible',
            });

            try {
                logger.warn('Serialized', '{"token":"secret-token","holeCards":["AS","KS"]}');
                logger.error('Failure', sensitiveError);

                expect(warnSpy.mock.calls[0][1]).toBe('[Sensitive serialized payload redacted]');
                expect(errorSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
                    token: '[REDACTED]',
                    holeCards: '[REDACTED]',
                    safeField: 'visible',
                    message: 'Request failed',
                }));
            } finally {
                warnSpy.mockRestore();
                errorSpy.mockRestore();
            }
        });

        it('dispatches auth-expired and deactivates client in beforeConnect when JWT is expired', async () => {
            const { createStompClient } = await import('../api');
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            try {
                const expiredToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
                const client = createStompClient(expiredToken);
                const deactivateSpy = vi.spyOn(client, 'deactivate');

                await client.beforeConnect(client);

                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'auth-expired', detail: { token: expiredToken } })
                );
                expect(deactivateSpy).toHaveBeenCalledTimes(1);
            } finally {
                dispatchSpy.mockRestore();
            }
        });

        it('does not dispatch auth-expired or deactivate client in beforeConnect when JWT is valid', async () => {
            const { createStompClient } = await import('../api');
            const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
            try {
                const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
                const client = createStompClient(validToken);
                const deactivateSpy = vi.spyOn(client, 'deactivate');

                await client.beforeConnect(client);

                expect(dispatchSpy).not.toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'auth-expired' })
                );
                expect(deactivateSpy).not.toHaveBeenCalled();
            } finally {
                dispatchSpy.mockRestore();
            }
        });
    });
});

