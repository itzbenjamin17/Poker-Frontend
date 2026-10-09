import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import { OpponentSeats } from '../OpponentSeats';
import { HeroSeat } from '../HeroSeat';
import { CardUI, PlayerPod } from '../GameUI';
import { avatarDiameter, cardFanStrip, cornerIndexMetrics, getSeatMetrics, isCompactCardScale, statusMaxWidthPx, winnerDecoration } from '../../lib/tableGeometry';
import type { TableScale } from '../../lib/tableGeometry';
import type { GameState, Player, SeatPosition } from '../../types';

const uniform = (s: number): TableScale => ({
    overall: s, avatar: s, heroCard: s, opponentCard: s, text: s, badge: s, spacing: s,
});

const makePlayer = (over: Partial<Player> = {}): Player => ({
    id: 'p-2',
    name: 'Villain',
    chips: 1000,
    status: 'ACTIVE',
    currentBet: 0,
    hasFolded: false,
    isReadyForNextHand: false,
    ...over,
});

const seat = (cardPlacement: SeatPosition['cardPlacement']): SeatPosition => ({
    left: 30,
    top: 30,
    cardPlacement,
    panelPlacement: 'left',
    side: 'left',
    verticalZone: 'middle',
    labelPlacement: cardPlacement === 'below' ? 'avatar' : 'cards',
});

const showdownFor = (player: Player): GameState => ({
    gameId: 'g',
    phase: 'SHOWDOWN',
    pot: 0,
    communityCards: [],
    currentPlayerId: 'p-2',
    currentPlayerName: 'Villain',
    currentBet: 0,
    maxPlayers: 6,
    players: [{ ...player, holeCards: ['AH', 'KH'], handRank: 'FLUSH' }],
});

function renderOpponent(player: Player, tableScale: TableScale, placement: SeatPosition['cardPlacement'] = 'right', compact = false) {
    return render(
        <OpponentSeats
            orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), player]}
            currentPlayerId={undefined}
            myPlayerId="hero"
            showdown={null}
            heroIndex={0}
            getSeatPosition={() => seat(placement)}
            isCompactTable={compact}
            nowMs={0}
            tableScale={tableScale}
        />,
    );
}

describe('seat card anchoring', () => {
    it('anchors opponent cards at avatar radius + gap, independent of rank / bet labels', () => {
        const scale = 0.8;
        const radius = avatarDiameter('md', scale) / 2;
        const expectedOffset = radius + scale * 8 + 4;

        const plain = renderOpponent(makePlayer(), uniform(scale));
        const plainCards = screen.getByTestId('seat-cards');
        expect(plainCards.style.top).toBe(`${radius}px`);
        expect(plainCards.style.transform).toBe(`translate(${expectedOffset}px, -50%)`);
        plain.unmount();

        // Same seat, now with bet + disconnect status + a revealed hand rank
        const busy = makePlayer({ currentBet: 500, status: 'DISCONNECTED', isReadyForNextHand: true });
        const { unmount } = render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), busy]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={showdownFor(busy)}
                heroIndex={0}
                getSeatPosition={() => seat('right')}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(scale)}
            />,
        );
        const busyCards = screen.getByTestId('seat-cards');
        expect(busyCards.style.top).toBe(`${radius}px`);
        expect(busyCards.style.transform).toBe(`translate(${expectedOffset}px, -50%)`);
        unmount();
    });

    it('mirrors the offset for cards placed on the left', () => {
        const scale = 1;
        const offset = avatarDiameter('md', scale) / 2 + scale * 8 + 4;
        renderOpponent(makePlayer(), uniform(scale), 'left');
        expect(screen.getByTestId('seat-cards').style.transform).toBe(`translate(calc(-100% - ${offset}px), -50%)`);
    });

    it('uses the same avatar diameter for the seat radius as the pod renders (compact tier)', () => {
        const scale = 0.7;
        renderOpponent(makePlayer(), uniform(scale), 'right', true);
        const pod = screen.getByTestId('player-pod');
        const diameter = avatarDiameter('sm', scale);
        expect(pod).toHaveStyle({ width: `${diameter}px`, height: `${diameter}px` });
        expect(screen.getByTestId('seat-cards').style.top).toBe(`${diameter / 2}px`);
    });

    it('anchors hero cards at the avatar radius using the overall scale, not the density-thinned avatar scale', () => {
        const tableScale: TableScale = { ...uniform(1), avatar: 0.5, heroCard: 0.9 };
        render(
            <HeroSeat
                player={makePlayer({ id: 'hero', name: 'Hero' })}
                privateCards={['AS', 'KS']}
                isCompactTable={false}
                nowMs={0}
                tableScale={tableScale}
            />,
        );
        const pod = screen.getByTestId('player-pod');
        expect(pod).toHaveStyle({ width: '80px', height: '80px' });
        const cards = screen.getByTestId('hero-cards');
        expect(cards.style.top).toBe('40px');
        expect(cards.style.transform).toBe(`translate(${40 + 16 + 4}px, -50%)`);
    });

    it('scales opponent cards by tableScale.opponentCard with one sizing system', () => {
        renderOpponent(makePlayer(), { ...uniform(1), opponentCard: 0.75 });
        const hidden = screen.getAllByLabelText('Hidden Card');
        expect(hidden[0]).toHaveStyle({ width: '36px', height: '48px' });
    });

    it('renders compact opponent card faces when the corner index would be below 8px', () => {
        const player = makePlayer();
        render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), player]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={showdownFor(player)}
                heroIndex={0}
                getSeatPosition={() => seat('right')}
                isCompactTable
                nowMs={0}
                tableScale={{ ...uniform(0.5), opponentCard: 0.4 }}
            />,
        );
        const cards = within(screen.getByTestId('seat-cards')).getAllByRole('img');
        expect(cards).toHaveLength(2);
        for (const card of cards) {
            expect(card).toHaveAttribute('data-compact', 'true');
        }
    });

    it('scales the expanded panel spacing with the table', async () => {
        const user = userEvent.setup();
        renderOpponent(makePlayer(), uniform(1));
        await user.click(screen.getByRole('button', { name: /villain seat details/i }));
        const big = screen.getByRole('region', { name: /villain expanded details/i });
        expect(big.style.width).toBe('176px');
        expect(big.style.padding).toBe('12px');
        expect(big.className).not.toMatch(/\bw-44\b|\bp-3\b|\bmt-2\b/);
    });
});

