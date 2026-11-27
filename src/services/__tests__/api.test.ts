import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { isJwtValid, getErrorMessage, pokerApi, HttpError, MalformedResponseError, createStompClient } from '../api';
import { ERROR_MALFORMED_AUTH, ERROR_TECHNICAL, ERROR_SYSTEM, ERROR_INVALID_FORMAT, ERROR_REQUEST_TIMEOUT } from '../../constants/strings';
import { createValidGameState, createValidRoomData } from '../../test/fixtures';

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

            await expect(pokerApi.getRoomData('room-1', expiredToken)).rejects.toMatchObject({
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

            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
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
            vi.useFakeTimers({ shouldAdvanceTime: false });
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            let resolveStarted!: () => void;
            const requestStarted = new Promise<void>((resolve) => {
                resolveStarted = resolve;
            });
            server.use(
                http.get('*/api/room/room-1', ({ request }) => {
                    resolveStarted();
                    return new Promise((resolve) => {
                        request.signal.addEventListener('abort', () => {
                            resolve(HttpResponse.error());
                        }, { once: true });
                    });
                })
            );

            try {
                const promise = pokerApi.getRoomData('room-1', validToken);
                const assertion = expect(promise).rejects.toMatchObject({
                    status: 408,
                    message: ERROR_REQUEST_TIMEOUT,
                });
                await requestStarted;
                await vi.advanceTimersByTimeAsync(15_000);
                await assertion;
            } finally {
                vi.useRealTimers();
            }
        });
        it('handles network failure (TypeError) with status 0 and connection message', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('*/api/room/room-1', () => HttpResponse.error())
            );

            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status: 0,
                message: 'Unable to reach the server. Check your connection.',
            });
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
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
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
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
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
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status: 429,
                message: 'Too many requests. Please try again later.',
            });
        });

        it('shows the server rate limit message when the 429 body carries one', async () => {
            const res = new Response(
                JSON.stringify({ message: 'Too many requests. Please try again in 15 minutes.' }),
                { status: 429, headers: { 'content-type': 'application/json' } },
            );
            expect(await getErrorMessage(res, 'Default fallback')).toBe(
                'Too many requests. Please try again in 15 minutes.',
            );
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
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status: 500,
                message: 'Request failed',
            });
        });

        it.each([
            [502, '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>'],
            [503, '<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>'],
            [504, '<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>'],
        ])('normalizes HTML %i error response page to technical copy and preserves status', async (status, htmlBody) => {
            const res = new Response(htmlBody, {
                status,
                headers: { 'Content-Type': 'text/html' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe(ERROR_TECHNICAL);

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse(htmlBody, {
                        status,
                        headers: { 'Content-Type': 'text/html' },
                    });
                })
            );
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status,
                message: ERROR_TECHNICAL,
            });
        });

        it('normalizes non-JSON plaintext error strings containing HTML tags to technical copy', async () => {
            const inlineHtml = '<p>Service Temporarily Down</p>';
            const res = new Response(inlineHtml, {
                status: 503,
                headers: { 'Content-Type': 'text/plain' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe(ERROR_TECHNICAL);

            const divHtml = '<div>Error: Database connection lost</div>';
            const resDiv = new Response(divHtml, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(resDiv, 'Default fallback')).toBe(ERROR_TECHNICAL);
        });

        it('normalizes non-JSON plaintext error strings with server exceptions without leakage', async () => {
            const stackTrace = 'java.lang.NullPointerException at com.pokergame.service.RoomService.getRoom(RoomService.java:42)';
            const res = new Response(stackTrace, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe(ERROR_SYSTEM);

            const springEx = 'org.springframework.web.bind.MethodArgumentNotValidException: validation failed';
            const resSpring = new Response(springEx, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(resSpring, 'Default fallback')).toBe(ERROR_SYSTEM);

            const causedBy = 'Caused by: com.pokergame.exception.GameException: Table not found';
            const resCaused = new Response(causedBy, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(resCaused, 'Default fallback')).toBe(ERROR_SYSTEM);

            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(
                http.get('/api/room/:roomId', () => {
                    return new HttpResponse(stackTrace, {
                        status: 500,
                        headers: { 'Content-Type': 'text/plain' },
                    });
                })
            );
            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status: 500,
                message: ERROR_SYSTEM,
            });
        });

        it('returns sanitized clean non-JSON error text and bounds length', async () => {
            const cleanText = 'Room is full.';
            const res = new Response(cleanText, {
                status: 400,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(res, 'Default fallback')).toBe('Room is full.');

            const longText = 'A very long error message that exceeds one hundred and sixty characters so normalization must cap it cleanly without splitting any trailing word right down the middle: The game has terminated.';
            const resLong = new Response(longText, {
                status: 400,
                headers: { 'Content-Type': 'text/plain' },
            });
            const normalizedLong = await getErrorMessage(resLong, 'Default fallback');
            expect(normalizedLong.length).toBeLessThanOrEqual(160);
            expect(normalizedLong.endsWith('...')).toBe(true);
        });

        it('falls back cleanly when non-JSON body is whitespace or empty', async () => {
            const resEmpty = new Response('', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(resEmpty, 'Default fallback')).toBe('Default fallback');

            const resWhitespace = new Response('   \n\t  ', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
            expect(await getErrorMessage(resWhitespace, 'Default fallback')).toBe('Default fallback');
        });

        it('handles case-insensitive Content-Type and application/problem+json', async () => {
            const resUpper = new Response(JSON.stringify({ detail: 'Uppercase content type' }), {
                status: 400,
                headers: { 'Content-Type': 'APPLICATION/JSON' },
            });
            expect(await getErrorMessage(resUpper, 'Default fallback')).toBe('Uppercase content type');

            const resProblem = new Response(JSON.stringify({ status: 400, title: 'Bad Request', detail: 'Problem details error' }), {
                status: 400,
                headers: { 'Content-Type': 'application/problem+json' },
            });
            expect(await getErrorMessage(resProblem, 'Default fallback')).toBe('Problem details error');

            const resTitleOnly = new Response(JSON.stringify({ status: 401, title: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/problem+json' },
            });
            expect(await getErrorMessage(resTitleOnly, 'Default fallback')).toBe('Unauthorized');
        });

        it('normalizes HTML or stack traces inside valid JSON error responses', async () => {
            const resHtmlInJson = new Response(JSON.stringify({ message: '<html>500 Server Error</html>' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
            expect(await getErrorMessage(resHtmlInJson, 'Default fallback')).toBe(ERROR_TECHNICAL);

            const resStackInJson = new Response(JSON.stringify({ error: 'java.lang.IllegalStateException: invalid phase' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
            expect(await getErrorMessage(resStackInJson, 'Default fallback')).toBe(ERROR_SYSTEM);
        });

        it('falls back to default fallback when JSON contains empty or blank error fields', async () => {
            const resBlankJson = new Response(JSON.stringify({ message: '   ', error: '' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
            expect(await getErrorMessage(resBlankJson, 'Default fallback')).toBe('Default fallback');

            const resEmptyObj = new Response(JSON.stringify({}), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
            expect(await getErrorMessage(resEmptyObj, 'Default fallback')).toBe('Default fallback');
        });

        it('normalizes JSON error response with embedded JSON object or array to format copy', async () => {
            const res = new Response(JSON.stringify({ message: '{"error": "corrupt_payload", "status": 400}' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
            const msg = await getErrorMessage(res, 'Default fallback');
            expect(msg).toBe(ERROR_INVALID_FORMAT);
        });
    });

    describe('room responses and TokenResponse decoding', () => {
        it.each([
            ['HTML', () => new HttpResponse('<html>not json</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
            ['JSON null', () => HttpResponse.json(null, { status: 200 })],
        ])('rejects a 200 OK %s room response as a malformed upstream response', async (_label, response) => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            server.use(http.get('/api/room/:roomId', response));

            await expect(pokerApi.getRoomData('room-1', validToken)).rejects.toMatchObject({
                status: 502,
                message: 'The server returned an invalid response. Please try again.',
            });
        });

        it('createRoom cleanly handles bare TokenResponse', async () => {
            const result = await pokerApi.createRoom({
                roomName: 'High Roller',
                playerName: 'Alice',
                maxPlayers: 6,
                smallBlind: 10,
                bigBlind: 20,
                buyIn: 500,
            });

            expect(result).toEqual({
                token: expect.any(String),
                roomId: 'ABCD',
                playerName: 'Alice',
            });
        });

        it('joinRoom cleanly handles bare TokenResponse', async () => {
            const result = await pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
            });

            expect(result).toEqual({
                token: expect.any(String),
                roomId: 'Room99',
                playerName: 'Bob',
            });
        });

        it('joinRoom throws ApiError with message from backend error response', async () => {
            server.use(
                http.post('/api/room/join', () => {
                    return HttpResponse.json(
                        { status: 404, title: 'Not Found', detail: 'Room not found' },
                        { status: 404, headers: { 'Content-Type': 'application/problem+json' } }
                    );
                })
            );

            await expect(pokerApi.joinRoom({
                roomName: 'INVALID',
                playerName: 'Bob',
            })).rejects.toMatchObject({
                status: 404,
                message: 'Room not found',
            });
        });

        it('throws status 500 ApiError when auth endpoint returns null or non-object payload', async () => {
            server.use(
                http.post('/api/room/join', () => {
                    return HttpResponse.json(null, { status: 200 });
                })
            );

            await expect(pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
            })).rejects.toMatchObject({
                status: 500,
            });
        });

        it.each([
            ['missing token', { roomId: 'r1', playerName: 'Alice' }],
            ['empty token', { token: '', roomId: 'r1', playerName: 'Alice' }],
            ['whitespace token', { token: '   ', roomId: 'r1', playerName: 'Alice' }],
            ['missing roomId', { token: 'tok', playerName: 'Alice' }],
            ['empty roomId', { token: 'tok', roomId: '', playerName: 'Alice' }],
            ['whitespace roomId', { token: 'tok', roomId: '  ', playerName: 'Alice' }],
            ['missing playerName', { token: 'tok', roomId: 'r1' }],
            ['empty playerName', { token: 'tok', roomId: 'r1', playerName: '' }],
            ['whitespace playerName', { token: 'tok', roomId: 'r1', playerName: '   ' }],
            ['array response', [{ token: 'tok', roomId: 'r1', playerName: 'Alice' }]],
        ])('throws status 500 HttpError with ERROR_MALFORMED_AUTH when auth response has %s', async (_desc, invalidPayload) => {
            server.use(
                http.post('/api/room/join', () => {
                    return HttpResponse.json(invalidPayload, { status: 200 });
                })
            );
            await expect(pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
            })).rejects.toMatchObject({
                status: 500,
                message: ERROR_MALFORMED_AUTH,
            });
        });
    });

    describe('createStompClient security', () => {
        it('does not log raw STOMP CONNECT frames or Bearer tokens to console.log by default', () => {
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

        it('redacts Bearer tokens and holeCards when VITE_DEBUG_STOMP=true is enabled', () => {
            vi.stubEnv('VITE_DEBUG_STOMP', 'true');
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

        it('dispatches auth-expired and deactivates client in beforeConnect when JWT is expired', async () => {
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

    describe('optional password field in createRoom and joinRoom payloads', () => {
        it('createRoom transmits entered password unchanged including leading and trailing spaces', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            server.use(
                http.post('/api/room/create', async ({ request }) => {
                    capturedBody = (await request.json()) as Record<string, unknown>;
                    return HttpResponse.json({
                        token: 'mock-jwt-token',
                        roomId: 'ABCD',
                        playerName: 'Alice',
                    });
                })
            );

            await pokerApi.createRoom({
                roomName: 'High Roller',
                playerName: 'Alice',
                maxPlayers: 6,
                smallBlind: 10,
                bigBlind: 20,
                buyIn: 500,
                password: '  secretPass123  ',
            });

            expect(capturedBody).toEqual(expect.objectContaining({
                password: '  secretPass123  ',
            }));
        });

        it('createRoom omits password field when password is empty or whitespace-only', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            server.use(
                http.post('/api/room/create', async ({ request }) => {
                    capturedBody = (await request.json()) as Record<string, unknown>;
                    return HttpResponse.json({
                        token: 'mock-jwt-token',
                        roomId: 'ABCD',
                        playerName: 'Alice',
                    });
                })
            );

            await pokerApi.createRoom({
                roomName: 'High Roller',
                playerName: 'Alice',
                maxPlayers: 6,
                smallBlind: 10,
                bigBlind: 20,
                buyIn: 500,
                password: '   ',
            });

            expect(capturedBody).not.toBeNull();
            expect(capturedBody).not.toHaveProperty('password');
        });

        it('joinRoom transmits entered password unchanged including leading and trailing spaces', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            server.use(
                http.post('/api/room/join', async ({ request }) => {
                    capturedBody = (await request.json()) as Record<string, unknown>;
                    return HttpResponse.json({
                        token: 'mock-jwt-token',
                        roomId: 'Room99',
                        playerName: 'Bob',
                    });
                })
            );

            await pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
                password: '  secretPass123  ',
            });

            expect(capturedBody).toEqual(expect.objectContaining({
                password: '  secretPass123  ',
            }));
        });

        it('joinRoom omits password field when password is empty or whitespace-only', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            server.use(
                http.post('/api/room/join', async ({ request }) => {
                    capturedBody = (await request.json()) as Record<string, unknown>;
                    return HttpResponse.json({
                        token: 'mock-jwt-token',
                        roomId: 'Room99',
                        playerName: 'Bob',
                    });
                })
            );

            await pokerApi.joinRoom({
                roomName: 'Room99',
                playerName: 'Bob',
                password: '   ',
            });

            expect(capturedBody).not.toBeNull();
            expect(capturedBody).not.toHaveProperty('password');
        });
    });

    async function expectPreAbortedRequest(
        registerHandler: (onRequest: () => void) => ReturnType<typeof http.get>,
        invoke: (signal: AbortSignal) => Promise<unknown>
    ) {
        const onRequest = vi.fn();
        server.use(registerHandler(onRequest));
        const controller = new AbortController();
        controller.abort();
        await expect(invoke(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(onRequest).not.toHaveBeenCalled();
    }

    describe('signal propagation on state queries', () => {
        it('getRoomData supports optional signal and aborts without hitting the network', async () => {
            await expectPreAbortedRequest(
                (onRequest) => http.get('/api/room/:roomId', () => {
                    onRequest();
                    return HttpResponse.json(createValidRoomData());
                }),
                (signal) => pokerApi.getRoomData('room-1', signal)
            );
        });

        it('getPublicGameState supports optional signal and aborts without hitting the network', async () => {
            await expectPreAbortedRequest(
                (onRequest) => http.get('/api/game/:gameId/state', () => {
                    onRequest();
                    return HttpResponse.json(createValidGameState());
                }),
                (signal) => pokerApi.getPublicGameState('game-1', signal)
            );
        });

        it('getPublicGameState aborts an in-flight request when signal is cancelled', async () => {
            let signalAborted = false;
            let markStarted!: () => void;
            const requestStarted = new Promise<void>((resolve) => {
                markStarted = resolve;
            });
            server.use(
                http.get('/api/game/:gameId/state', ({ request }) => {
                    markStarted();
                    return new Promise((_, reject) => {
                        request.signal.addEventListener('abort', () => {
                            signalAborted = true;
                            reject(new DOMException('Aborted', 'AbortError'));
                        });
                    });
                })
            );
            const controller = new AbortController();
            const pending = pokerApi.getPublicGameState('game-1', controller.signal);
            await requestStarted;
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            expect(signalAborted).toBe(true);
        });

        it('getPrivatePlayerState supports optional signal and aborts without hitting the network', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
            await expectPreAbortedRequest(
                (onRequest) => http.get('/api/game/:gameId/private-state', () => {
                    onRequest();
                    return HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: [] });
                }),
                (signal) => pokerApi.getPrivatePlayerState('game-1', validToken, signal)
            );
        });
    });

    describe('getReview and claimWin', () => {
        const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

        describe('getReview', () => {
            it('returns decoded completed PublicGameStateResponse on HTTP 200', async () => {
                server.use(
                    http.get('/api/game/:gameId/review', () => {
                        return HttpResponse.json(createValidGameState({
                            gameId: 'game-100',
                            phase: 'SHOWDOWN',
                            gameEnd: {
                                winner: 'Alice',
                                winnerChips: 3000,
                                isForfeit: false,
                                message: 'Alice won with Full House',
                            },
                        }));
                    })
                );

                const result = await pokerApi.getReview('game-100', validToken);
                expect(result.gameId).toBe('game-100');
                expect(result.gameEnd).toEqual({
                    winner: 'Alice',
                    winnerChips: 3000,
                    isForfeit: false,
                    message: 'Alice won with Full House',
                });
            });

            it('throws HttpError with status 409 when game has not finished', async () => {
                server.use(
                    http.get('/api/game/:gameId/review', () => {
                        return HttpResponse.json(
                            { message: 'Game has not finished' },
                            { status: 409 }
                        );
                    })
                );

                await expect(pokerApi.getReview('game-100', validToken)).rejects.toSatisfy((err) => {
                    expect(err).toBeInstanceOf(HttpError);
                    expect(err).toMatchObject({
                        status: 409,
                        message: 'Game has not finished',
                    });
                    return true;
                });
            });

            it('throws HttpError with status 404 when game is not found', async () => {
                server.use(
                    http.get('/api/game/:gameId/review', () => {
                        return HttpResponse.json(
                            { message: 'Game not found' },
                            { status: 404 }
                        );
                    })
                );

                await expect(pokerApi.getReview('game-100', validToken)).rejects.toSatisfy((err) => {
                    expect(err).toBeInstanceOf(HttpError);
                    expect(err).toMatchObject({
                        status: 404,
                        message: 'Game not found',
                    });
                    return true;
                });
            });

            it('throws HttpError with status 403 on authorization failure', async () => {
                server.use(
                    http.get('/api/game/:gameId/review', () => {
                        return HttpResponse.json(
                            { message: 'You are no longer part of this game.' },
                            { status: 403 }
                        );
                    })
                );

                await expect(pokerApi.getReview('game-100', validToken)).rejects.toSatisfy((err) => {
                    expect(err).toBeInstanceOf(HttpError);
                    expect(err).toMatchObject({
                        status: 403,
                        message: 'You are no longer part of this game.',
                    });
                    return true;
                });
            });

            it('throws MalformedResponseError on invalid terminal payload shape', async () => {
                server.use(
                    http.get('/api/game/:gameId/review', () => {
                        return HttpResponse.json({
                            corrupted: 'payload',
                        });
                    })
                );

                await expect(pokerApi.getReview('game-100', validToken)).rejects.toThrow(MalformedResponseError);
            });

            it('propagates abort signal to fetch', async () => {
                await expectPreAbortedRequest(
                    (onRequest) => http.get('/api/game/:gameId/review', () => {
                        onRequest();
                        return HttpResponse.json(createValidGameState({
                            gameId: 'game-100',
                            gameEnd: { winner: 'Alice', isForfeit: false, message: 'Alice won' },
                        }));
                    }),
                    (signal) => pokerApi.getReview('game-100', validToken, signal)
                );
            });
        });

        describe('claimWin', () => {
            it('returns decoded completed PublicGameStateResponse on HTTP 200', async () => {
                server.use(
                    http.post('/api/game/:gameId/claim-win', () => {
                        return HttpResponse.json(createValidGameState({
                            gameId: 'game-100',
                            phase: 'SHOWDOWN',
                            gameEnd: {
                                winner: 'Alice',
                                winnerChips: 2500,
                                isForfeit: true,
                                message: 'Alice claimed win by disconnect',
                            },
                        }));
                    })
                );

                const response = await pokerApi.claimWin('game-100', validToken);
                expect(response.gameId).toBe('game-100');
                expect(response.gameEnd).toEqual({
                    winner: 'Alice',
                    winnerChips: 2500,
                    isForfeit: true,
                    message: 'Alice claimed win by disconnect',
                });
            });

            it('throws HttpError on 403 forbidden claim', async () => {
                server.use(
                    http.post('/api/game/:gameId/claim-win', () => {
                        return HttpResponse.json(
                            { detail: 'Claim win is not available' },
                            { status: 403, headers: { 'Content-Type': 'application/problem+json' } }
                        );
                    })
                );

                await expect(pokerApi.claimWin('game-100', validToken)).rejects.toMatchObject({
                    status: 403,
                    message: 'Claim win is not available',
                });
            });

            it('throws MalformedResponseError when completed gameEnd payload is missing or malformed', async () => {
                server.use(
                    http.post('/api/game/:gameId/claim-win', () => {
                        return HttpResponse.json({
                            invalid: 'game-end',
                        });
                    })
                );

                await expect(pokerApi.claimWin('game-100', validToken)).rejects.toThrow(MalformedResponseError);
            });

            it('propagates abort signal to fetch', async () => {
                await expectPreAbortedRequest(
                    (onRequest) => http.post('/api/game/:gameId/claim-win', () => {
                        onRequest();
                        return HttpResponse.json(createValidGameState({
                            gameId: 'game-100',
                            gameEnd: { winner: 'Alice', isForfeit: true, message: 'Alice won' },
                        }));
                    }),
                    (signal) => pokerApi.claimWin('game-100', validToken, signal)
                );
            });
        });
    });
});



