import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TablePots, PotBreakdown, CompactPotDetails } from '../TablePots';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../../constants/strings';
import '@testing-library/jest-dom';

describe('TablePots', () => {
    it('single main pot renders total chips formatted correctly and phase without underscores', () => {
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
        expect(screen.getByText('$1,500')).toBeInTheDocument();
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
        expect(screen.getByText('$2,000')).toBeInTheDocument();
        expect(screen.getByText('RIVER')).toBeInTheDocument();
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
        expect(screen.getByText('$1,000')).toBeInTheDocument();

        expect(screen.getByText(`${LABEL_SIDE_POT_PREFIX} 1`)).toBeInTheDocument();
        expect(screen.getByText('$500')).toBeInTheDocument();

        expect(screen.getByText(`${LABEL_SIDE_POT_PREFIX} 2`)).toBeInTheDocument();
        expect(screen.getByText('$250')).toBeInTheDocument();

        expect(screen.getByText(LABEL_UNCALLED)).toBeInTheDocument();
        expect(screen.getByText('$100')).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /hide pot details/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region', { name: /pot breakdown/i })).toBeInTheDocument();
        expect(screen.getByText('$1,200')).toBeInTheDocument();
        expect(screen.getByText('$400')).toBeInTheDocument();

        // Click to collapse
        await user.click(toggleBtn);
        expect(screen.getByRole('button', { name: /show pot details/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: /pot breakdown/i })).not.toBeInTheDocument();
    });
});