describe('PlayerPod parts', () => {
    const pod = (props: Partial<ComponentProps<typeof PlayerPod>> = {}) => (
        <PlayerPod
            player={makePlayer({ currentBet: 40 })}
            handRank="FLUSH"
            size="md"
            scale={1}
            {...props}
        />
    );

    it('keeps the root box equal to the avatar box whatever is hidden', () => {
        const { rerender } = render(pod());
        const root = screen.getByTestId('player-pod');
        expect(root).toHaveStyle({ width: '80px', height: '80px' });
        rerender(pod({ hideBet: true, hideHandRank: true, compact: true }));
        expect(root).toHaveStyle({ width: '80px', height: '80px' });
        expect(screen.getByTestId('player-avatar').parentElement).toBe(root);
    });

    it('keeps hidden bet and hand rank available to screen readers only', () => {
        render(pod({ hideBet: true, hideHandRank: true }));
        expect(screen.getByTestId('seat-bet')).toHaveClass('sr-only');
        expect(screen.getByTestId('seat-bet')).toHaveTextContent('BET: 40');
        expect(screen.getByTestId('seat-hand-rank')).toHaveClass('sr-only');
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('FLUSH');
    });

    it('renders visible labels by default', () => {
        render(pod());
        expect(screen.getByTestId('seat-bet')).not.toHaveClass('sr-only');
        expect(screen.getByTestId('seat-hand-rank')).not.toHaveClass('sr-only');
    });

    it('never renders a font below 8px, even at tiny scales', () => {
        render(
            <PlayerPod
                player={makePlayer({ currentBet: 40, isReadyForNextHand: true })}
                blindLabel="BB"
                handRank="FLUSH"
                isCurrent
                size="sm"
                scale={0.2}
            />,
        );
        const root = screen.getByTestId('player-pod');
        const sized = Array.from(root.querySelectorAll<HTMLElement>('[style*="font-size"]'));
        expect(sized.length).toBeGreaterThan(4);
        for (const el of sized) {
            expect(parseFloat(el.style.fontSize)).toBeGreaterThanOrEqual(8);
        }
    });

    it('lets text scale independently from the avatar scale', () => {
        render(pod({ scale: 0.5, textScale: 1 }));
        expect(screen.getByTestId('player-pod')).toHaveStyle({ width: '40px', height: '40px' });
        expect(screen.getByTestId('seat-bet').style.fontSize).toBe('9px');
    });
});

