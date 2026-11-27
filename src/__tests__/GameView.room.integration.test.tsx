import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import GameView from '../GameView'
import { MockStompClient } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'
import { createValidGameState, createValidPlayer, createValidRoomData, mockAuth } from '../test/fixtures'

const auth = {
  ...mockAuth,
  roomId: 'ROOM123',
  playerName: 'HostPlayer'
}

describe('GameView - Room Lobby Integration', () => {
  it('renders room info and handles real-time player joins', async () => {
    // Mock successful room info hydration
    server.use(
      http.get('/api/room/ROOM123', () => {
        return HttpResponse.json(createValidRoomData({
          roomId: 'ROOM123',
          roomName: 'High Stakes',
          players: [
            { name: 'HostPlayer', isHost: true }
          ],
          maxPlayers: 6,
          smallBlind: 50,
          bigBlind: 100,
          buyIn: 5000,
          canStartGame: false,
          gameStarted: false
        }))
      }),
      // Game state 404 (common when game hasn't started)
      http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/game/ROOM123/private-state', () => new HttpResponse(null, { status: 404 }))
    )

    render(<GameView auth={auth} />)

    // Check hydration
    await waitFor(() => {
      expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument()
      expect(screen.getAllByText(/High Stakes/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/50 \/ 100 chips/i)).toBeInTheDocument()
    })

    // Verify Start Game button's "before" state is disabled
    const startBtn = screen.getByRole('button', { name: /START GAME/i })
    expect(startBtn).toBeDisabled()

    // Ensure STOMP is connected and subscribed before sending messages
    await MockStompClient.waitForSubscription('/room/ROOM123')

    // Simulate another player joining via STOMP using await act(async () => ...)
    await act(async () => {
      MockStompClient.simulateMessage('/room/ROOM123', createValidRoomData({
        roomId: 'ROOM123',
        roomName: 'High Stakes',
        players: [
          { name: 'HostPlayer', isHost: true },
          { name: 'GuestPlayer', isHost: false }
        ],
        maxPlayers: 6,
        smallBlind: 50,
        bigBlind: 100,
        buyIn: 5000,
        canStartGame: true,
        gameStarted: false
      }))
    })

    // Verify UI updated within player list layout
    const playerList = screen.getByRole('list')
    expect(within(playerList).getByText('GuestPlayer')).toBeInTheDocument()
    
    // As host, we should now see the START GAME button enabled
    expect(startBtn).toBeEnabled()
  })

  it('redirects when the room is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const handleLeave = vi.fn()
    try {
      // Initial hydration
      server.use(
          http.get('/api/room/ROOM123', () => HttpResponse.json(createValidRoomData({
            roomId: 'ROOM123',
            players: [{ name: 'HostPlayer', isHost: true }],
            gameStarted: false
          }))),
          http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
          http.get('/api/game/ROOM123/private-state', () => new HttpResponse(null, { status: 404 }))
      )

      render(<GameView auth={auth} onLeave={handleLeave} />)

      await waitFor(() => expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument())

      // Ensure STOMP is connected and subscribed before sending messages
      await MockStompClient.waitForSubscription('/room/ROOM123')

      // Simulate closed room frame using await act(async () => ...)
      await act(async () => {
        MockStompClient.simulateMessage('/room/ROOM123', createValidRoomData({
          roomId: 'ROOM123',
          players: [{ name: 'HostPlayer', isHost: true }],
          closedReason: 'HOST_LEFT'
        }))
      })

      await waitFor(() => expect(screen.getByText(/Host left the lobby/i)).toBeInTheDocument())

      // Advance past redirect timeout (ROOM_CLOSED_REDIRECT_MS = 3000)
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(handleLeave).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

  it('hides Connection lost overlay and Disconnected badge while redirecting after turn timeout', async () => {
    const deadline = Date.now() + 5000
    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json(createValidRoomData({
        roomId: 'ROOM123',
        players: [
          { name: 'HostPlayer', isHost: true },
          { name: 'GuestPlayer', isHost: false },
          { name: 'ThirdPlayer', isHost: false },
        ],
        gameStarted: true,
      }))),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
        gameId: 'ROOM123',
        handNumber: 1,
        phase: 'PRE_FLOP',
        currentPlayerId: 'p-1',
        currentPlayerName: 'HostPlayer',
        turnDeadlineEpochMs: deadline,
        players: [
          createValidPlayer({ id: 'p-1', name: 'HostPlayer', chips: 990, currentBet: 10 }),
          createValidPlayer({ id: 'p-2', name: 'GuestPlayer', chips: 980, currentBet: 20 }),
          createValidPlayer({ id: 'p-3', name: 'ThirdPlayer', chips: 1000, currentBet: 0 }),
        ],
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        handNumber: 1,
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)

    await waitFor(() => expect(screen.getByLabelText('Total Pot')).toBeInTheDocument())
    await MockStompClient.waitForSubscription('/room/ROOM123')

    await act(async () => {
      MockStompClient.simulateMessage('/room/ROOM123', createValidRoomData({
        roomId: 'ROOM123',
        players: [
          { name: 'GuestPlayer', isHost: true },
          { name: 'ThirdPlayer', isHost: false },
        ],
        gameStarted: true,
        serverTimeEpochMs: deadline + 1000,
      }))
    })

    expect(await screen.findByText(/You were removed from the table due to turn timeout/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /connection lost/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /connection status: disconnected/i })).not.toBeInTheDocument()
  })

  it('warns lobby host that leaving closes the room when other players are present, unlike guests', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json(createValidRoomData({
        roomId: 'ROOM123',
        players: [
          { name: 'HostPlayer', isHost: true },
          { name: 'GuestPlayer', isHost: false },
        ],
        gameStarted: false,
      }))),
      http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/game/ROOM123/private-state', () => new HttpResponse(null, { status: 404 })),
    )

    const { unmount } = render(<GameView auth={auth} />)
    await waitFor(() => expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /leave table/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Leaving the lobby will close the room for everyone. Are you sure you want to leave?'
    )
    unmount()

    render(<GameView auth={{ ...auth, playerName: 'GuestPlayer' }} />)
    await waitFor(() => expect(screen.getByText(/GAME LOBBY/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /leave table/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Are you sure you want to leave the lobby?')
  })
})


