import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GameTableView } from '../../GameTableView';
import { GameSession } from '../../../domain/GameSession';
import { InMemoryTransportAdapter } from '../../../services/transport';
import type { GameState, RoomState } from '../../../types';
import '@testing-library/jest-dom';

describe('Table Identity Resolution', () => {
    const mockRoomState: RoomState = {
        roomId: 'ROOM123',
        roomName: 'High Stakes Table',
        players: [
            { name: 'Alice', isHost: true },
            { name: 'Bob', isHost: false },
        ],
        gameStarted: true,
        maxPlayers: 6,
        buyIn: 1000,
        smallBlind: 10,
        bigBlind: 20,
    };

    const createGameState = (overrides?: Partial<GameState>): GameState => ({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 30,
        currentBet: 20,
        maxPlayers: 6,
        currentPlayerId: 'p-alice',
        currentPlayerName: 'Alice',
        communityCards: [],
        legalActions: ['CHECK', 'BET', 'FOLD'],
        minimumBetAmount: 20,
        players: [
            {
                id: 'p-bob',
                name: 'Bob',
                chips: 1000,
                currentBet: 10,
                status: 'ACTIVE',
                hasFolded: false,
                isSmallBlind: true,
            },
            {
                id: 'p-alice',
                name: 'Alice',
                chips: 1000,
                currentBet: 20,
                status: 'ACTIVE',
                hasFolded: false,
                isBigBlind: true,
            },
        ],
        ...overrides,
    });

    it('resolves hero from auth.playerName consistently even if myPlayerId is stale or null', () => {
        const gameState = createGameState();
        const { rerender } = render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="stale-invalid-id"
                gameState={gameState}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        // Hero seat should be Alice despite stale-invalid-id
        const heroSeat = screen.getByRole('group', { name: 'Alice hero seat' });
        expect(heroSeat).toBeInTheDocument();

        // Opponents should contain Bob seat and exclude Alice seat
        expect(screen.getByRole('group', { name: 'Bob seat' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Alice seat' })).not.toBeInTheDocument();

        // Rerender with myPlayerId = null
        rerender(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId={null}
                gameState={gameState}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        const heroSeatAfter = screen.getByRole('group', { name: 'Alice hero seat' });
        expect(heroSeatAfter).toBeInTheDocument();
    });

    it('matches turn controls to the resolved hero identity', async () => {
        const gameStateAliceTurn = createGameState({
            currentPlayerId: 'p-alice',
            currentPlayerName: 'Alice',
        });

        const { rerender } = render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="invalid-stale"
                gameState={gameStateAliceTurn}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        // It is Alice's turn: Action dock indicates active turn and Fold button is present
        expect(screen.getByRole('region', { name: /action dock/i })).toHaveAttribute('data-is-active-turn', 'true');
        expect(screen.getByRole('button', { name: 'Fold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument();

        // Now change turn to Bob
        const gameStateBobTurn = createGameState({
            currentPlayerId: 'p-bob',
            currentPlayerName: 'Bob',
        });

        rerender(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="invalid-stale"
                gameState={gameStateBobTurn}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        // It is Bob's turn, not Alice's turn
        expect(screen.getByRole('region', { name: /action dock/i })).toHaveAttribute('data-is-active-turn', 'false');
        await waitFor(() => {
            expect(screen.getByText(/waiting for bob/i)).toBeInTheDocument();
        });
    });

    it('uses supplied player ID only when no player name is available', () => {
        const gameState = createGameState();
        render(
            <GameTableView
                auth={null}
                playerName={null}
                myPlayerId="p-bob"
                gameState={gameState}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        // When no player name is given, supplied myPlayerId resolves Bob as hero
        const heroSeat = screen.getByRole('group', { name: 'Bob hero seat' });
        expect(heroSeat).toBeInTheDocument();
    });

    it('populates session hero identity from initial state, accepted state, and setGameState', () => {
        const auth = { token: 'tok', roomId: 'ROOM123', playerName: 'Alice' };
        const transport = new InMemoryTransportAdapter();

        // 1. Initial state constructor resolution
        const session = new GameSession({
            auth,
            transport,
            initialGameState: createGameState(),
        });
        expect(session.getSnapshot().myPlayerId).toBe('p-alice');

        // 2. setGameState resolution
        const updatedState = createGameState({
            players: [
                { id: 'p-alice-new', name: 'Alice', chips: 1500, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                { id: 'p-bob-new', name: 'Bob', chips: 500, currentBet: 0, status: 'ACTIVE', hasFolded: false },
            ],
        });
        session.setGameState(updatedState);
        expect(session.getSnapshot().myPlayerId).toBe('p-alice-new');

        // 3. Accepted state in applyGameState
        const incomingState = createGameState({
            players: [
                { id: 'p-alice-hand3', name: 'Alice', chips: 2000, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                { id: 'p-bob-hand3', name: 'Bob', chips: 0, currentBet: 0, status: 'OUT', hasFolded: false },
            ],
            handNumber: 3,
        });
        session.applyGameState(incomingState);
        expect(session.getSnapshot().myPlayerId).toBe('p-alice-hand3');

        // 4. Stale supplied ID in applyPrivateState is rejected if it doesn't match public roster
        session.applyPrivateState({
            playerId: 'stale-other-id',
            handNumber: 3,
            holeCards: ['AH', 'KH'],
        });
        // myPlayerId remains p-alice-hand3
        expect(session.getSnapshot().myPlayerId).toBe('p-alice-hand3');
    });
});
