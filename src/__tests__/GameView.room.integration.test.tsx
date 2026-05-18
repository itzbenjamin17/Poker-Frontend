import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GameView from '../GameView'
import { MockStompClient } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'

const mockAuth = {
  token: 'test-token',
  roomId: 'ROOM123',
  playerName: 'HostPlayer',
  playerId: 'p-1',
  message: 'Success'
}

describe('GameView - Room Lobby Integration', () => {
  it('renders room info and handles real-time player joins', async () => {
    // Mock successful room info hydration
    server.use(
      http.get('/api/room/ROOM123', () => {
        return HttpResponse.json({
          roomId: 'ROOM123',
          roomName: 'High Stakes',
          players: [
            { name: 'HostPlayer', isHost: true, joinedAt: '2023-01-01' }
          ],
          maxPlayers: 6,
          smallBlind: 50,
          bigBlind: 100,
          buyIn: 5000,
          canStartGame: false,
          gameStarted: false
        })
      }),
      // Game state 404 (common when game hasn't started)
      http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/game/ROOM123/private-state', () => new HttpResponse(null, { status: 404 }))
    )

    render(<GameView auth={mockAuth} />)

    // Check hydration
    await waitFor(() => {
      expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument()
      expect(screen.getByText(/High Stakes/i)).toBeInTheDocument()
      expect(screen.getByText(/\$50 \/ \$100/i)).toBeInTheDocument()
    })

    // Simulate another player joining via STOMP
    act(() => {
      MockStompClient.simulateMessage('/room/ROOM123', {
        message: 'PLAYER_JOINED',
        data: {
          player: 'GuestPlayer',
          players: [
            { name: 'HostPlayer', isHost: true },
            { name: 'GuestPlayer', isHost: false }
          ],
          canStartGame: true
        }
      })
    })

    // Verify UI updated
    expect(screen.getByText('GuestPlayer')).toBeInTheDocument()
    
    // As host, we should now see the START GAME button enabled
    const startBtn = screen.getByRole('button', { name: /START GAME/i })
    expect(startBtn).toBeEnabled()
  })

  it('redirects when the room is closed', async () => {
    const handleLeave = vi.fn()
    
    // Initial hydration
    server.use(
        http.get('/api/room/ROOM123', () => HttpResponse.json({
          roomId: 'ROOM123',
          players: [{ name: 'HostPlayer', isHost: true }],
          gameStarted: false
        })),
        http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
        http.get('/api/game/ROOM123/private-state', () => new HttpResponse(null, { status: 404 }))
    )

    render(<GameView auth={mockAuth} onLeave={handleLeave} />)

    await waitFor(() => expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument())

    // Simulate ROOM_CLOSED
    act(() => {
      MockStompClient.simulateMessage('/room/ROOM123', {
        message: 'ROOM_CLOSED'
      })
    })

    expect(screen.getByText(/Host left the lobby/i)).toBeInTheDocument()

    // Wait for redirect timeout (ROOM_CLOSED_REDIRECT_MS = 3000)
    await waitFor(() => expect(handleLeave).toHaveBeenCalled(), { timeout: 4500 })
  })
})