describe('CardUI compact face', () => {
    it('renders one centred rank and suit with fonts >= 8px and no mirrored index', () => {
        render(<CardUI card="TH" scale={0.375} compact />);
        const card = screen.getByRole('img', { name: /ten of hearts/i });
        expect(card).toHaveAttribute('data-compact', 'true');
        expect(card).toHaveStyle({ width: '18px', height: '24px' });
        const parts = Array.from(card.children) as HTMLElement[];
        expect(parts).toHaveLength(2);
        expect(parts[0]).toHaveTextContent('10');
        expect(parts[1]).toHaveTextContent('♥');
        for (const part of parts) {
            expect(parseFloat(part.style.fontSize)).toBeGreaterThanOrEqual(8);
            expect(part.className).not.toMatch(/rotate-180|absolute/);
        }
    });

    it('keeps the same box math as the regular face', () => {
        const { rerender } = render(<CardUI card="AS" scale={0.5} size="lg" />);
        const regular = screen.getByRole('img', { name: /ace of spades/i }).style.width;
        rerender(<CardUI card="AS" scale={0.5} size="lg" compact />);
        expect(screen.getByRole('img', { name: /ace of spades/i }).style.width).toBe(regular);
    });

    it('fits its content inside the card box across compact scales', () => {
        for (const s of [0.375, 0.45, 0.55, 0.62]) {
            const { unmount } = render(<CardUI card="TC" scale={s} compact />);
            const card = screen.getByRole('img');
            const width = parseFloat(card.style.width);
            const height = parseFloat(card.style.height);
            const padding = parseFloat(card.style.padding);
            const [rank, suit] = Array.from(card.children) as HTMLElement[];
            const stackHeight = parseFloat(rank.style.fontSize) + parseFloat(suit.style.fontSize);
            expect(stackHeight).toBeLessThanOrEqual(height - padding * 2);
            // "10" is the widest rank: two glyphs at ~0.6em each
            expect(parseFloat(rank.style.fontSize) * 1.2).toBeLessThanOrEqual(width - padding * 2);
            unmount();
        }
    });

    it('places cards below the avatar and hangs the details under the cards for "below" seats', () => {
        const scale = 1;
        const diameter = avatarDiameter('md', scale);
        const busy = makePlayer({ currentBet: 50 });
        render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), busy]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={showdownFor(busy)}
                heroIndex={0}
                getSeatPosition={() => seat('below')}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(scale)}
            />,
        );
        const cards = screen.getByTestId('seat-cards');
        // avatar diameter + the below gap (6.5 sp), centred under the avatar
        const below = getSeatMetrics({ avatarRadius: diameter / 2, avatarScale: scale, spacingScale: scale, cardScale: scale, compactFace: false });
        expect(cards.style.top).toBe(`${diameter + below.belowGap}px`);
        expect(cards.style.transform).toBe('translateX(-50%)');
        const details = screen.getByTestId('seat-hand-rank').parentElement as HTMLElement;
        // 8px base margin + the offset that puts the details under the cards (upright card height + tilt envelope + gap)
        expect(details.style.marginTop).toBe(`${8 + below.belowDetailsOffsetTop}px`);
        expect(below.belowDetailsOffsetTop).toBeGreaterThanOrEqual(64);
    });

    it('keeps the hero rank and bet to the left of the avatar without moving the anchor', () => {
        const hero = makePlayer({ id: 'hero', name: 'Hero', currentBet: 20 });
        render(
            <HeroSeat
                player={hero}
                showdown={showdownFor(hero)}
                privateCards={['AS', 'KS']}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(1)}
            />,
        );
        expect(screen.getByTestId('hero-seat')).toHaveStyle({ left: '50%', top: '86%' });
        const details = screen.getByTestId('seat-hand-rank').parentElement as HTMLElement;
        expect(details.className).toContain('right-full');
        expect(details.className).not.toContain('top-full');
        expect(screen.getByTestId('player-pod')).toHaveStyle({ width: '80px', height: '80px' });
    });

    it('keeps opponent rank labels for screen readers and the expanded panel on tiny tables', async () => {
        const villain = makePlayer();
        const show = showdownFor(villain);
        const renderAt = (s: number) => render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), villain]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={show}
                heroIndex={0}
                getSeatPosition={() => seat('right')}
                isCompactTable
                nowMs={0}
                tableScale={uniform(s)}
            />,
        );

        const roomy = renderAt(0.6);
        expect(screen.getByTestId('seat-hand-rank').className).not.toContain('sr-only');
        roomy.unmount();

        renderAt(0.45);
        const rank = screen.getByTestId('seat-hand-rank');
        expect(rank).toHaveClass('sr-only');
        expect(rank).toHaveTextContent('FLUSH');

        await userEvent.click(screen.getByRole('button', { name: /villain seat details/i }));
        const panel = screen.getByRole('region', { name: /villain expanded details/i });
        expect(within(panel).getByText('Hand')).toBeInTheDocument();
        expect(within(panel).getByText('FLUSH')).toBeInTheDocument();
    });});

