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
        currentPlayerName: 'TestPlayer',
        legalActions: ['FOLD', 'CHECK', 'RAISE'],
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
        currentPlayerName: 'Opponent',
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

    // Action controls collapse into the persistent waiting dock because it's p-2's turn
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument()
    })
    const actionDock = screen.getByRole('region', { name: /action dock/i })
    expect(actionDock).toBeInTheDocument()
    expect(within(actionDock).getByRole('status')).toHaveTextContent(/waiting for opponent to act/i)
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
        currentPlayerName: 'Opponent',
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

  it('expands one anchored opponent seat at a time without exposing unrevealed cards', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        players: [
          { name: 'TestPlayer', isHost: true },
          { name: 'Opponent', isHost: false },
          { name: 'Rival', isHost: false },
        ],
        gameStarted: true,
      })),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json({
        gameId: 'ROOM123',
        phase: 'FLOP',
        pot: 120,
        communityCards: ['AH', 'KD', 'QC'],
        currentPlayerId: 'p-2',
        currentPlayerName: 'Opponent',
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 900, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 875, currentBet: 25, status: 'ACTIVE', isSmallBlind: true },
          { id: 'p-3', name: 'Rival', chips: 1000, currentBet: 0, status: 'FOLDED', hasFolded: true },
        ],
      })),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={mockAuth} />)

    expect(await screen.findByRole('region', { name: /poker table/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /testplayer hero seat details/i })).not.toBeInTheDocument()

    const opponent = screen.getByRole('button', { name: /opponent seat details/i })
    const rival = screen.getByRole('button', { name: /rival seat details/i })
    expect(opponent).toHaveAttribute('aria-expanded', 'false')
    expect(rival).toHaveAttribute('aria-expanded', 'false')

    await user.click(opponent)
    expect(opponent).toHaveAttribute('aria-expanded', 'true')
    const opponentSeat = screen.getByRole('group', { name: /opponent seat/i })
    expect(within(opponentSeat).getByText(/stack/i)).toBeInTheDocument()
    const detailsPanel = opponentSeat.querySelector('[id^="opponent-seat-details-"]') as HTMLElement
    expect(within(detailsPanel).getByText('$875')).toBeInTheDocument()
    expect(within(opponentSeat).getByText(/bet \$25/i)).toBeInTheDocument()
    expect(within(opponentSeat).getByText(/small blind/i)).toBeInTheDocument()
    expect(within(opponentSeat).queryByRole('img', { name: /of/i })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(opponent).toHaveAttribute('aria-expanded', 'false')
    expect(within(opponentSeat).queryByText(/stack/i)).not.toBeInTheDocument()

    opponent.focus()
    await user.keyboard(' ')
    expect(opponent).toHaveAttribute('aria-expanded', 'true')

    await user.click(rival)
    expect(opponent).toHaveAttribute('aria-expanded', 'false')
    expect(rival).toHaveAttribute('aria-expanded', 'true')
    const rivalSeat = screen.getByRole('group', { name: /rival seat/i })
    const rivalDetailsPanel = rivalSeat.querySelector('[id^="opponent-seat-details-"]') as HTMLElement
    expect(within(rivalDetailsPanel).getByText(/folded/i)).toBeInTheDocument()
    expect(within(opponentSeat).queryByText(/small blind/i)).not.toBeInTheDocument()
  })
})

