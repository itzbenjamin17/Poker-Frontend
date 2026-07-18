import { render, screen, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GameView from '../GameView'
import { MockStompClient } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'
import { mockAuth } from '../test/fixtures'

const auth = {
  ...mockAuth,
  playerName: 'HostPlayer'
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

    render(<GameView auth={auth} />)

    // Check hydration
    await waitFor(() => {
      expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument()
      expect(screen.getByText(/High Stakes/i)).toBeInTheDocument()
      expect(screen.getByText(/\$50 \/ \$100/i)).toBeInTheDocument()
    })

    // Verify Start Game button's "before" state is disabled
    const startBtn = screen.getByRole('button', { name: /START GAME/i })
    expect(startBtn).toBeDisabled()

    // Ensure STOMP is connected and subscribed before sending messages
    await MockStompClient.waitForSubscription('/room/ROOM123')

    // Simulate another player joining via STOMP using await act(async () => ...)
    await act(async () => {
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

    // Verify UI updated within player list layout
    const playerList = screen.getByRole('list')
    expect(within(playerList).getByText('GuestPlayer')).toBeInTheDocument()
    
    // As host, we should now see the START GAME button enabled
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

    render(<GameView auth={auth} onLeave={handleLeave} />)

    await waitFor(() => expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument())

    // Ensure STOMP is connected and subscribed before sending messages
    await MockStompClient.waitForSubscription('/room/ROOM123')

    // Simulate ROOM_CLOSED using await act(async () => ...)
    await act(async () => {
      MockStompClient.simulateMessage('/room/ROOM123', {
        message: 'ROOM_CLOSED'
      })
    })

    await waitFor(() => expect(screen.getByText(/Host left the lobby/i)).toBeInTheDocument())

    // Wait for redirect timeout (ROOM_CLOSED_REDIRECT_MS = 3000)
    await waitFor(() => expect(handleLeave).toHaveBeenCalled(), { timeout: 4500 })
  })

  it('does not render the lobby or raw room code during session hydration or connection failure', async () => {
    // Mock hydration to keep loading (never resolves)
    server.use(
      http.get('/api/room/ROOM123', () => new Promise(() => {}))
    )

    render(<GameView auth={auth} />)

    // Verify we see the loading view
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Connecting\.\.\./i)).toBeInTheDocument()

    // Lobby title should NOT be present (verifying we are not showing the lobby/raw room code prematurely)
    expect(screen.queryByText(/GAME LOBBY/i)).not.toBeInTheDocument()
  })
})