describe('CardUI glyph and badge test ids (measurement hooks)', () => {
    it('tags exactly one rank and one suit glyph on a regular face (top-left rank, centred suit)', () => {
        render(<CardUI card="AS" scale={1} />);
        const card = screen.getByRole('img', { name: 'Ace of Spades' });
        const rank = within(card).getAllByTestId('card-rank');
        const suit = within(card).getAllByTestId('card-suit');
        expect(rank).toHaveLength(1);
        expect(suit).toHaveLength(1);
        expect(rank[0]).toHaveTextContent('A');
        expect(rank[0].className).toContain('self-start');
        expect(suit[0]).toHaveTextContent('♠');
    });

    it('tags exactly one rank and one suit glyph on a compact face', () => {
        render(<CardUI card="TH" scale={0.375} compact />);
        const card = screen.getByRole('img', { name: 'Ten of Hearts' });
        expect(within(card).getAllByTestId('card-rank')).toHaveLength(1);
        expect(within(card).getAllByTestId('card-suit')).toHaveLength(1);
        expect(within(card).getByTestId('card-rank')).toHaveTextContent('10');
        expect(within(card).getByTestId('card-suit')).toHaveTextContent('♥');
    });

    it('keeps accessible names and gives a hidden card no glyph ids', () => {
        render(<CardUI card="" hidden />);
        const hidden = screen.getByLabelText('Hidden Card');
        expect(within(hidden).queryByTestId('card-rank')).toBeNull();
        expect(within(hidden).queryByTestId('card-suit')).toBeNull();
    });

    it('tags the OFF badge of a disconnected player so it can be measured', () => {
        render(<PlayerPod player={makePlayer({ status: 'DISCONNECTED' })} scale={1} />);
        expect(screen.getByTestId('seat-offline-badge')).toHaveTextContent('OFF');
    });

    it('renders no OFF badge for a connected player', () => {
        render(<PlayerPod player={makePlayer()} scale={1} />);
        expect(screen.queryByTestId('seat-offline-badge')).toBeNull();
    });
});

describe('CardUI cornerIndex mode (opponent seat cards)', () => {
    const glyphFonts = (card: HTMLElement) =>
        Array.from(card.querySelectorAll<HTMLElement>('[style*="font-size"]')).map((el) => parseFloat(el.style.fontSize));

    it('renders exactly one card-rank and one card-suit per face, in the top-left corner block', () => {
        for (const compact of [false, true]) {
            const { unmount } = render(<CardUI card="AS" scale={compact ? 0.45 : 0.9} compact={compact} cornerIndex />);
            const card = screen.getByRole('img', { name: 'Ace of Spades' });
            expect(within(card).getAllByTestId('card-rank'), `compact ${compact}`).toHaveLength(1);
            expect(within(card).getAllByTestId('card-suit'), `compact ${compact}`).toHaveLength(1);
            const rank = within(card).getByTestId('card-rank');
            const suit = within(card).getByTestId('card-suit');
            expect(rank).toHaveTextContent('A');
            expect(suit).toHaveTextContent('♠');
            // Rank above suit, both in the same corner block.
            expect(rank.parentElement).toBe(suit.parentElement);
            expect(rank.parentElement!.className).toContain('self-start');
            expect(rank.nextElementSibling).toBe(suit);
            unmount();
        }
    });

    it('keeps the aria-label (including a ten) and the card size', () => {
        render(<CardUI card="TH" scale={0.78} cornerIndex />);
        const card = screen.getByRole('img', { name: 'Ten of Hearts' });
        expect(card).toHaveStyle({ width: `${Math.round(0.78 * 48)}px`, height: `${Math.round(0.78 * 64)}px` });
        expect(within(card).getByTestId('card-rank')).toHaveTextContent('10');
    });

    it('keeps every font at 8px or more and the whole face inside the card, for every card width from 18 to 80px', () => {
        for (let cw = 18; cw <= 80; cw++) {
            const scale = cw / 48;
            const compact = isCompactCardScale(scale);
            const { unmount } = render(<CardUI card="TC" scale={scale} compact={compact} cornerIndex />);
            const card = screen.getByRole('img', { name: 'Ten of Clubs' });
            for (const font of glyphFonts(card)) expect(font, `card ${cw}px`).toBeGreaterThanOrEqual(8);

            // The corner block fits the strip the front card leaves uncovered.
            const index = cornerIndexMetrics(scale, compact);
            expect(index.widthPx, `card ${cw}px`).toBeLessThanOrEqual(cardFanStrip(cw, compact));

            // Stacked content (rank + suit, plus centre suit and mirrored index on the regular face) fits the height.
            const height = parseFloat(card.style.height);
            const padding = parseFloat(card.style.padding);
            const stacked = Array.from(card.children)
                .filter((child) => !(child as HTMLElement).className.includes('absolute'))
                .map((child) => {
                    const own = parseFloat((child as HTMLElement).style.fontSize);
                    if (!Number.isNaN(own)) return own;
                    return glyphFonts(child as HTMLElement).reduce((sum, f) => sum + f, 0);
                })
                .reduce((sum, h) => sum + h, 0);
            expect(stacked, `card ${cw}px`).toBeLessThanOrEqual(height - 2 * padding + 1e-9);
            unmount();
        }
    });

    it('leaves the default faces exactly as they were (hero and board cards)', () => {
        render(<CardUI card="KD" scale={1} size="lg" />);
        const card = screen.getByRole('img', { name: 'King of Diamonds' });
        const rank = within(card).getByTestId('card-rank');
        const suit = within(card).getByTestId('card-suit');
        // Plain face: the rank is a direct child (top-left), the suit is the centred direct child.
        expect(rank.parentElement).toBe(card);
        expect(suit.parentElement).toBe(card);
        expect(rank.className).toContain('self-start');
        expect(suit.style.fontSize).toBe(`${Math.round(1.1 * 20)}px`);
    });
});

