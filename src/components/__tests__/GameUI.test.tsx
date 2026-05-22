
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { CardUI, PlayerPod } from '../GameUI';
import type { Player } from '../../types';

describe('GameUI Components', () => {
    describe('CardUI', () => {
        test('renders a hidden card', () => {
            render(<CardUI card="hidden" hidden={true} />);
            const cardEl = screen.getByLabelText('Hidden Card');
            expect(cardEl).toBeInTheDocument();
        });

        test('renders a visible card with correct rank and suit (Hearts)', () => {
            render(<CardUI card="AH" />);
            const cardEl = screen.getByRole('img', { name: /ace of hearts/i });
            expect(cardEl).toBeInTheDocument();
            expect(cardEl).toHaveTextContent('A');
            expect(cardEl).toHaveTextContent('♥');
        });

        test('renders a visible card with correct rank and suit (Spades)', () => {
            render(<CardUI card="TS" />);
            const cardEl = screen.getByRole('img', { name: /ten of spades/i });
            expect(cardEl).toBeInTheDocument();
            expect(cardEl).toHaveTextContent('T');
            expect(cardEl).toHaveTextContent('♠');
        });

        test('handles unknown card values fallback gracefully', () => {
            render(<CardUI card="9X" />);
            const cardEl = screen.getByRole('img', { name: /9 of unknown/i });
            expect(cardEl).toBeInTheDocument();
            expect(cardEl).toHaveTextContent('9');
            expect(cardEl).toHaveTextContent('?');
        });
    });

    describe('PlayerPod', () => {
        const mockPlayer: Player = {
            id: 'p-1',
            name: 'Vik',
            chips: 5000,
            status: 'ACTIVE',
            currentBet: 450,
            hasFolded: false,
            isReadyForNextHand: false,
        };

        test('renders player basic info (name, chips, initials)', () => {
            render(<PlayerPod player={mockPlayer} />);
            expect(screen.getByRole('heading', { name: 'Vik' })).toBeInTheDocument();
            expect(screen.getByText('VI')).toBeInTheDocument(); // Initials
            expect(screen.getByText('$5,000')).toBeInTheDocument(); // Chips
            expect(screen.getByText('BET: $450')).toBeInTheDocument(); // Current bet
        });

        test('renders active turn label for screen readers when the player is current player', () => {
            render(<PlayerPod player={mockPlayer} isCurrent={true} />);
            expect(screen.getByText('Active turn')).toBeInTheDocument();
        });

        test('renders winner label for screen readers when the player is the winner', () => {
            render(<PlayerPod player={mockPlayer} isWinner={true} />);
            expect(screen.getByText('Winner')).toBeInTheDocument();
        });

        test('renders blind badges correctly (SB / BB)', () => {
            render(<PlayerPod player={mockPlayer} blindLabel="BB" />);
            expect(screen.getByText('BB')).toBeInTheDocument();
        });

        test('handles disconnected status with a countdown timer', () => {
            const disconnectedPlayer: Player = {
                ...mockPlayer,
                status: 'DISCONNECTED',
            };
            render(<PlayerPod player={disconnectedPlayer} disconnectSecondsRemaining={95} />);
            expect(screen.getByText('OFF')).toBeInTheDocument();
            expect(screen.getByText('Reconnect in 01:35')).toBeInTheDocument();
        });

        test('renders folded label for screen readers when the player is folded', () => {
            const foldedPlayer: Player = {
                ...mockPlayer,
                status: 'FOLDED',
                hasFolded: true,
            };
            render(<PlayerPod player={foldedPlayer} />);
            expect(screen.getByText('Folded')).toBeInTheDocument();
        });

        test('renders ready status indicator', () => {
            const readyPlayer: Player = {
                ...mockPlayer,
                isReadyForNextHand: true,
            };
            render(<PlayerPod player={readyPlayer} />);
            expect(screen.getByText('READY')).toBeInTheDocument();
        });
    });
});
