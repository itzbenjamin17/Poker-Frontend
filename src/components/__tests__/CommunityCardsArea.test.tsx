import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommunityCardsArea } from '../CommunityCardsArea';
import { CARD_PLACEHOLDER_TURN, CARD_PLACEHOLDER_RIVER } from '../../constants/strings';
import '@testing-library/jest-dom';

describe('CommunityCardsArea', () => {
    it('PRE_FLOP: renders 5 placeholder slots when no cards are dealt', () => {
        render(<CommunityCardsArea communityCards={[]} scale={1} />);

        // No card images
        expect(screen.queryAllByRole('img')).toHaveLength(0);
        // 5 semantic placeholder slots with ARIA group role
        const placeholders = screen.getAllByRole('group', { name: /empty card slot/i });
        expect(placeholders).toHaveLength(5);
    });

    it('renders as a semantic region with accessible name "Community cards"', () => {
        render(<CommunityCardsArea communityCards={[]} scale={1} />);
        expect(screen.getByRole('region', { name: /community cards/i })).toBeInTheDocument();
    });

    it('FLOP: displays 3 dealt cards and 2 placeholder slots with Turn label', () => {
        render(
            <CommunityCardsArea communityCards={['AH', 'KD', 'QS']} scale={1} />
        );

        const cards = screen.getAllByRole('img');
        expect(cards).toHaveLength(3);
        expect(screen.getByLabelText('Ace of Hearts')).toBeInTheDocument();
        expect(screen.getByLabelText('King of Diamonds')).toBeInTheDocument();
        expect(screen.getByLabelText('Queen of Spades')).toBeInTheDocument();

        const placeholders = screen.getAllByRole('group', { name: /empty card slot/i });
        expect(placeholders).toHaveLength(2);
        expect(screen.getByText(CARD_PLACEHOLDER_TURN)).toBeInTheDocument();
    });

    it('TURN: displays 4 dealt cards and 1 placeholder slot with River label', () => {
        render(
            <CommunityCardsArea communityCards={['AH', 'KD', 'QS', 'JC']} scale={1} />
        );

        const cards = screen.getAllByRole('img');
        expect(cards).toHaveLength(4);
        expect(screen.getByLabelText('Jack of Clubs')).toBeInTheDocument();

        const placeholders = screen.getAllByRole('group', { name: /empty card slot/i });
        expect(placeholders).toHaveLength(1);
        expect(screen.getByText(CARD_PLACEHOLDER_RIVER)).toBeInTheDocument();
    });

    it('RIVER: displays all 5 dealt cards and 0 placeholder slots', () => {
        render(
            <CommunityCardsArea communityCards={['AH', 'KD', 'QS', 'JC', 'TH']} scale={1} />
        );

        const cards = screen.getAllByRole('img');
        expect(cards).toHaveLength(5);
        expect(screen.getByLabelText('Ten of Hearts')).toBeInTheDocument();

        const placeholders = screen.queryAllByRole('group', { name: /empty card slot/i });
        expect(placeholders).toHaveLength(0);
    });

    it('scales gap and dimensions according to scale prop', () => {
        render(<CommunityCardsArea communityCards={[]} scale={1.5} />);

        const region = screen.getByRole('region', { name: /community cards/i });
        expect(region.style.gap).toBe('18px');

        const firstPlaceholder = screen.getByTestId('board-slot-0');
        expect(firstPlaceholder.style.width).toBe('72px');
        expect(firstPlaceholder.style.height).toBe('96px');
    });
});