describe('winner decoration on the avatar', () => {
    it('paints the ring and glow from winnerDecoration(scale) at every table scale, with none of the old fixed-pixel classes', () => {
        for (const scale of [0.3, 0.47, 1, 1.15]) {
            const { unmount } = render(<PlayerPod player={makePlayer()} isWinner scale={scale} />);
            const avatar = screen.getByTestId('player-avatar');
            const decoration = winnerDecoration(scale);
            expect(avatar.style.boxShadow, `scale ${scale}`).toContain(`0 0 ${decoration.glowBlurPx}px`);
            expect(avatar.style.boxShadow, `scale ${scale}`).toContain(`${decoration.ringExtentPx}px`);
            expect(avatar.className).not.toMatch(/ring-gold-secondary|ring-offset-3|shadow-\[0_0_18px/);
            // The crown stays.
            expect(screen.getByTestId('seat-winner-crown')).toBeInTheDocument();
            unmount();
        }
    });

    it('does not decorate non-winners, and keeps the turn ring, the disconnected ring and the folded styling', () => {
        const { rerender } = render(<PlayerPod player={makePlayer()} scale={1} />);
        expect(screen.getByTestId('player-avatar').style.boxShadow).toBe('');
        expect(screen.queryByTestId('seat-winner-crown')).toBeNull();

        rerender(<PlayerPod player={makePlayer()} isCurrent scale={1} />);
        expect(screen.getByTestId('player-avatar').className).toContain('ring-emerald-primary');
        expect(screen.getByTestId('player-avatar').style.boxShadow).toBe('');

        rerender(<PlayerPod player={makePlayer({ status: 'DISCONNECTED' })} scale={1} />);
        expect(screen.getByTestId('player-avatar').className).toContain('ring-amber-400/80');

        rerender(<PlayerPod player={makePlayer({ status: 'FOLDED' })} scale={1} />);
        expect(screen.getByTestId('player-avatar').className).toContain('grayscale');
    });

    it('is much smaller than the old 18px glow on small tables and never zero', () => {
        const { rerender } = render(<PlayerPod player={makePlayer()} isWinner scale={0.47} />);
        const small = screen.getByTestId('player-avatar').style.boxShadow;
        expect(small).toContain('0 0 4px');
        rerender(<PlayerPod player={makePlayer()} isWinner scale={1.15} />);
        expect(screen.getByTestId('player-avatar').style.boxShadow).toContain('0 0 9px');
    });

    it('is picked up by the hero seat (same avatar component)', () => {
        const hero = makePlayer({ id: 'hero', name: 'Hero' });
        render(
            <HeroSeat
                player={hero}
                showdown={{ ...showdownFor(hero), players: [{ ...hero, isWinner: true, holeCards: ['AS', 'KS'] }] }}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(0.66)}
            />,
        );
        expect(screen.getByTestId('player-avatar').style.boxShadow).toContain(`0 0 ${winnerDecoration(0.66).glowBlurPx}px`);
        // Anchor unchanged: pod = avatar box.
        expect(screen.getByTestId('player-pod')).toHaveStyle({ width: `${avatarDiameter('md', 0.66)}px` });
    });
});

