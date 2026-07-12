import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShowdownModal } from '../ShowdownModal';
import type { GameState } from '../../types';

vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>();
    return {
        ...actual,
        useReducedMotion: () => true,
    };
});

const showdownResult: GameState = {
    gameId: 'ROOM123',
    maxPlayers: 6,
    pot: 1500,
    pots: [1000, 500],
    phase: 'SHOWDOWN',
    currentBet: 0,
    communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
    currentPlayerId: '',
    currentPlayerName: '',
    winners: ['TestPlayer'],
    winningsPerPlayer: 1500,
    players: [
        {
            id: 'p-1',
            name: 'TestPlayer',
            chips: 2480,
            currentBet: 0,
            status: 'ACTIVE',
            hasFolded: false,
            handRank: 'TWO_PAIR',
            holeCards: ['AS', 'KS'],
            isWinner: true,
            chipsWon: 1500,
        },
        {
            id: 'p-2',
            name: 'Opponent',
            chips: 480,
            currentBet: 0,
            status: 'ACTIVE',
            hasFolded: false,
            handRank: 'PAIR',
        },
    ],
};

describe('ShowdownModal', () => {
    it('returns focus to the full-review trigger after closing the review dialog', async () => {
        const user = userEvent.setup();
        render(<ShowdownModal showdownResult={showdownResult} />);

        const summary = screen.getByRole('region', { name: /round result/i });
        await user.click(within(summary).getByRole('button', { name: /show result details/i }));

        const fullReviewTrigger = within(summary).getByRole('button', { name: /open full result review/i });
        await user.click(fullReviewTrigger);

        const review = await screen.findByRole('dialog', { name: /full result review/i });
        const close = within(review).getByRole('button', { name: /close full result review/i });
        expect(close).toHaveFocus();

        await user.click(close);

        expect(screen.queryByRole('dialog', { name: /full result review/i })).not.toBeInTheDocument();
        expect(fullReviewTrigger).toHaveFocus();
    });

    it('keeps the full-review path operable when reduced motion is preferred', async () => {
        const user = userEvent.setup();
        render(<ShowdownModal showdownResult={showdownResult} />);

        const summary = screen.getByRole('region', { name: /round result/i });
        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));

        const review = await screen.findByRole('dialog', { name: /full result review/i });
        expect(review).toBeVisible();
        expect(within(review).getByRole('button', { name: /close full result review/i })).toHaveFocus();
    });

    it('keeps keyboard focus contained inside the full-review dialog', async () => {
        const user = userEvent.setup();
        render(<ShowdownModal showdownResult={showdownResult} />);

        const summary = screen.getByRole('region', { name: /round result/i });
        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));

        const review = await screen.findByRole('dialog', { name: /full result review/i });
        const close = within(review).getByRole('button', { name: /close full result review/i });
        expect(close).toHaveFocus();

        await user.tab({ shift: true });
        expect(close).toHaveFocus();

        await user.tab();
        expect(close).toHaveFocus();
    });
});
