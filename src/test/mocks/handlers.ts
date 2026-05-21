import { http, HttpResponse } from 'msw'

export const handlers = [
  // Mock join room
  http.post('/api/room/join', async ({ request }) => {
    const { playerName, roomName } = await request.json() as { playerName: string, roomName: string }
    
    if (roomName === 'INVALID') {
      return new HttpResponse(JSON.stringify({ message: 'Room not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return HttpResponse.json({
      token: 'mock-jwt-token',
      playerName,
      roomId: roomName
    })
  }),

  // Mock create room
  http.post('/api/room/create', async ({ request }) => {
    const { playerName } = await request.json() as { playerName: string }
    return HttpResponse.json({
      token: 'mock-jwt-token',
      playerName,
      roomId: 'ABCD'
    })
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
