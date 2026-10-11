import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResultDock } from '../ResultDock';
import type { GameState } from '../../types';
import '@testing-library/jest-dom';

const showdownState: GameState = {
    gameId: 'game-1',
    phase: 'SHOWDOWN',
    pot: 400,
    currentBet: 0,
    communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
    currentPlayerId: '',
    currentPlayerName: '',
    maxPlayers: 6,
    winners: ['Hero'],
    winningsPerPlayer: 400,
    players: [
        {
            id: 'p-1',
            name: 'Hero',
            chips: 1400,
            currentBet: 0,
            status: 'ACTIVE',
            hasFolded: false,
            handRank: 'TWO_PAIR',
            isWinner: true,
        },
        {
            id: 'p-2',
            name: 'Villain',
            chips: 600,
            currentBet: 0,
            status: 'ACTIVE',
            hasFolded: false,
            handRank: 'PAIR',
        },
    ],
};

describe('ResultDock', () => {
    it('renders the Ready button by default when isReadyEligible is omitted', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();

        render(<ResultDock showdownResult={showdownState} isReady={false} onReady={onReady} />);

        const readyBtn = screen.getByRole('button', { name: /^ready$/i });
        expect(readyBtn).toBeInTheDocument();
        expect(readyBtn).not.toBeDisabled();

        await user.click(readyBtn);
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('hides the Ready and Unready buttons when isReadyEligible is false', () => {
        const { rerender } = render(
            <ResultDock
                showdownResult={showdownState}
                isReady={false}
                isReadyEligible={false}
                onReady={vi.fn()}
                onUnready={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: /^ready$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /unready/i })).not.toBeInTheDocument();

        rerender(
            <ResultDock
                showdownResult={showdownState}
                isReady={true}
                isReadyEligible={false}
                onReady={vi.fn()}
                onUnready={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: /^ready$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /unready/i })).not.toBeInTheDocument();
    });

    it('disables the Ready and Unready buttons while isActionPending is true', () => {
        const { rerender } = render(
            <ResultDock
                showdownResult={showdownState}
                isReady={false}
                isReadyEligible={true}
                isActionPending={true}
                onReady={vi.fn()}
                onUnready={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /^ready$/i })).toBeDisabled();

        rerender(
            <ResultDock
                showdownResult={showdownState}
                isReady={true}
                isReadyEligible={true}
                isActionPending={true}
                onReady={vi.fn()}
                onUnready={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /unready/i })).toBeDisabled();
    });

    it('displays the ready countdown and ready player count when isReadyCountdownActive is true', () => {
        render(
            <ResultDock
                showdownResult={showdownState}
                isReady={false}
                isReadyEligible={true}
                isReadyCountdownActive={true}
                readyCountdownSecondsRemaining={12}
                readyCount={1}
                readyEligibleCount={2}
                onReady={vi.fn()}
            />,
        );

        expect(screen.getByText(/12s/i)).toBeInTheDocument();
        expect(screen.getByText(/1\/2/i)).toBeInTheDocument();
    });
});
