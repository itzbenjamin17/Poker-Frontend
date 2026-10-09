
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
            expect(cardEl).toHaveTextContent('10');
            expect(cardEl).toHaveTextContent('♠');
        });

        test('handles unknown card values fallback gracefully', () => {
            render(<CardUI card="9X" />);
            const cardEl = screen.getByRole('img', { name: /9 of unknown/i });
            expect(cardEl).toBeInTheDocument();
            expect(cardEl).toHaveTextContent('9');
            expect(cardEl).toHaveTextContent('?');
        });
        test('scales dimensions according to scale and semantic size variants', () => {
            const { rerender } = render(<CardUI card="AH" scale={1} size="md" />);
            let cardEl = screen.getByRole('img', { name: /ace of hearts/i });
            expect(cardEl).toHaveStyle({ width: '48px', height: '64px' });

            rerender(<CardUI card="AH" scale={1} size="sm" />);
            cardEl = screen.getByRole('img', { name: /ace of hearts/i });
            expect(cardEl).toHaveStyle({ width: '38px', height: '51px' });

            rerender(<CardUI card="AH" scale={1} size="lg" />);
            cardEl = screen.getByRole('img', { name: /ace of hearts/i });
            expect(cardEl).toHaveStyle({ width: '53px', height: '70px' });
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

        test('renders player basic info (initials, chips, bet)', () => {
            render(<PlayerPod player={mockPlayer} />);
            expect(screen.getByText('VI')).toBeInTheDocument(); // Initials
            expect(screen.getByText('5,000')).toBeInTheDocument(); //
            expect(screen.getByText('BET: 450')).toBeInTheDocument(); // Current bet
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

        test('renders hand rank badge when provided', () => {
            render(<PlayerPod player={mockPlayer} handRank="TWO_PAIR" />);
            expect(screen.getByText('TWO PAIR')).toBeInTheDocument();
        });

        test('PlayerPod bounding box dimensions strictly match avatar diameter regardless of bet or hand rank', () => {
            const { rerender } = render(<PlayerPod player={{ ...mockPlayer, currentBet: 0 }} size="md" scale={1} />);
            const podEl = screen.getByTestId('player-pod');
            expect(podEl).toHaveStyle({ width: '80px', height: '80px' });

            const avatarEl = screen.getByTestId('player-avatar');
            expect(avatarEl.parentElement).toBe(podEl);

            // Add bottom-heavy elements: bet, hand rank, disconnect countdown, ready
            rerender(
                <PlayerPod
                    player={{ ...mockPlayer, currentBet: 500, isReadyForNextHand: true, status: 'DISCONNECTED' }}
                    handRank="FLUSH"
                    disconnectSecondsRemaining={60}
                    size="md"
                    scale={1}
                />
            );
            // Bounding box dimensions must remain strictly 80px x 80px
            expect(podEl).toHaveStyle({ width: '80px', height: '80px' });
        });
    });
});

