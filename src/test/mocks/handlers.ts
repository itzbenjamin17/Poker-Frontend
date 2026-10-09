import { http, HttpResponse } from 'msw'
import type { ApiResponse, TokenResponse } from '../../types'

export const handlers = [
  // Mock join room
  http.post('/api/room/join', async ({ request }) => {
    const { playerName, roomName } = await request.json() as { playerName: string, roomName: string }
    
    if (roomName === 'INVALID' || roomName === 'NonExistent') {
      return HttpResponse.json({ message: 'Room not found' }, { status: 404 })
    }

    const response: ApiResponse<TokenResponse> = {
      message: 'Successfully joined room',
      data: {
        token: 'mock-jwt-token',
        playerName,
        roomId: roomName,
      },
    }

    return HttpResponse.json(response)
  }),

  // Mock create room
  http.post('/api/room/create', async ({ request }) => {
    const { playerName } = await request.json() as { playerName: string }
    const response: ApiResponse<TokenResponse> = {
      message: 'Room created successfully',
      data: {
        token: 'mock-jwt-token',
        playerName,
        roomId: 'ABCD',
      },
    }
    return HttpResponse.json(response)
  }),

  // Mock room info
  http.get('/api/room/:roomId', ({ params }) => {
    const { roomId } = params
    return HttpResponse.json({
      roomId,
      players: [
        { name: 'Player 1', isHost: true },
        { name: 'Player 2', isHost: false }
      ],
      gameStarted: false
    })
  }),

  // Default game state handler (404 = not started)
  http.get('/api/game/:gameId/state', () => {
    return new HttpResponse(null, { status: 404 })
  }),

  // Default game private state handler (404 = not started)
  http.get('/api/game/:gameId/private-state', () => {
    return new HttpResponse(null, { status: 404 })
  })
]
