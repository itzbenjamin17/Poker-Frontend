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
});
