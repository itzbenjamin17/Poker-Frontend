import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { OpponentSeats } from '../OpponentSeats';
import { TablePlayers } from '../TablePlayers';
import { useSeatLayout } from '../../hooks/useSeatLayout';
import { getTableScale } from '../../lib/tableGeometry';
import type { GameState, Player } from '../../types';
import '@testing-library/jest-dom';

const makePlayers = (count: number): Player[] =>
    Array.from({ length: count }, (_, idx) => ({
        id: `p-${idx + 1}`,
        name: `Player_${idx + 1}`,
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 20,
        hasFolded: false,
        isReadyForNextHand: false,
        holeCards: ['AH', 'KH'],
        handRank: 'FLUSH',
    }));

describe('OpponentSeats', () => {
    it('uses passed tableDimensions without calling document.querySelector during render', () => {
        const tableDimensions = { width: 1855, height: 863 };
        const players = makePlayers(8);
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const showdownState: GameState = {
            gameId: 'g-1',
            phase: 'SHOWDOWN',
            pot: 160,
            communityCards: ['2C', '7D', '9H', 'JC', 'KD'],
            currentPlayerId: 'p-1',
            currentPlayerName: 'Player_1',
            currentBet: 0,
            maxPlayers: 8,
            players,
        };

        const querySelectorSpy = vi.spyOn(document, 'querySelector');
        try {
            render(
                <TablePlayers
                    orderedPlayers={players}
                    currentPlayerId="p-1"
                    myPlayerId="p-1"
                    showdown={showdownState}
                    privateState={{ holeCards: ['AS', 'KS'] }}
                    getSeatPosition={result.current.getSeatPosition}
                    isCompactTable={result.current.isCompactTable}
                    nowMs={100000}
                    tableScale={result.current.tableScale}
                    tableDimensions={tableDimensions}
                />,
            );

            expect(querySelectorSpy).not.toHaveBeenCalledWith('[data-testid="table-surface"]');

            const topCenterSeat = screen.getByTestId('opponent-seat-p-5');
            const handRank = within(topCenterSeat).getByTestId('seat-hand-rank');
            expect(handRank).not.toHaveClass('sr-only');
        } finally {
            querySelectorSpy.mockRestore();
        }
    });

    it('positions the expanded details popover upward (bottom-full) for lower-half seats (top > 55) and downward (top-full) for upper seats', async () => {
        const user = userEvent.setup();
        const tableDimensions = { width: 900, height: 419 };
        const players = makePlayers(8);
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const tableScale = getTableScale(tableDimensions, players.length);

        render(
            <OpponentSeats
                orderedPlayers={players}
                currentPlayerId="p-1"
                myPlayerId="p-1"
                showdown={null}
                heroIndex={0}
                getSeatPosition={result.current.getSeatPosition}
                isCompactTable={result.current.isCompactTable}
                nowMs={100000}
                tableScale={tableScale}
                tableDimensions={tableDimensions}
            />,
        );

        // In an 8-player layout (hero at index 0), Player_2 (index 1) is on the lower-left (top > 55)
        // and Player_5 (index 4) is at top-centre (top < 35).
        const lowerSeatPos = result.current.getSeatPosition(1, players.length, 0);
        const upperSeatPos = result.current.getSeatPosition(4, players.length, 0);
        expect(lowerSeatPos.top).toBeGreaterThan(55);
        expect(upperSeatPos.top).toBeLessThan(35);

        await user.click(screen.getByRole('button', { name: 'Player_2 seat details' }));
        const lowerPopover = screen.getByRole('region', { name: 'Player_2 expanded details' });
        expect(lowerPopover).toHaveAttribute('data-placement', 'top');

        await user.click(screen.getByRole('button', { name: 'Player_5 seat details' }));
        const upperPopover = screen.getByRole('region', { name: 'Player_5 expanded details' });
        expect(upperPopover).toHaveAttribute('data-placement', 'bottom');
    });

    it('displays the opponent full name inside the expanded details region and keeps PlayerPod sr-only announcements outside the toggle button', async () => {
        const user = userEvent.setup();
        const tableDimensions = { width: 900, height: 419 };
        const players: Player[] = [
            {
                id: 'p-1',
                name: 'HeroPlayer',
                chips: 1000,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
            {
                id: 'p-2',
                name: 'Maximilian_LongName_99',
                chips: 1250,
                status: 'FOLDED',
                currentBet: 40,
                hasFolded: true,
                isReadyForNextHand: false,
            },
        ];
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const tableScale = getTableScale(tableDimensions, players.length);

        render(
            <OpponentSeats
                orderedPlayers={players}
                currentPlayerId="p-2"
                myPlayerId="p-1"
                showdown={null}
                heroIndex={0}
                getSeatPosition={result.current.getSeatPosition}
                isCompactTable={result.current.isCompactTable}
                nowMs={100000}
                tableScale={tableScale}
                tableDimensions={tableDimensions}
            />,
        );

        const toggleBtn = screen.getByRole('button', { name: 'Maximilian_LongName_99 seat details' });
        const seatGroup = screen.getByRole('group', { name: 'Maximilian_LongName_99 seat' });
        const pod = within(seatGroup).getByTestId('player-pod');

        // PlayerPod must NOT be inside the toggle button (which has aria-label that would hide sr-only descendants)
        expect(toggleBtn).not.toContainElement(pod);
        expect(within(seatGroup).getByText('Active turn')).toHaveClass('sr-only');
        expect(within(seatGroup).getByText('Folded')).toHaveClass('sr-only');

        await user.click(toggleBtn);
        const popover = screen.getByRole('region', { name: 'Maximilian_LongName_99 expanded details' });
        expect(within(popover).getByText('Player')).toBeInTheDocument();
        expect(within(popover).getByText('Maximilian_LongName_99')).toBeInTheDocument();
    });

    it('passes bestHand from showdown to HeroSeat PlayerPod so hero hand rank includes kickers/details', () => {
        const tableDimensions = { width: 900, height: 419 };
        const players: Player[] = [
            {
                id: 'p-1',
                name: 'Hero',
                chips: 1500,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
            {
                id: 'p-2',
                name: 'Villain',
                chips: 500,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
        ];
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const showdownState: GameState = {
            gameId: 'g-1',
            phase: 'SHOWDOWN',
            pot: 200,
            communityCards: ['QS', 'JC', 'JH', '3S', '2D'],
            currentPlayerId: 'p-1',
            currentPlayerName: 'Hero',
            currentBet: 0,
            maxPlayers: 6,
            players: [
                {
                    ...players[0],
                    isWinner: true,
                    holeCards: ['QD', 'AH'],
                    handRank: 'TWO_PAIR',
                    bestHand: ['QS', 'QD', 'JC', 'JH', 'AH'],
                },
                players[1],
            ],
        };

        render(
            <TablePlayers
                orderedPlayers={players}
                currentPlayerId="p-1"
                myPlayerId="p-1"
                showdown={showdownState}
                privateState={{ holeCards: ['QD', 'AH'] }}
                getSeatPosition={result.current.getSeatPosition}
                isCompactTable={false}
                nowMs={100000}
                tableScale={result.current.tableScale}
                tableDimensions={tableDimensions}
            />,
        );

        const heroSeat = screen.getByTestId('hero-seat');
        expect(within(heroSeat).getByTestId('seat-hand-rank')).toHaveTextContent('Two Pair (Queens & Jacks)');
    });

    it('exposes the board-only accessible description and tooltip on revealed card images and card groups without rendering a visible PLAYS THE BOARD label', () => {
        const tableDimensions = { width: 900, height: 419 };
        const players: Player[] = [
            {
                id: 'p-1',
                name: 'Hero',
                chips: 1000,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
            {
                id: 'p-2',
                name: 'Villain',
                chips: 1000,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
        ];
        const boardHand = ['AS', 'KS', 'QS', 'JS', 'TS'];
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const showdownState: GameState = {
            gameId: 'g-board-tie',
            phase: 'SHOWDOWN',
            pot: 400,
            communityCards: boardHand,
            currentPlayerId: 'p-1',
            currentPlayerName: 'Hero',
            currentBet: 0,
            maxPlayers: 6,
            winners: ['p-1', 'p-2'],
            players: [
                {
                    ...players[0],
                    isWinner: true,
                    holeCards: ['2H', '3D'],
                    handRank: 'ROYAL_FLUSH',
                    bestHand: boardHand,
                },
                {
                    ...players[1],
                    isWinner: true,
                    holeCards: ['4C', '5D'],
                    handRank: 'ROYAL_FLUSH',
                    bestHand: boardHand,
                },
            ],
        };

        render(
            <TablePlayers
                orderedPlayers={players}
                currentPlayerId="p-1"
                myPlayerId="p-1"
                showdown={showdownState}
                privateState={{ holeCards: ['2H', '3D'] }}
                getSeatPosition={result.current.getSeatPosition}
                isCompactTable={false}
                nowMs={100000}
                tableScale={result.current.tableScale}
                tableDimensions={tableDimensions}
            />,
        );

        const expectedDescription = 'Hole cards do not play; best hand is on the board.';

        // Hero card group and individual card images
        const heroCardsGroup = screen.getByRole('group', { name: 'Hero hole cards' });
        expect(heroCardsGroup).toHaveAttribute('title', expectedDescription);
        expect(heroCardsGroup).toHaveAccessibleDescription(expectedDescription);
        for (const cardName of ['2 of Hearts', '3 of Diamonds']) {
            const cardImg = screen.getByRole('img', { name: cardName });
            expect(cardImg).not.toHaveAttribute('aria-describedby');
        }

        // Opponent card group and individual card images
        const opponentCardsGroup = screen.getByRole('group', { name: 'Villain hole cards' });
        expect(opponentCardsGroup).toHaveAttribute('title', expectedDescription);
        expect(opponentCardsGroup).toHaveAccessibleDescription(expectedDescription);
        for (const cardName of ['4 of Clubs', '5 of Diamonds']) {
            const cardImg = screen.getByRole('img', { name: cardName });
            expect(cardImg).not.toHaveAttribute('aria-describedby');
        }

        // No visible PLAYS THE BOARD label
        expect(screen.queryByText(/plays the board/i)).toBeNull();
    });

    it('elevates contributing best-hand hole cards above unused hole cards for all revealed players while keeping the gold border winner-only', () => {
        const tableDimensions = { width: 900, height: 419 };
        const players: Player[] = [
            {
                id: 'p-1',
                name: 'Hero',
                chips: 1200,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
            {
                id: 'p-2',
                name: 'LosingVillain',
                chips: 800,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
            },
        ];
        const { result } = renderHook(() => useSeatLayout(tableDimensions, players.length));
        const showdownState: GameState = {
            gameId: 'g-partial-play',
            phase: 'SHOWDOWN',
            pot: 400,
            communityCards: ['AS', 'KS', 'QD', 'JC', '9H'],
            currentPlayerId: 'p-1',
            currentPlayerName: 'Hero',
            currentBet: 0,
            maxPlayers: 6,
            winners: ['p-1'],
            players: [
                {
                    ...players[0],
                    isWinner: true,
                    holeCards: ['AH', '2C'],
                    handRank: 'ONE_PAIR',
                    bestHand: ['AS', 'AH', 'KS', 'QD', 'JC'],
                },
                {
                    ...players[1],
                    isWinner: false,
                    holeCards: ['KH', '3D'],
                    handRank: 'ONE_PAIR',
                    bestHand: ['KS', 'KH', 'AS', 'QD', 'JC'],
                },
            ],
        };

        render(
            <TablePlayers
                orderedPlayers={players}
                currentPlayerId="p-1"
                myPlayerId="p-1"
                showdown={showdownState}
                privateState={{ holeCards: ['AH', '2C'] }}
                getSeatPosition={result.current.getSeatPosition}
                isCompactTable={false}
                nowMs={100000}
                tableScale={result.current.tableScale}
                tableDimensions={tableDimensions}
            />,
        );

        // Losing opponent's used card ('KH' = King of Hearts, index 0) is elevated in front of unused card ('3D' = 3 of Diamonds, index 1)
        const losingUsedCard = screen.getByRole('img', { name: 'King of Hearts' });
        const losingUnusedCard = screen.getByRole('img', { name: '3 of Diamonds' });
        expect(Number((losingUsedCard.parentElement as HTMLElement).style.zIndex)).toBeGreaterThan(
            Number((losingUnusedCard.parentElement as HTMLElement).style.zIndex),
        );
        expect(losingUsedCard.className).not.toMatch(/ring-gold-secondary/);
        expect(losingUnusedCard.className).toMatch(/grayscale/);

        const winningUsedCard = screen.getByRole('img', { name: 'Ace of Hearts' });
        expect(winningUsedCard.className).toMatch(/ring-gold-secondary/);

        // Neither seat plays the board because each player uses one hole card
        expect(screen.getByRole('group', { name: 'Hero hole cards' })).not.toHaveAttribute('title');
        expect(screen.getByRole('group', { name: 'LosingVillain hole cards' })).not.toHaveAttribute('title');
    });
});