describe('PlayerPod external label, short seat label and bounded status', () => {
    const threeKind = { handRank: 'THREE_OF_A_KIND', bestHand: ['9S', '9D', '9C', 'KH', '4S'] };

    it('renders no hand rank in external mode, keeps the pod box = avatar box, and BET takes the first slot', () => {
        const player = makePlayer({ currentBet: 120 });
        const { rerender } = render(<PlayerPod player={player} scale={1} handRank="FLUSH" />);
        const inPod = screen.getByTestId('seat-hand-rank').parentElement as HTMLElement;
        expect(inPod.contains(screen.getByTestId('seat-bet'))).toBe(true);
        // Default mode: rank first, then BET (the rank occupies the first slot).
        expect(inPod.firstElementChild).toBe(screen.getByTestId('seat-hand-rank'));

        rerender(<PlayerPod player={player} scale={1} handRank="FLUSH" handRankPlacement="external" />);
        expect(screen.queryByTestId('seat-hand-rank')).toBeNull();
        const details = screen.getByTestId('seat-bet').closest('.top-full') as HTMLElement;
        expect(details.style.marginTop).toBe('8px');
        expect(details.firstElementChild).toContainElement(screen.getByTestId('seat-bet'));
        expect(screen.getByTestId('player-pod')).toHaveStyle({ width: '80px', height: '80px' });
    });

    it('does not create bottom details for an external rank alone', () => {
        render(<PlayerPod player={makePlayer()} scale={1} handRank="FLUSH" handRankPlacement="external" />);
        expect(screen.queryByTestId('seat-hand-rank')).toBeNull();
        expect(screen.getByTestId('player-pod').querySelector('.top-full')).toBeNull();
    });

    it('shows the short category with the full text as title when a ladder tier is given, and the full text for the hero', () => {
        const { rerender } = render(<PlayerPod player={makePlayer()} scale={1} {...threeKind} handRankTier="standard" />);
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('3 OF A KIND');
        expect(screen.getByTestId('seat-hand-rank')).toHaveAttribute('title', 'Three of a Kind (9s)');

        rerender(<PlayerPod player={makePlayer()} scale={1} {...threeKind} handRankTier="compact" />);
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('TRIPS');
        expect(screen.getByTestId('seat-hand-rank')).toHaveAttribute('title', 'Three of a Kind (9s)');

        rerender(<PlayerPod player={makePlayer()} scale={1} {...threeKind} />);
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('Three of a Kind (9s)');
        expect(screen.getByTestId('seat-hand-rank')).not.toHaveAttribute('title');
    });

    it('uses the tighter 2s x 3s padding on compact labels and keeps the standard padding otherwise', () => {
        const { rerender } = render(<PlayerPod player={makePlayer()} scale={0.8} handRank="FLUSH" compact />);
        expect(screen.getByTestId('seat-hand-rank').style.padding).toBe(`${0.8 * 2}px ${0.8 * 3}px`);
        expect(screen.getByTestId('seat-hand-rank').firstElementChild!.className).toContain('tracking-wider');
        rerender(<PlayerPod player={makePlayer()} scale={0.8} handRank="FLUSH" />);
        expect(screen.getByTestId('seat-hand-rank').style.padding).toBe(`${0.8 * 4}px ${0.8 * 8}px`);
        expect(screen.getByTestId('seat-hand-rank').firstElementChild!.className).toContain('tracking-widest');
    });

    it('bounds the reconnect text to 2.4 avatar radii (at least 6.5em) so it wraps instead of growing', () => {
        for (const scale of [0.4, 0.66, 1, 1.15]) {
            const { unmount } = render(
                <PlayerPod player={makePlayer({ status: 'DISCONNECTED' })} scale={scale} disconnectSecondsRemaining={299} />,
            );
            const status = screen.getByTestId('seat-status');
            const radius = avatarDiameter('md', scale) / 2;
            const font = parseFloat(status.style.fontSize);
            expect(status).toHaveTextContent('Reconnect in 04:59');
            expect(status.style.maxWidth).toBe(`${statusMaxWidthPx(radius, font)}px`);
            expect(status.style.width).toBe('max-content');
            expect(status.className).toContain('whitespace-normal');
            expect(statusMaxWidthPx(radius, font)).toBeGreaterThanOrEqual(2.4 * radius);
            expect(statusMaxWidthPx(radius, font)).toBeGreaterThanOrEqual(6.5 * font);
            unmount();
        }
    });

    it('leaves READY unbounded and the hero rank, bet and status to the left of the avatar', () => {
        render(<PlayerPod player={makePlayer({ isReadyForNextHand: true, currentBet: 5 })} scale={1} handRank="FLUSH" detailsPlacement="left" />);
        expect(screen.getByTestId('seat-status').style.maxWidth).toBe('');
        const details = screen.getByTestId('seat-hand-rank').parentElement as HTMLElement;
        expect(details.className).toContain('right-full');
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('FLUSH');
    });
});

