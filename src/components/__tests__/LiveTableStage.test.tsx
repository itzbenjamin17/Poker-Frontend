import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveTableStage } from '../LiveTableStage';
import { getTableDimensions, getTableScale } from '../../lib/tableGeometry';
import type { GameState, Player } from '../../types';
import '@testing-library/jest-dom';

const measured = vi.hoisted(() => ({ width: 0, height: 0 }));

vi.mock('../../hooks/useElementSize', () => ({
    useElementSize: () => ({ ref: () => {}, width: measured.width, height: measured.height }),
}));

describe('LiveTableStage', () => {
    const defaultHero: Player = {
        id: 'p-1',
        name: 'Hero',
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    const defaultOpponent: Player = {
        id: 'p-2',
        name: 'Villain',
        chips: 800,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    const mockGameState: GameState = {
        gameId: 'game-1',
        phase: 'FLOP',
        pot: 120,
        communityCards: ['AS', 'KH', '2D'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'Hero',
        currentBet: 0,
        maxPlayers: 6,
        players: [defaultHero, defaultOpponent],
    };

    const defaultProps = {
        nowMs: 100000,
        gameState: mockGameState,
        orderedPlayers: [defaultHero, defaultOpponent],
        myPlayerId: 'p-1',
        showdown: null,
        privateState: { holeCards: ['AH', 'AD'] },
    };

    beforeEach(() => {
        measured.width = 0;
        measured.height = 0;
    });

    it('renders structural elements: table surface, board cluster, hero seat, and opponent seats', () => {
        render(<LiveTableStage {...defaultProps} />);

        expect(screen.getByTestId('live-table-stage')).toBeInTheDocument();
        expect(screen.getByTestId('table-surface')).toBeInTheDocument();
        expect(screen.getByTestId('board-cluster')).toBeInTheDocument();
        expect(screen.getByTestId('hero-seat')).toBeInTheDocument();
        expect(screen.getByTestId('opponent-seat-p-2')).toBeInTheDocument();
    });

    it('renders community cards and pot breakdown within board cluster', () => {
        render(<LiveTableStage {...defaultProps} />);

        expect(screen.getByTestId('board-cluster')).toBeInTheDocument();
        expect(screen.getByLabelText('Total Pot')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /ace of spades/i })).toBeInTheDocument();
    });

    it('has no stage padding: the inset lives in getTableDimensions only', () => {
        render(<LiveTableStage {...defaultProps} />);
        const stage = screen.getByTestId('live-table-stage');
        expect(stage.className).not.toMatch(/(^|\s)p[xytblr]?-/);
    });

    it('sizes the table from the measured stage with one 2.15:1 aspect', () => {
        measured.width = 900;
        measured.height = 500;
        render(<LiveTableStage {...defaultProps} />);

        const expected = getTableDimensions(900, 500);
        const surface = screen.getByTestId('table-surface');
        expect(surface.style.width).toBe(`${expected.width}px`);
        expect(surface.style.height).toBe(`${expected.height}px`);
        expect(surface.style.borderRadius).toBe('50%');
        expect(surface.style.getPropertyValue('--table-scale')).toBe(
            String(getTableScale(expected, 2).overall),
        );
    });

    it('falls back to a default stage while unmeasured', () => {
        render(<LiveTableStage {...defaultProps} />);

        const expected = getTableDimensions(1024, 600);
        const surface = screen.getByTestId('table-surface');
        expect(surface.style.width).toBe(`${expected.width}px`);
        expect(surface.style.height).toBe(`${expected.height}px`);
    });

    it('derives the UI scale from the measured stage (smaller stage, smaller scale)', () => {
        measured.width = 900;
        measured.height = 500;
        const { unmount } = render(<LiveTableStage {...defaultProps} />);
        const big = Number(screen.getByTestId('table-surface').style.getPropertyValue('--table-scale'));
        unmount();

        measured.width = 600;
        measured.height = 250;
        render(<LiveTableStage {...defaultProps} />);
        const small = Number(screen.getByTestId('table-surface').style.getPropertyValue('--table-scale'));

        expect(small).toBeLessThan(big);
        expect(small).toBeGreaterThanOrEqual(0.4);
    });

    it('scales the rendered seats with the measured stage (no default-scale bypass)', () => {
        measured.width = 900;
        measured.height = 500;
        const { unmount } = render(<LiveTableStage {...defaultProps} />);
        const bigWidth = parseFloat(
            within(screen.getByTestId('hero-seat')).getByTestId('player-pod').style.width,
        );
        unmount();

        measured.width = 600;
        measured.height = 250;
        render(<LiveTableStage {...defaultProps} />);
        const smallWidth = parseFloat(
            within(screen.getByTestId('hero-seat')).getByTestId('player-pod').style.width,
        );

        expect(smallWidth).toBeLessThan(bigWidth);
    });

    it('treats the player with myPlayerId as hero even when they are not first (heroIndex 1)', () => {
        render(
            <LiveTableStage
                {...defaultProps}
                orderedPlayers={[defaultOpponent, defaultHero]}
            />,
        );

        const hero = screen.getByTestId('hero-seat');
        expect(hero).toHaveAccessibleName('Hero hero seat');
        expect(hero.style.left).toBe('50%');
        expect(hero.style.top).toBe('86%');
        expect(screen.getByTestId('opponent-seat-p-2')).toHaveAccessibleName('Villain seat');
        expect(screen.queryByTestId('opponent-seat-p-1')).not.toBeInTheDocument();
    });

    it('places opponents on the ellipse relative to the hero when the hero is last', () => {
        const third: Player = { ...defaultOpponent, id: 'p-3', name: 'Third' };
        render(
            <LiveTableStage
                {...defaultProps}
                gameState={{ ...mockGameState, players: [defaultOpponent, third, defaultHero] }}
                orderedPlayers={[defaultOpponent, third, defaultHero]}
            />,
        );

        const first = screen.getByTestId('opponent-seat-p-2');
        const second = screen.getByTestId('opponent-seat-p-3');
        // Clockwise after the hero: first opponent on the left, second on the right
        expect(parseFloat(first.style.left)).toBeLessThan(50);
        expect(parseFloat(second.style.left)).toBeGreaterThan(50);
    });

    it('does not accept layout props that could shadow the measured layout', () => {
        // Type-level regression guard: these props were removed from LiveTableStageProps.
        // @ts-expect-error scale is derived from the measured stage only
        render(<LiveTableStage {...defaultProps} scale={1} />);
        // @ts-expect-error tier is derived from the measured table width only
        render(<LiveTableStage {...defaultProps} tableTier="wide" />);
        // @ts-expect-error seat positions are derived from the measured stage only
        render(<LiveTableStage {...defaultProps} getSeatPosition={() => ({})} />);
        // @ts-expect-error hero index is derived from myPlayerId only
        render(<LiveTableStage {...defaultProps} heroIndex={0} />);
    });

    it('passes measured tableDimensions to OpponentSeats without querying the DOM during render', () => {
        measured.width = 1920;
        measured.height = 927;

        const players: Player[] = Array.from({ length: 8 }, (_, idx) => ({
            id: `p-${idx + 1}`,
            name: `Player ${idx + 1}`,
            chips: 1000,
            status: 'ACTIVE',
            currentBet: 0,
            hasFolded: false,
            isReadyForNextHand: false,
            holeCards: ['AH', 'KH'],
            handRank: 'FLUSH',
        }));

        const showdownState: GameState = {
            ...mockGameState,
            phase: 'SHOWDOWN',
            maxPlayers: 8,
            players,
        };

        const querySelectorSpy = vi.spyOn(document, 'querySelector');
        try {
            render(
                <LiveTableStage
                    {...defaultProps}
                    gameState={showdownState}
                    orderedPlayers={players}
                    myPlayerId="p-1"
                    showdown={showdownState}
                />,
            );

            expect(querySelectorSpy).not.toHaveBeenCalledWith('[data-testid="table-surface"]');

            // Top-centre opponent in an 8-player table is p-5 (index 4).
            // At 1920x927 stage (table ~1855x863), scale is clamped at 1.15; only the real tableDimensions
            // provide enough board clearance for seatHandRankFits to keep the hand rank visible (not sr-only).
            const topSeat = screen.getByTestId('opponent-seat-p-5');
            const handRank = within(topSeat).getByTestId('seat-hand-rank');
            expect(handRank).not.toHaveClass('sr-only');
        } finally {
            querySelectorSpy.mockRestore();
        }
    });
});
