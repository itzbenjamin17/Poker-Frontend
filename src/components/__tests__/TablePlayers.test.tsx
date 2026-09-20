import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect } from 'vitest';
import { TablePlayers } from '../TablePlayers';
import type { Player, GameState } from '../../types';

describe('TablePlayers', () => {
    const mockGetSeatPosition = () => ({
        left: 50,
        top: 50,
        cardPlacement: 'below' as const,
    });

    const player1: Player = {
        id: 'p-1',
        name: 'Alice',
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    const player2: Player = {
        id: 'p-2',
        name: 'Bob',
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    describe('Item 16: Showdown card reveal behavior', () => {
        test('renders opponent cards facedown when not in showdown', () => {
            render(
                <TablePlayers
                    orderedPlayers={[player1, player2]}
                    currentPlayerId="p-1"
                    myPlayerId="p-1" // Player 1 is hero, Player 2 is opponent
                    showdown={null}
                    privateState={{ holeCards: ['AS', 'KS'] }}
                    getSeatPosition={mockGetSeatPosition}
                    isCompactTable={false}
                    nowMs={100000}
                    scale={1}
                />
            );

            // Opponent Bob should have hidden cards rendered
            const hiddenCards = screen.getAllByLabelText('Hidden Card');
            expect(hiddenCards.length).toBeGreaterThanOrEqual(2);
        });

        test('renders winning player hole cards face up during showdown', () => {
            const showdownState: GameState = {
                gameId: 'game-1',
                phase: 'SHOWDOWN',
                pot: 200,
                communityCards: ['2C', '7D', '9H', 'JC', 'KD'],
                currentPlayerId: 'p-2',
                currentPlayerName: 'Villain',
                currentBet: 0,
                maxPlayers: 6,
                players: [
                    {
                        ...player1,
                        isWinner: true,
                        holeCards: ['AH', 'KH'],
                        handRank: 'FLUSH',
                    },
                    {
                        ...player2,
                        isWinner: false,
                        holeCards: ['8S', '8C'],
                        handRank: 'PAIR',
                    },
                ],
            };

            render(
                <TablePlayers
                    orderedPlayers={[player1, player2]}
                    currentPlayerId={undefined}
                    myPlayerId="p-2" // Bob is viewing; Alice is the showdown winner
                    showdown={showdownState}
                    privateState={{ holeCards: ['8S', '8C'] }}
                    getSeatPosition={mockGetSeatPosition}
                    isCompactTable={false}
                    nowMs={100000}
                    scale={1}
                />
            );

            // Alice's winning cards should be visible face up
            expect(screen.getByRole('img', { name: /ace of hearts/i })).toBeInTheDocument();
            expect(screen.getByRole('img', { name: /king of hearts/i })).toBeInTheDocument();
        });
    });

    describe('Item 17: Disconnect countdown overlay', () => {
        test('renders disconnect countdown timer when player status is DISCONNECTED', () => {
            const nowMs = 1_000_000;
            // 95 seconds remaining (95,000 ms in future)
            const disconnectedPlayer: Player = {
                ...player2,
                status: 'DISCONNECTED',
                disconnectDeadlineEpochMs: nowMs + 95_000,
            };

            render(
                <TablePlayers
                    orderedPlayers={[player1, disconnectedPlayer]}
                    currentPlayerId="p-1"
                    myPlayerId="p-1"
                    showdown={null}
                    privateState={{ holeCards: ['AS', 'KS'] }}
                    getSeatPosition={mockGetSeatPosition}
                    isCompactTable={false}
                    nowMs={nowMs}
                    scale={1}
                />
            );

            expect(screen.getByText('OFF')).toBeInTheDocument();
            expect(screen.getByText('Reconnect in 01:35')).toBeInTheDocument();
        });
    });

    describe('Item 32: Opponent expanded state', () => {
        const player3: Player = {
            id: 'p-3',
            name: 'Charlie',
            chips: 800,
            status: 'ACTIVE',
            currentBet: 50,
            hasFolded: false,
            isReadyForNextHand: false,
        };

        test('clicking opponent pod expands detail view, clicking again collapses it, and clicking another switches expansion', async () => {
            const user = userEvent.setup();
            render(
                <TablePlayers
                    orderedPlayers={[player1, player2, player3]}
                    currentPlayerId="p-1"
                    myPlayerId="p-1" // Alice is hero, Bob and Charlie are opponents
                    showdown={null}
                    privateState={{ holeCards: ['AS', 'KS'] }}
                    getSeatPosition={mockGetSeatPosition}
                    isCompactTable={false}
                    nowMs={100000}
                    scale={1}
                />
            );

            // Hero (Alice) should NOT have an expandable button
            expect(screen.queryByRole('button', { name: /Alice seat details/i })).not.toBeInTheDocument();

            const bobButton = screen.getByRole('button', { name: /Bob seat details/i });
            const charlieButton = screen.getByRole('button', { name: /Charlie seat details/i });

            expect(bobButton).toHaveAttribute('aria-expanded', 'false');
            expect(charlieButton).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByLabelText(/Bob expanded details/i)).not.toBeInTheDocument();
            expect(screen.queryByLabelText(/Charlie expanded details/i)).not.toBeInTheDocument();

            // 1. Clicking Bob expands Bob's detail view
            await user.click(bobButton);
            expect(bobButton).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByLabelText(/Bob expanded details/i)).toBeInTheDocument();

            // 2. Clicking Bob again collapses it
            await user.click(bobButton);
            expect(bobButton).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByLabelText(/Bob expanded details/i)).not.toBeInTheDocument();

            // 3. Clicking Bob expands Bob, then clicking Charlie collapses Bob and expands Charlie
            await user.click(bobButton);
            expect(bobButton).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByLabelText(/Bob expanded details/i)).toBeInTheDocument();

            await user.click(charlieButton);
            expect(bobButton).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByLabelText(/Bob expanded details/i)).not.toBeInTheDocument();
            expect(charlieButton).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByLabelText(/Charlie expanded details/i)).toBeInTheDocument();
        });
    });
});
