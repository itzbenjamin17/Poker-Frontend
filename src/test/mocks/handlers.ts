import { http, HttpResponse } from 'msw'
import type { RoomDataResponse, TokenResponse } from '../../types';
import { createMockJwt } from '../fixtures';

export const handlers = [
  // Mock join room
  http.post('/api/room/join', async ({ request }) => {
    const { playerName, roomName } = await request.json() as { playerName: string, roomName: string }
    
    if (roomName === 'INVALID' || roomName === 'NonExistent') {
      return HttpResponse.json({ status: 404, title: 'Not Found', detail: 'Room not found' }, { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    }

    const response: TokenResponse = {
      token: createMockJwt(),
      playerName,
      roomId: roomName,
    }

    return HttpResponse.json(response)
  }),

  // Mock create room
  http.post('/api/room/create', async ({ request }) => {
    const { playerName } = await request.json() as { playerName: string }
    const response: TokenResponse = {
      token: createMockJwt(),
      playerName,
      roomId: 'ABCD',
    }
    return HttpResponse.json(response)
  }),

  // Mock room info
  http.get('/api/room/:roomId', ({ params }) => {
    const { roomId } = params;
    return HttpResponse.json({
      roomId: String(roomId),
      roomName: 'Test Room',
      maxPlayers: 6,
      buyIn: 1000,
      smallBlind: 10,
      bigBlind: 20,
      players: [
        { name: 'Player 1', isHost: true },
        { name: 'Player 2', isHost: false },
      ],
      canStartGame: true,
      gameStarted: false,
    } satisfies RoomDataResponse);
  }),

  // Default game state handler (404 = not started)
  http.get('/api/game/:gameId/state', () => {
    return new HttpResponse(null, { status: 404 })
  }),

  // Default game private state handler (404 = not started)
  http.get('/api/game/:gameId/private-state', () => {
    return new HttpResponse(null, { status: 404 })
  }),

  // Default review handler (404 = not in review)
  http.get('/api/game/:gameId/review', () => {
    return new HttpResponse(null, { status: 404 })
  })
]
