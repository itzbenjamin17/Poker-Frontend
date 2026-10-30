import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TablePots, PotBreakdown, CompactPotDetails } from '../TablePots';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../../constants/strings';
import '@testing-library/jest-dom';

describe('TablePots', () => {
    it('single main pot renders total formatted correctly and phase without underscores', () => {
        render(
            <TablePots
                displayedPot={1500}
                mainPot={1500}
                sidePots={[]}
                uncalledAmount={0}
                phase="PRE_FLOP"
            />
        );

        const potContainer = screen.getByLabelText('Total Pot');
        expect(potContainer).toBeInTheDocument();
        expect(screen.getByText('1,500')).toBeInTheDocument();
        expect(screen.getByText('PRE FLOP')).toBeInTheDocument();
    });

    it('multi-pot scenario displays main pot as prominent pot and updates aria label', () => {
        render(
            <TablePots
                displayedPot={3500}
                mainPot={2000}
                sidePots={[1500]}
                uncalledAmount={0}
                phase="RIVER"
            />
        );

        const potContainer = screen.getByLabelText(LABEL_MAIN_POT);
        expect(potContainer).toBeInTheDocument();
        expect(screen.getByText('2,000')).toBeInTheDocument();
        expect(screen.getByText('RIVER')).toBeInTheDocument();
    });

    it('resets side-pot view back to main pot when a new hand starts with a single pot', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <TablePots
                displayedPot={3500}
                mainPot={2000}
                sidePots={[1500]}
                uncalledAmount={0}
                phase="RIVER"
            />
        );

        // Open side pots view during multi-pot hand
        const sidePotToggle = screen.getByTestId('side-pot-chip');
        expect(sidePotToggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(sidePotToggle);

        expect(screen.getByText(`${LABEL_SIDE_POT_PREFIX} 1`)).toBeInTheDocument();
        expect(screen.queryByTestId('table-pot')).not.toBeInTheDocument();

        // Next hand begins with a single pot (no side pots, no uncalled amount)
        rerender(
            <TablePots
                displayedPot={30}
                mainPot={30}
                sidePots={[]}
                uncalledAmount={0}
                phase="PRE_FLOP"
            />
        );

        expect(screen.getByTestId('table-pot')).toBeInTheDocument();
        expect(screen.getByLabelText('Total Pot')).toHaveTextContent('30');
        expect(screen.queryByRole('button', { name: /hide pot details/i })).not.toBeInTheDocument();
    });

    it('enforces accessible high-contrast badge pill styling for pot phase to satisfy WCAG AA (F7-3)', () => {
        render(
            <TablePots
                displayedPot={2000}
                mainPot={2000}
                sidePots={[]}
                uncalledAmount={0}
                phase="FLOP"
            />
        );

        const phaseBadge = screen.getByTestId('pot-phase');
        expect(phaseBadge).toBeInTheDocument();
        expect(phaseBadge).toHaveTextContent('FLOP');

        // Verify high-contrast dark semi-opaque pill badge backing and white text
        expect(phaseBadge).toHaveClass('bg-black/60');
        expect(phaseBadge).toHaveClass('border-white/10');
        expect(phaseBadge).toHaveClass('text-white');
        expect(phaseBadge).toHaveClass('font-bold');
        expect(phaseBadge).toHaveClass('rounded-full');

        // Regression guard: must NOT use the low-contrast green text (1.16:1 failure against #6fad95)
        expect(phaseBadge).not.toHaveClass('text-emerald-primary/60');
    });

    it('enforces accessible styling across all poker betting phases (PRE_FLOP, FLOP, TURN, RIVER)', () => {
        const phases = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER'];

        for (const phase of phases) {
            const { unmount } = render(
                <TablePots
                    displayedPot={1000}
                    mainPot={1000}
                    sidePots={[]}
                    uncalledAmount={0}
                    phase={phase}
                />
            );

            const phaseBadge = screen.getByTestId('pot-phase');
            expect(phaseBadge).toHaveClass('bg-black/60');
            expect(phaseBadge).toHaveClass('text-white');
            expect(phaseBadge).toHaveClass('rounded-full');
            expect(phaseBadge).toHaveTextContent(phase.replace(/_/g, ' '));
            unmount();
        }
    });

    it('enforces high-contrast accessible pill backing on pot amount container and sub-labels', () => {
        render(
            <TablePots
                displayedPot={4000}
                mainPot={2500}
                sidePots={[1500]}
                uncalledAmount={0}
                phase="TURN"
            />
        );

        const potContainer = screen.getByTestId('table-pot');
        expect(potContainer).toHaveClass('bg-black/60');
        expect(potContainer).toHaveClass('rounded-full');
        expect(potContainer).toHaveClass('border-white/10');

        // Main pot amount text is crisp white
        expect(screen.getByText('2,500')).toHaveClass('text-white');

        // Sub-label meets contrast with text-white/90
        expect(screen.getByText(LABEL_MAIN_POT)).toHaveClass('text-white/90');
    });

    it('enforces accessible high-contrast pill styling on side pots and uncalled chips when expanded', async () => {
        const user = userEvent.setup();
        render(
            <TablePots
                displayedPot={5000}
                mainPot={3000}
                sidePots={[1500]}
                uncalledAmount={500}
                phase="RIVER"
            />
        );

        const sidePotToggle = screen.getByTestId('side-pot-chip');
        await user.click(sidePotToggle);

        const sidePotLabel = screen.getByText(`${LABEL_SIDE_POT_PREFIX} 1`);
        expect(sidePotLabel).toHaveClass('text-white/90');
        const sidePotChip = sidePotLabel.closest('div');
        expect(sidePotChip).toHaveClass('bg-black/60');
        expect(sidePotChip).toHaveClass('rounded-full');

        const uncalledLabel = screen.getByText(LABEL_UNCALLED);
        expect(uncalledLabel).toHaveClass('text-white/90');
        const uncalledChip = uncalledLabel.closest('div');
        expect(uncalledChip).toHaveClass('bg-black/60');
        expect(uncalledChip).toHaveClass('rounded-full');
    });
});

