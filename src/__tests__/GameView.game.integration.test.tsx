import { render, screen, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GameView from '../GameView'
import { MockStompClient, activeSubscriptions } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'
import { mockAuth } from '../test/fixtures'
import userEvent from '@testing-library/user-event'

describe('GameView - Game Table Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSubscriptions.clear()
  })

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

    // Wait for initial REST hydration to settle and game table to render
    expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

    expect(screen.getByRole('region', { name: /board cluster/i })).toContainElement(
      screen.getByLabelText('Total Pot'),
    )
    const heroSeat = screen.getByRole('group', { name: /testplayer hero seat/i })
    expect(within(heroSeat).getByRole('heading', { name: 'TestPlayer' })).toBeInTheDocument()
    expect(within(heroSeat).getByText('$980')).toBeInTheDocument()
    expect(within(heroSeat).getByText('BET: $20')).toBeInTheDocument()
    expect(within(heroSeat).getByText('Active turn')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /opponent seat/i })).toBeInTheDocument()

    // Wait for the subscription to be active before simulating the message
    await MockStompClient.waitForSubscription('/user/queue/private')

    // Simulate private state update via STOMP (as the real app does) using await act(async () => ...)
    await act(async () => {
      MockStompClient.simulateMessage('/user/queue/private', {
        holeCards: ['AS', 'KS']
      })
    })

    // 1. Wait for the action buttons to appear inside the action panel
    const foldBtn = await screen.findByRole('button', { name: /fold/i })
    const checkBtn = await screen.findByRole('button', { name: /check/i })
    expect(foldBtn).toBeInTheDocument()
    expect(checkBtn).toBeInTheDocument()
    
    // 2. Now verify my hole cards are visible and correct
    expect(await screen.findByRole('img', { name: 'Ace of Spades' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'King of Spades' })).toBeInTheDocument()

    // Simulate an opponent action via STOMP (e.g., they call, now it's still me or phase changes)
    // Let's simulate a phase change to FLOP
    await act(async () => {
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

  it('keeps secondary pot details reachable in compact landscape', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })

    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        players: [
          { name: 'TestPlayer', isHost: true },
          { name: 'Opponent', isHost: false },
        ],
        gameStarted: true,
      })),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json({
        gameId: 'ROOM123',
        phase: 'TURN',
        pot: 100,
        pots: [70, 30],
        uncalledAmount: 10,
        communityCards: ['AH', 'KD', 'QC', 'JS'],
        currentPlayerId: 'p-2',
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 900, currentBet: 0, status: 'ACTIVE' },
        ],
      })),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={mockAuth} />)

    expect(await screen.findByLabelText('Main Pot')).toHaveTextContent('$70')
    expect(screen.getByRole('region', { name: /poker table/i })).toBeInTheDocument()

    const potDetails = screen.getByRole('button', { name: /show pot details/i })
    expect(screen.queryByText('Side Pot 1')).not.toBeInTheDocument()
    await user.click(potDetails)

    expect(screen.getByText('Main Pot')).toBeInTheDocument()
    expect(screen.getByText('Side Pot 1')).toBeInTheDocument()
    expect(screen.getByText('Uncalled')).toBeInTheDocument()
  })
})

