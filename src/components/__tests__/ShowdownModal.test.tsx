import { render, screen, within } from '@testing-library/react';
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
    it('renders the showdown summary correctly', () => {
        render(<ShowdownModal showdownResult={showdownResult} />);

        const summary = screen.getByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/TestPlayer won!/i)).toBeInTheDocument();
        expect(within(summary).getByText(/TWO PAIR/i)).toBeInTheDocument();
        expect(within(summary).getByText(/\+\$1,500/i)).toBeInTheDocument();
    });
});
