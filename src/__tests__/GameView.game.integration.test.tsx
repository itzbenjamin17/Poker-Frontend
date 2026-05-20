import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import GameView from '../GameView'
import { MockStompClient } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'

const mockAuth = {
  token: 'test-token',
  roomId: 'ROOM123',
  playerName: 'TestPlayer',
  playerId: 'p-1',
  message: 'Success'
}

describe('GameView - Game Table Integration', () => {
  it('transitions to table and shows action buttons on player turn', async () => {
    // Mock room info showing game started
    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        players: [
          { name: 'TestPlayer', isHost: true },
          { name: 'Opponent', isHost: false }
        ],
        gameStarted: true
      })),
      // Mock game state for pre-flop
      http.get('/api/game/ROOM123/state', () => HttpResponse.json({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 30,
        communityCards: [],
        currentPlayerId: 'p-1', // It's my turn
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
          { id: 'p-2', name: 'Opponent', chips: 990, currentBet: 10, status: 'ACTIVE', isSmallBlind: true }
        ]
      })),
      // Mock private state for hole cards
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS']
      }))
    )

    render(<GameView auth={mockAuth} />)

    // Wait for the subscription to be active before simulating the message
    await MockStompClient.waitForSubscription('/user/queue/private')

    // Simulate private state update via STOMP (as the real app does)
    act(() => {
      MockStompClient.simulateMessage('/user/queue/private', {
        holeCards: ['AS', 'KS']
      })
    })

    // 1. Wait for the action buttons to appear
    expect(await screen.findByRole('button', { name: /fold/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /check/i })).toBeInTheDocument()
    
    // 2. Now verify my hole cards are visible and correct
    expect(await screen.findByRole('img', { name: 'Ace of Spades' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'King of Spades' })).toBeInTheDocument()

    // Simulate an opponent action via STOMP (e.g., they call, now it's still me or phase changes)
    // Let's simulate a phase change to FLOP
    act(() => {
      MockStompClient.simulateMessage('/game/ROOM123', {
        gameId: 'ROOM123',
        phase: 'FLOP',
        pot: 40,
        communityCards: ['QH', 'JH', 'TH'],
        currentPlayerId: 'p-2',
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE' }
        ]
      })
    })

    // Verify community cards appear
    await waitFor(() => {
      expect(screen.getByLabelText('Queen of Hearts')).toBeInTheDocument()
      expect(screen.getByLabelText('Jack of Hearts')).toBeInTheDocument()
      expect(screen.getByLabelText('Ten of Hearts')).toBeInTheDocument()
    })

    // Action buttons should disappear because it's p-2's turn
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument()
    })
  })
})