describe('OpponentSeats card fan and label row', () => {
    const revealedFor = (player: Player, extra: Partial<Player> = {}, bestHand?: string[]): GameState => ({
        ...showdownFor(player),
        players: [{ ...player, holeCards: ['AH', 'KH'], handRank: 'FLUSH', bestHand, ...extra }],
    });

    const renderSeat = (
        player: Player,
        scale: number,
        options: { placement?: SeatPosition['cardPlacement']; compact?: boolean; showdown?: GameState | null } = {},
    ) => {
        const { placement = 'right', compact = false } = options;
        const showdown = options.showdown === undefined ? revealedFor(player) : options.showdown;
        return render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), player]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={showdown}
                heroIndex={0}
                getSeatPosition={() => seat(placement)}
                isCompactTable={compact}
                nowMs={0}
                tableScale={uniform(scale)}
            />,
        );
    };

    const metricsFor = (scale: number, compact = false) => {
        const radius = avatarDiameter(compact ? 'sm' : 'md', scale) / 2;
        return getSeatMetrics({
            avatarRadius: radius,
            avatarScale: scale,
            spacingScale: scale,
            cardScale: scale,
            compactFace: isCompactCardScale(scale),
        });
    };

    it('shows a revealed pair as an upright fan: two corner indices, the front card offset by the strip, no rotation', () => {
        renderSeat(makePlayer(), 0.9);
        const stack = screen.getByTestId('seat-cards');
        expect(within(stack).getAllByTestId('card-rank')).toHaveLength(2);
        expect(within(stack).getAllByTestId('card-suit')).toHaveLength(2);
        expect(within(stack).getByLabelText('Ace of Hearts')).toBeInTheDocument();
        expect(within(stack).getByLabelText('King of Hearts')).toBeInTheDocument();

        const m = metricsFor(0.9);
        const wrappers = within(stack).getAllByTestId('card').map((card) => card.parentElement as HTMLElement);
        expect(wrappers[0].style.marginLeft).toBe('0px');
        expect(wrappers[1].style.marginLeft).toBe(`-${m.cardWidth - m.strip}px`);
        for (const wrapper of wrappers) expect(wrapper.style.transform).not.toMatch(/rotate/);
        // Rear card first, front card on top.
        expect(Number(wrappers[1].style.zIndex)).toBeGreaterThan(Number(wrappers[0].style.zIndex));
    });

    it('keeps the face-down stack tilted and dropped, with the very same strip', () => {
        renderSeat(makePlayer(), 0.9, { showdown: null });
        const stack = screen.getByTestId('seat-cards');
        const hidden = within(stack).getAllByLabelText('Hidden Card');
        expect(hidden).toHaveLength(2);
        const wrappers = hidden.map((card) => card.parentElement as HTMLElement);
        expect(wrappers[0].style.transform).toBe('rotate(-6deg)');
        expect(wrappers[1].style.transform).toBe(`rotate(6deg) translateY(${0.9 * 3}px)`);
        const m = metricsFor(0.9);
        expect(wrappers[1].style.marginLeft).toBe(`-${m.cardWidth - m.strip}px`);
    });

    it('lays the compact face out the same way: corner index in the 12px strip', () => {
        renderSeat(makePlayer(), 0.5, { compact: true });
        const stack = screen.getByTestId('seat-cards');
        const m = metricsFor(0.5, true);
        expect(m.strip).toBe(12);
        const cards = within(stack).getAllByRole('img');
        for (const card of cards) expect(card).toHaveAttribute('data-compact', 'true');
        expect(within(stack).getAllByTestId('card-rank')).toHaveLength(2);
        expect((cards[1].parentElement as HTMLElement).style.marginLeft).toBe(`-${m.cardWidth - 12}px`);
    });

    it('highlights best-hand cards and dims the others with the new opacity', () => {
        const winner = makePlayer();
        renderSeat(winner, 0.9, { showdown: revealedFor(winner, { isWinner: true }, ['AH', 'QD', 'JD', 'TC', '9C']) });
        const best = screen.getByLabelText('Ace of Hearts');
        const other = screen.getByLabelText('King of Hearts');
        expect(best.className).toContain('ring-gold-secondary');
        expect(best.className).not.toMatch(/opacity-\d+/);
        expect(other.className).toContain('opacity-55');
        expect(other.className).toContain('grayscale-[50%]');
        expect(other.className).not.toContain('opacity-40');
    });

    it('renders no cards for folded and inactive seats', () => {
        for (const status of ['FOLDED', 'OUT'] as const) {
            const { unmount } = renderSeat(makePlayer({ status }), 0.9);
            expect(screen.queryByTestId('seat-cards')).toBeNull();
            expect(screen.queryAllByTestId('card')).toHaveLength(0);
            unmount();
        }
    });

    it('mirrors the stack for cards on the left and keeps the unrotated stack offset', () => {
        renderSeat(makePlayer(), 0.9, { placement: 'left' });
        const m = metricsFor(0.9);
        expect(screen.getByTestId('seat-cards').style.transform).toBe(`translate(calc(-100% - ${m.xOffset}px), -50%)`);
    });

    it('puts the hand rank in a row under the cards: left / width / top from the shared metrics, one label per seat', () => {
        renderSeat(makePlayer(), 1);
        const m = metricsFor(1);
        expect(screen.getAllByTestId('seat-hand-rank')).toHaveLength(1);
        const label = screen.getByTestId('seat-hand-rank');
        expect(label).toHaveTextContent('FLUSH');
        // The pod has no label: it lives in the row, a sibling of the card stack.
        expect(within(screen.getByTestId('player-pod')).queryByTestId('seat-hand-rank')).toBeNull();
        const row = label.parentElement!.parentElement as HTMLElement;
        expect(row.style.top).toBe(`${m.labelRowTop}px`);
        expect(row.style.width).toBe(`${m.labelRowWidth}px`);
        expect(row.style.left).toContain(`${m.labelRowStart}px`);
        expect(row.parentElement).toBe(screen.getByTestId('seat-cards').parentElement);
        expect((label.parentElement as HTMLElement).style.marginInline).toBe('auto');
    });

    it('mirrors the label row for cards on the left', () => {
        renderSeat(makePlayer(), 1, { placement: 'left' });
        const m = metricsFor(1);
        const row = screen.getByTestId('seat-hand-rank').parentElement!.parentElement as HTMLElement;
        expect(row.style.right).toContain(`${m.labelRowStart}px`);
        expect(row.style.left).toBe('');
        expect(row.style.flexDirection).toBe('row-reverse');
        expect(row.style.width).toBe(`${m.labelRowWidth}px`);
    });

    it('keeps the label with the avatar for cards-below seats and shortens it, with the full text as title', () => {
        const villain = makePlayer();
        const show: GameState = {
            ...showdownFor(villain),
            players: [{ ...villain, holeCards: ['9S', '9D'], handRank: 'THREE_OF_A_KIND', bestHand: ['9S', '9D', '9C', 'KH', '4S'] }],
        };
        render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), villain]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={show}
                heroIndex={0}
                getSeatPosition={() => seat('below')}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(1)}
            />,
        );
        const label = screen.getByTestId('seat-hand-rank');
        expect(label).toHaveTextContent('3 OF A KIND');
        expect(label).toHaveAttribute('title', 'Three of a Kind (9s)');
        expect(label.parentElement!.className).toContain('top-full');
    });

    it('lists the full hand in the expanded panel whenever there is one, and keeps the label sr-only on tiny tables', async () => {
        const user = userEvent.setup();
        const villain = makePlayer();
        const show: GameState = {
            ...showdownFor(villain),
            players: [{ ...villain, holeCards: ['QS', 'QD'], handRank: 'TWO_PAIR', bestHand: ['QS', 'QD', 'JC', 'JH', '3S'] }],
        };
        const { unmount } = render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), villain]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={show}
                heroIndex={0}
                getSeatPosition={() => seat('right')}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(1)}
            />,
        );
        expect(screen.getByTestId('seat-hand-rank')).not.toHaveClass('sr-only');
        expect(screen.getByTestId('seat-hand-rank')).toHaveTextContent('TWO PAIR');
        await user.click(screen.getByRole('button', { name: /villain seat details/i }));
        const panel = screen.getByRole('region', { name: /villain expanded details/i });
        expect(within(panel).getByText('Hand')).toBeInTheDocument();
        expect(within(panel).getByText('Two Pair (Queens & Jacks)')).toBeInTheDocument();
        unmount();

        render(
            <OpponentSeats
                orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), villain]}
                currentPlayerId={undefined}
                myPlayerId="hero"
                showdown={show}
                heroIndex={0}
                getSeatPosition={() => seat('right')}
                isCompactTable
                nowMs={0}
                tableScale={uniform(0.45)}
            />,
        );
        expect(screen.getAllByTestId('seat-hand-rank')).toHaveLength(1);
        expect(screen.getByTestId('seat-hand-rank')).toHaveClass('sr-only');
    });
});
