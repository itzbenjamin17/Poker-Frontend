import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { BoardCluster } from '../BoardCluster';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../../constants/strings';
import type { GamePhase, GameState } from '../../types';
import type { TableScale } from '../../lib/tableGeometry';
import '@testing-library/jest-dom';

describe('BoardCluster', () => {
    const mockScale: TableScale = {
        overall: 1,
        avatar: 1,
        heroCard: 1,
        opponentCard: 1,
        text: 1,
        badge: 1,
        spacing: 1,
    };

    const baseGameState: GameState = {
        gameId: 'game-123',
        phase: 'FLOP',
        pot: 3500,
        communityCards: ['AH', 'KD', 'QS'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'Player 1',
        currentBet: 0,
        maxPlayers: 6,
        players: [],
    };

    it('renders structural elements: board cluster, pot container, and community cards', () => {
        render(
            <BoardCluster
                gameState={baseGameState}
                displayedPot={3500}
                mainPot={3500}
                sidePots={[]}
                uncalledAmount={0}
                tableScale={mockScale}
            />
        );

        expect(screen.getByTestId('board-cluster')).toBeInTheDocument();
        expect(screen.getByTestId('board-cluster-pot-container')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /community cards/i })).toBeInTheDocument();
        expect(screen.getByTestId('table-pot')).toBeInTheDocument();
    });

    it('shows no phase pill on any street', () => {
        const phases: GamePhase[] = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];
        for (const phase of phases) {
            const { unmount } = render(
                <BoardCluster
                    gameState={{ ...baseGameState, phase }}
                    displayedPot={1500}
                    mainPot={1500}
                    sidePots={[]}
                    uncalledAmount={0}
                    tableScale={mockScale}
                />
            );
            expect(screen.queryByTestId('pot-phase')).not.toBeInTheDocument();
            unmount();
        }
    });

    it('enforces accessible high-contrast pill styling on main pot container and labels within board cluster', () => {
        render(
            <BoardCluster
                gameState={{ ...baseGameState, phase: 'TURN' }}
                displayedPot={4000}
                mainPot={2500}
                sidePots={[1500]}
                uncalledAmount={0}
                tableScale={mockScale}
            />
        );

        const potContainer = screen.getByTestId('board-cluster-pot-container');
        const mainPotPill = within(potContainer).getByTestId('table-pot');

        expect(mainPotPill).toHaveClass('bg-black/60');
        expect(mainPotPill).toHaveClass('rounded-full');
        expect(mainPotPill).toHaveClass('border-white/10');

        // Main pot amount text is pure white (> 10:1 contrast)
        expect(within(mainPotPill).getByText('2,500')).toHaveClass('text-white');

        // Sub-label meets contrast standard with text-white/90
        expect(within(mainPotPill).getByText(LABEL_MAIN_POT)).toHaveClass('text-white/90');
    });

    it('enforces accessible high-contrast pill styling on side pots and uncalled amounts when expanded in board cluster', async () => {
        const user = userEvent.setup();
        render(
            <BoardCluster
                gameState={{ ...baseGameState, phase: 'RIVER' }}
                displayedPot={6000}
                mainPot={3500}
                sidePots={[2000]}
                uncalledAmount={500}
                tableScale={mockScale}
            />
        );

        const potContainer = screen.getByTestId('board-cluster-pot-container');
        const sidePotToggle = within(potContainer).getByTestId('side-pot-chip');
        await user.click(sidePotToggle);

        // Side pot pill
        const sidePotLabel = within(potContainer).getByText(`${LABEL_SIDE_POT_PREFIX} 1`);
        expect(sidePotLabel).toHaveClass('text-white/90');
        const sidePotPill = sidePotLabel.closest('div');
        expect(sidePotPill).toHaveClass('bg-black/60');
        expect(sidePotPill).toHaveClass('rounded-full');

        // Uncalled amount pill
        const uncalledLabel = within(potContainer).getByText(LABEL_UNCALLED);
        expect(uncalledLabel).toHaveClass('text-white/90');
        const uncalledPill = uncalledLabel.closest('div');
        expect(uncalledPill).toHaveClass('bg-black/60');
        expect(uncalledPill).toHaveClass('rounded-full');
    });

    it('applies potShrink scaling when more than 2 side pots exist while preserving container contrast', () => {
        const { container: normalContainer, unmount } = render(
            <BoardCluster
                gameState={{ ...baseGameState, phase: 'FLOP' }}
                displayedPot={5000}
                mainPot={2000}
                sidePots={[1500, 1500]}
                uncalledAmount={0}
                tableScale={mockScale}
            />
        );

        const normalPot = within(normalContainer).getByTestId('table-pot');
        const normalPadding = normalPot.style.padding;
        unmount();

        const { container: shrinkContainer } = render(
            <BoardCluster
                gameState={{ ...baseGameState, phase: 'FLOP' }}
                displayedPot={6500}
                mainPot={2000}
                sidePots={[1500, 1500, 1500]}
                uncalledAmount={0}
                tableScale={mockScale}
            />
        );

        const shrinkPot = within(shrinkContainer).getByTestId('table-pot');
        const shrinkPotContainer = within(shrinkContainer).getByTestId('board-cluster-pot-container');

        // High contrast styling remains intact even under potShrink
        expect(shrinkPot).toHaveClass('bg-black/60');
        expect(shrinkPot).toHaveClass('rounded-full');
        expect(shrinkPotContainer).toBeInTheDocument();

        // The pot shrinks (padding scales by 0.75) once there are more than two side pots.
        expect(shrinkPot.style.padding).not.toBe(normalPadding);
    });
});
