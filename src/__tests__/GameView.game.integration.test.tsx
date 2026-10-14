import { render, screen, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GameView from '../GameView'
import { MockStompClient, activeSubscriptions } from '../test/mocks/stomp'
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/server'
import { createValidGameState, mockAuth } from '../test/fixtures'
import userEvent from '@testing-library/user-event'

const auth = {
  ...mockAuth,
  roomId: 'ROOM123',
  playerName: 'TestPlayer'
}

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
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
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
      }))),
      // Mock private state for hole cards
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS']
      }))
    )

    render(<GameView auth={auth} />)

    // Wait for initial REST hydration to settle and game table to render
    expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

    expect(screen.getByRole('region', { name: /board cluster/i })).toContainElement(
      screen.getByLabelText('Total Pot'),
    )
    const heroSeat = screen.getByRole('group', { name: /testplayer hero seat/i })
    expect(within(heroSeat).getByText('980')).toBeInTheDocument()
    expect(within(heroSeat).getByText('BET: 20')).toBeInTheDocument()
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
      MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
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
      }))
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
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
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
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)

    expect(await screen.findByLabelText('Main Pot')).toHaveTextContent('70')
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
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
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
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)

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
    const detailsPanel = screen.getByRole('region', { name: /opponent expanded details/i })
    expect(within(detailsPanel).getByText('875')).toBeInTheDocument()
    expect(within(opponentSeat).getByText(/bet 25/i)).toBeInTheDocument()
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
    screen.getByRole('group', { name: /rival seat/i })
    const rivalDetailsPanel = screen.getByRole('region', { name: /rival expanded details/i })
    expect(within(rivalDetailsPanel).getByText(/folded/i)).toBeInTheDocument()
    expect(within(opponentSeat).queryByText(/small blind/i)).not.toBeInTheDocument()
  })

  it('displays HOST_LEFT status when ROOM_CLOSED arrives during an active hand', async () => {
    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        players: [
          { name: 'TestPlayer', isHost: false },
          { name: 'Opponent', isHost: true },
        ],
        gameStarted: true,
      })),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 30,
        communityCards: [],
        currentPlayerId: 'p-1',
        currentPlayerName: 'TestPlayer',
        legalActions: ['FOLD', 'CALL'],
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 990, currentBet: 10, status: 'ACTIVE' },
        ],
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)

    expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument()
    await MockStompClient.waitForSubscription('/room/ROOM123')

    await act(async () => {
      MockStompClient.simulateMessage('/room/ROOM123', {
        message: 'ROOM_CLOSED',
        data: { roomId: 'ROOM123' },
      })
    })

    expect(await screen.findByText(/Host left the lobby\. Returning to main lobby\.\.\./i)).toBeInTheDocument()
  })

  it('retains showdown winner announcement and revealed opponent hole cards in the rendered table across multiple ready-up updates', async () => {
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
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
        gameId: 'ROOM123',
        phase: 'SHOWDOWN',
        pot: 300,
        communityCards: ['AH', 'KD', 'QC', 'JS', '2C'],
        currentPlayerId: null,
        currentPlayerName: null,
        winners: ['Opponent'],
        isReadyCountdownActive: true,
        readyCountdownDeadlineEpochMs: Date.now() + 30000,
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 700, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: false },
          { id: 'p-2', name: 'Opponent', chips: 1300, currentBet: 0, status: 'ACTIVE', isWinner: true, handRank: 'ONE_PAIR', bestHand: ['AH', 'AD', 'KD', 'QC', 'JS'], holeCards: ['AD', '9S'], isReadyForNextHand: false },
          { id: 'p-3', name: 'Rival', chips: 1000, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: false },
        ],
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['2H', '7D'],
      })),
    )

    render(<GameView auth={auth} />)

    expect(await screen.findByRole('region', { name: /round result/i })).toBeInTheDocument()
    expect(screen.getByText(/Opponent/)).toBeInTheDocument()
    await MockStompClient.waitForSubscription('/game/ROOM123')

    // First ready-up broadcast without winners or revealed holeCards
    await act(async () => {
      MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
        gameId: 'ROOM123',
        phase: 'SHOWDOWN',
        pot: 0,
        communityCards: ['AH', 'KD', 'QC', 'JS', '2C'],
        currentPlayerId: null,
        currentPlayerName: null,
        isReadyCountdownActive: true,
        readyCountdownDeadlineEpochMs: Date.now() + 28000,
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 700, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: true },
          { id: 'p-2', name: 'Opponent', chips: 1300, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: false },
          { id: 'p-3', name: 'Rival', chips: 1000, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: false },
        ],
      }))
    })

    // Second ready-up broadcast without winners or revealed holeCards
    await act(async () => {
      MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
        gameId: 'ROOM123',
        phase: 'SHOWDOWN',
        pot: 0,
        communityCards: ['AH', 'KD', 'QC', 'JS', '2C'],
        currentPlayerId: null,
        currentPlayerName: null,
        isReadyCountdownActive: true,
        readyCountdownDeadlineEpochMs: Date.now() + 26000,
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 700, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: true },
          { id: 'p-2', name: 'Opponent', chips: 1300, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: true },
          { id: 'p-3', name: 'Rival', chips: 1000, currentBet: 0, status: 'ACTIVE', isReadyForNextHand: false },
        ],
      }))
    })

    const roundResult = screen.getByRole('region', { name: /round result/i })
    expect(roundResult).toBeInTheDocument()
    expect(within(roundResult).getByText(/Opponent/)).toBeInTheDocument()
    const opponentSeat = screen.getByRole('group', { name: /opponent seat/i })
    expect(within(opponentSeat).getByRole('img', { name: /ace of diamonds/i })).toBeInTheDocument()
  })

  it('does not tear down and recreate the 1s countdown interval on every WebSocket frame when hasDisconnectedPlayer stays true', async () => {
    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        players: [
          { name: 'TestPlayer', isHost: true },
          { name: 'Opponent', isHost: false },
          { name: 'DisconnectedGuy', isHost: false },
        ],
        gameStarted: true,
      })),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 30,
        communityCards: [],
        currentPlayerId: 'p-1',
        currentPlayerName: 'TestPlayer',
        legalActions: ['FOLD', 'CHECK', 'RAISE'],
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 20, status: 'ACTIVE' },
          { id: 'p-3', name: 'DisconnectedGuy', chips: 990, currentBet: 10, status: 'DISCONNECTED', disconnectDeadlineEpochMs: Date.now() + 60000 },
        ],
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)
    expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument()
    await MockStompClient.waitForSubscription('/game/ROOM123')

    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    try {
      setIntervalSpy.mockClear()

      // Incoming frame with a new players array reference, but DisconnectedGuy is still DISCONNECTED
      await act(async () => {
        MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
          gameId: 'ROOM123',
          phase: 'FLOP',
          pot: 50,
          communityCards: ['2C', '7D', '9H'],
          currentPlayerId: 'p-2',
          currentPlayerName: 'Opponent',
          players: [
            { id: 'p-1', name: 'TestPlayer', chips: 970, currentBet: 0, status: 'ACTIVE' },
            { id: 'p-2', name: 'Opponent', chips: 970, currentBet: 0, status: 'ACTIVE' },
            { id: 'p-3', name: 'DisconnectedGuy', chips: 990, currentBet: 0, status: 'DISCONNECTED', disconnectDeadlineEpochMs: Date.now() + 58000 },
          ],
        }))
      })

      expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1000)
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('resets raiseAmount when phase changes even if currentPlayerId remains the local player', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/room/ROOM123', () => HttpResponse.json({
        roomId: 'ROOM123',
        roomName: 'Poker Table',
        bigBlind: 20,
        players: [
          { name: 'TestPlayer', isHost: true },
          { name: 'Opponent', isHost: false },
        ],
        gameStarted: true,
      })),
      http.get('/api/game/ROOM123/state', () => HttpResponse.json(createValidGameState({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 40,
        currentBet: 20,
        communityCards: [],
        currentPlayerId: 'p-1',
        currentPlayerName: 'TestPlayer',
        legalActions: ['FOLD', 'CHECK', 'RAISE'],
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 20, status: 'ACTIVE' },
        ],
      }))),
      http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
        playerId: 'p-1',
        holeCards: ['AS', 'KS'],
      })),
    )

    render(<GameView auth={auth} />)
    expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument()
    await MockStompClient.waitForSubscription('/game/ROOM123')

    // Open Raise drawer and select MAX (980)
    await user.click(await screen.findByRole('button', { name: /^raise$/i }))
    await user.click(screen.getByRole('button', { name: /^max$/i }))
    expect(screen.getByLabelText(/raise amount/i)).toHaveValue('980')

    // Phase advances to FLOP and it is still p-1's turn first to act
    await act(async () => {
      MockStompClient.simulateMessage('/game/ROOM123', createValidGameState({
        gameId: 'ROOM123',
        phase: 'FLOP',
        pot: 40,
        currentBet: 0,
        communityCards: ['2C', '7D', '9H'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'TestPlayer',
        legalActions: ['FOLD', 'CHECK', 'BET'],
        players: [
          { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 0, status: 'ACTIVE' },
          { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE' },
        ],
      }))
    })

    // Open Bet drawer on FLOP: raiseAmount should have reset to default minBet (20), not stale 980
    await user.click(await screen.findByRole('button', { name: /^bet$/i }))
    expect(screen.getByLabelText(/raise amount/i)).toHaveValue('20')
  })
})

