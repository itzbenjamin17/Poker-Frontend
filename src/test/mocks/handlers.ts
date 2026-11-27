import { http, HttpResponse } from 'msw';
import type { TokenResponse } from '../../types';
import { createMockJwt, createValidRoomData } from '../fixtures';

function problemJson(status: number, title: string, detail: string) {
  return HttpResponse.json(
    { status, title, detail },
    { status, headers: { 'Content-Type': 'application/problem+json' } }
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

export const handlers = [
  // Mock join room
  http.post('*/api/room/join', async ({ request }) => {
    const body = await readJsonObject(request);
    if (!body) {
      return problemJson(400, 'Bad Request', 'Request body must be a JSON object');
    }
    const { playerName, roomName } = body;
    if (!isNonEmptyString(playerName) || !isNonEmptyString(roomName)) {
      return problemJson(400, 'Bad Request', 'roomName and playerName are required');
    }

    const response: TokenResponse = {
      token: createMockJwt(),
      playerName,
      roomId: roomName,
    };

    return HttpResponse.json(response);
  }),

  // Mock create room
  http.post('*/api/room/create', async ({ request }) => {
    const body = await readJsonObject(request);
    if (!body) {
      return problemJson(400, 'Bad Request', 'Request body must be a JSON object');
    }
    const { playerName } = body;
    if (!isNonEmptyString(playerName)) {
      return problemJson(400, 'Bad Request', 'playerName is required');
    }

    const response: TokenResponse = {
      token: createMockJwt(),
      playerName,
      roomId: 'ABCD',
    };
    return HttpResponse.json(response);
  }),

  // Mock room info
  http.get('*/api/room/:roomId', ({ params, request }) => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== null && !/^Bearer \S+$/.test(authHeader)) {
      return problemJson(401, 'Unauthorized', 'Malformed Authorization header');
    }
    const { roomId } = params;
    return HttpResponse.json(
      createValidRoomData({
        roomId: String(roomId),
        players: [
          { name: 'Player 1', isHost: true },
          { name: 'Player 2', isHost: false },
        ],
        canStartGame: true,
        gameStarted: false,
      })
    );
  }),

  // Default game state handler (404 = not started)
  http.get('*/api/game/:gameId/state', () => {
    return problemJson(404, 'Not Found', 'Game state not found');
  }),

  // Default game private state handler (404 = not started)
  http.get('*/api/game/:gameId/private-state', () => {
    return problemJson(404, 'Not Found', 'Private game state not found');
  }),

  // Default review handler (404 = not in review)
  http.get('*/api/game/:gameId/review', () => {
    return problemJson(404, 'Not Found', 'Game review not found');
  }),
];