describe('PotBreakdown', () => {
    it('renders main pot, multiple side pots, and uncalled amounts with formatting', () => {
        render(
            <PotBreakdown
                mainPot={1000}
                sidePots={[500, 250]}
                uncalledAmount={100}
            />
        );

        const region = screen.getByRole('region', { name: /pot breakdown/i });
        expect(region).toBeInTheDocument();

        expect(screen.getByText(LABEL_MAIN_POT)).toBeInTheDocument();
        expect(screen.getByText('1,000')).toBeInTheDocument();

        expect(screen.getByText(`${LABEL_SIDE_POT_PREFIX} 1`)).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();

        expect(screen.getByText(`${LABEL_SIDE_POT_PREFIX} 2`)).toBeInTheDocument();
        expect(screen.getByText('250')).toBeInTheDocument();

        expect(screen.getByText(LABEL_UNCALLED)).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('does not render uncalled amount badge if uncalledAmount is 0', () => {
        render(
            <PotBreakdown
                mainPot={1000}
                sidePots={[]}
                uncalledAmount={0}
            />
        );

        expect(screen.queryByText(LABEL_UNCALLED)).not.toBeInTheDocument();
    });
});

describe('CompactPotDetails', () => {
    it('renders toggle button and shows/hides breakdown on click', async () => {
        const user = userEvent.setup();
        render(
            <CompactPotDetails
                mainPot={1200}
                sidePots={[400]}
                uncalledAmount={50}
            />
        );

        const toggleBtn = screen.getByRole('button', { name: /show pot details/i });
        expect(toggleBtn).toBeInTheDocument();
        expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: /pot breakdown/i })).not.toBeInTheDocument();

        // Click to expand
        await user.click(toggleBtn);
        expect(toggleBtn).toHaveFocus();
        expect(screen.getByRole('button', { name: /hide pot details/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region', { name: /pot breakdown/i })).toBeInTheDocument();
        expect(screen.getByText('1,200')).toBeInTheDocument();
        expect(screen.getByText('400')).toBeInTheDocument();

        // Click to collapse
        await user.click(toggleBtn);
        expect(toggleBtn).toHaveFocus();
        expect(screen.getByRole('button', { name: /show pot details/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: /pot breakdown/i })).not.toBeInTheDocument();
    });
});
