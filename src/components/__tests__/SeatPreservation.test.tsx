import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import { OpponentSeats } from '../OpponentSeats';
import { HeroSeat } from '../HeroSeat';
import { avatarDiameter } from '../../lib/tableGeometry';
import type { TableScale } from '../../lib/tableGeometry';
import { mulberry32, randomBetween, randomInt } from '../../test/prng';
import type { GameState, Player, PlayerStatus, SeatPosition } from '../../types';

/**
 * Property 2 (preservation). Interface behaviour of the seats that the containment fix must keep: test ids and
 * roles, accessible names, the expandable panel, folded / inactive seats without cards, the winner presentation
 * (crown, gold decoration, best-hand highlight, dimming) and the hero seat. Sizes, opacity values, label text and
 * coordinates are deliberately not asserted because the fix changes them on purpose. Failing cases print their seed.
 */

afterEach(cleanup);

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

// The seat description is built with a cast so the same helper works before and after SeatPosition gains new fields.
const seatAt = (cardPlacement: SeatPosition['cardPlacement']): SeatPosition => ({
    left: 30,
    top: 30,
    cardPlacement,
    panelPlacement: 'left',
    side: 'left',
    verticalZone: 'middle',
    labelPlacement: cardPlacement === 'below' ? 'avatar' : 'cards',
} as SeatPosition);

const STATUSES: PlayerStatus[] = ['ACTIVE', 'ALL_IN', 'DISCONNECTED', 'FOLDED', 'OUT'];
const CARD_STATUSES: PlayerStatus[] = ['ACTIVE', 'ALL_IN', 'DISCONNECTED'];
const HAND_RANKS = ['FLUSH', 'NO_HAND', undefined] as const;
const BEST_HAND = ['AH', 'QD', 'JD', 'TC', '9C'];

interface SeatSpec {
    status: PlayerStatus;
    bet: number;
    bigBlind: boolean;
    smallBlind: boolean;
    ready: boolean;
    winner: boolean;
    reveal: boolean;
    handRank: (typeof HAND_RANKS)[number];
    placement: SeatPosition['cardPlacement'];
    compact: boolean;
    scale: number;
}

function randomSpec(random: () => number): SeatSpec {
    return {
        status: STATUSES[randomInt(random, 0, STATUSES.length - 1)],
        bet: random() < 0.5 ? randomInt(random, 1, 9000) : 0,
        bigBlind: random() < 0.3,
        smallBlind: random() < 0.3,
        ready: random() < 0.4,
        winner: random() < 0.4,
        reveal: random() < 0.6,
        handRank: HAND_RANKS[randomInt(random, 0, HAND_RANKS.length - 1)],
        placement: (['right', 'left', 'below'] as const)[randomInt(random, 0, 2)],
        compact: random() < 0.4,
        scale: randomBetween(random, 0.45, 1.15),
    };
}

function renderSeat(spec: SeatSpec) {
    const villain = makePlayer({
        status: spec.status,
        currentBet: spec.bet,
        isBigBlind: spec.bigBlind,
        isSmallBlind: spec.smallBlind,
        isReadyForNextHand: spec.ready,
        ...(spec.status === 'DISCONNECTED' ? { disconnectDeadlineEpochMs: 300_000 } : {}),
    });
    const inShowdown = spec.reveal || spec.winner || spec.handRank !== undefined;
    const showdown: GameState | null = inShowdown
        ? {
            gameId: 'g',
            phase: 'SHOWDOWN',
            pot: 0,
            communityCards: [],
            currentPlayerId: undefined,
            currentPlayerName: '',
            currentBet: 0,
            maxPlayers: 6,
            players: [{
                ...villain,
                holeCards: spec.reveal ? ['AH', 'KH'] : undefined,
                handRank: spec.handRank,
                bestHand: spec.winner ? BEST_HAND : undefined,
                isWinner: spec.winner,
            }],
        } as unknown as GameState
        : null;
    render(
        <OpponentSeats
            orderedPlayers={[makePlayer({ id: 'hero', name: 'Hero' }), villain]}
            currentPlayerId={undefined}
            myPlayerId="hero"
            showdown={showdown}
            heroIndex={0}
            getSeatPosition={() => seatAt(spec.placement)}
            isCompactTable={spec.compact}
            nowMs={0}
            tableScale={uniform(spec.scale)}
        />,
    );
    return { villain, showdown };
}

const hasGoldDecoration = (avatar: HTMLElement) =>
    // Gold ring class, or the gold glow (Tailwind arbitrary shadow class, which survives a disconnected seat's amber ring), or an inline gold box-shadow.
    /ring-gold-secondary|252,211,77/.test(avatar.className) || /252,\s*211,\s*77|gold/i.test(avatar.style.boxShadow);

describe('opponent seat preservation', () => {
    it('keeps test ids, roles and accessible names for random opponent states', () => {
        const seed = 20260811;
        const random = mulberry32(seed);
        for (let iteration = 0; iteration < 70; iteration++) {
            const spec = randomSpec(random);
            const label = `seed ${seed}, iteration ${iteration}: ${JSON.stringify(spec)}`;
            renderSeat(spec);

            // Seat root, trigger button, pod, avatar, chip badge.
            expect(screen.getByRole('group', { name: 'Villain seat' }), label).toBe(screen.getByTestId('opponent-seat-p-2'));
            expect(screen.getByRole('button', { name: 'Villain seat details' }), label).toBeInTheDocument();
            expect(screen.getAllByTestId('player-pod'), label).toHaveLength(1);
            expect(screen.getAllByTestId('player-avatar'), label).toHaveLength(1);
            expect(screen.getAllByTestId('seat-chip-badge'), label).toHaveLength(1);

            // Blind badge, crown, bet, status.
            const blind = screen.queryAllByTestId('seat-blind-badge');
            expect(blind, label).toHaveLength(spec.bigBlind || spec.smallBlind ? 1 : 0);
            if (blind.length) expect(blind[0], label).toHaveTextContent(spec.bigBlind ? 'BB' : 'SB');
            expect(screen.queryAllByTestId('seat-winner-crown'), label).toHaveLength(spec.winner ? 1 : 0);
            expect(screen.queryAllByTestId('seat-bet'), label).toHaveLength(spec.bet > 0 ? 1 : 0);
            expect(screen.queryAllByTestId('seat-status'), label).toHaveLength(
                (spec.status === 'DISCONNECTED' ? 1 : 0) + (spec.ready ? 1 : 0),
            );

            // Exactly one hand-rank label whenever there is a displayable hand rank (it may be screen-reader only).
            const showRank = spec.handRank === 'FLUSH';
            expect(screen.queryAllByTestId('seat-hand-rank'), label).toHaveLength(showRank ? 1 : 0);

            // Cards: only for seats that are still in the hand.
            const canRenderCards = CARD_STATUSES.includes(spec.status);
            expect(screen.queryAllByTestId('seat-cards'), label).toHaveLength(canRenderCards ? 1 : 0);
            if (canRenderCards) {
                const stack = screen.getByTestId('seat-cards');
                const cards = within(stack).getAllByTestId('card');
                expect(cards, label).toHaveLength(2);
                if (spec.reveal) {
                    expect(within(stack).getByLabelText('Ace of Hearts'), label).toBeInTheDocument();
                    expect(within(stack).getByLabelText('King of Hearts'), label).toBeInTheDocument();
                    expect(within(stack).queryAllByLabelText('Hidden Card'), label).toHaveLength(0);
                } else {
                    expect(within(stack).getAllByLabelText('Hidden Card'), label).toHaveLength(2);
                }
            } else {
                // Folded and inactive opponents show no cards at all.
                expect(screen.queryAllByLabelText('Hidden Card'), label).toHaveLength(0);
                expect(screen.queryAllByTestId('card'), label).toHaveLength(0);
            }
            cleanup();
        }
    });

    it('toggles the expanded details region when the seat button is clicked', async () => {
        const seed = 424344;
        const random = mulberry32(seed);
        const user = userEvent.setup();
        for (let iteration = 0; iteration < 12; iteration++) {
            const spec = randomSpec(random);
            const label = `seed ${seed}, iteration ${iteration}: ${JSON.stringify(spec)}`;
            renderSeat(spec);
            const button = screen.getByRole('button', { name: 'Villain seat details' });
            expect(button, label).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('region', { name: 'Villain expanded details' }), label).toBeNull();

            await user.click(button);
            expect(button, label).toHaveAttribute('aria-expanded', 'true');
            const region = screen.getByRole('region', { name: 'Villain expanded details' });
            expect(within(region).getByText('Stack'), label).toBeInTheDocument();
            expect(within(region).getByText('Status'), label).toBeInTheDocument();

            await user.click(button);
            expect(button, label).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('region', { name: 'Villain expanded details' }), label).toBeNull();
            cleanup();
        }
    });

    it('shows the winner crown and a gold decoration, highlights best-hand cards and dims the others', () => {
        const seed = 112233;
        const random = mulberry32(seed);
        let checked = 0;
        for (let iteration = 0; iteration < 40; iteration++) {
            const spec: SeatSpec = {
                ...randomSpec(random),
                status: CARD_STATUSES[randomInt(random, 0, CARD_STATUSES.length - 1)],
                winner: true,
                reveal: true,
            };
            const label = `seed ${seed}, iteration ${iteration}: ${JSON.stringify(spec)}`;
            renderSeat(spec);

            expect(screen.getByTestId('seat-winner-crown'), label).toBeInTheDocument();
            expect(hasGoldDecoration(screen.getByTestId('player-avatar')), label).toBe(true);
            expect(screen.getByText('Winner'), label).toHaveClass('sr-only');

            // 'AH' is part of the best hand: highlighted, not dimmed. 'KH' is not: dimmed, not highlighted.
            const best = screen.getByLabelText('Ace of Hearts');
            const other = screen.getByLabelText('King of Hearts');
            expect(best.className, label).toMatch(/ring-gold-secondary/);
            expect(best.className, label).not.toMatch(/\bopacity-\d+\b/);
            expect(best.className, label).not.toMatch(/grayscale/);
            expect(other.className, label).not.toMatch(/ring-gold-secondary/);
            expect(other.className, label).toMatch(/\bopacity-\d+\b/);
            expect(other.className, label).toMatch(/grayscale/);
            checked++;
            cleanup();
        }
        expect(checked).toBe(40);
    });

    it('presents a non-winner without crown, gold decoration, highlight or dimming', () => {
        const seed = 556677;
        const random = mulberry32(seed);
        for (let iteration = 0; iteration < 30; iteration++) {
            const spec: SeatSpec = {
                ...randomSpec(random),
                status: CARD_STATUSES[randomInt(random, 0, CARD_STATUSES.length - 1)],
                winner: false,
                reveal: true,
            };
            const label = `seed ${seed}, iteration ${iteration}: ${JSON.stringify(spec)}`;
            renderSeat(spec);
            expect(screen.queryByTestId('seat-winner-crown'), label).toBeNull();
            expect(hasGoldDecoration(screen.getByTestId('player-avatar')), label).toBe(false);
            for (const name of ['Ace of Hearts', 'King of Hearts']) {
                const card = screen.getByLabelText(name);
                expect(card.className, label).not.toMatch(/ring-gold-secondary/);
                expect(card.className, label).not.toMatch(/\bopacity-\d+\b/);
                expect(card.className, label).not.toMatch(/grayscale/);
            }
            cleanup();
        }
    });
});

describe('hero seat preservation', () => {
    const renderHero = (scale: number, extra: Partial<Player> = {}, handRank?: string) => {
        const hero = makePlayer({ id: 'hero', name: 'Hero', currentBet: 50, isReadyForNextHand: true, ...extra });
        const showdown = handRank
            ? ({
                gameId: 'g',
                phase: 'SHOWDOWN',
                pot: 0,
                communityCards: [],
                currentPlayerId: undefined,
                currentPlayerName: '',
                currentBet: 0,
                maxPlayers: 6,
                players: [{ ...hero, holeCards: ['AS', 'KS'], handRank }],
            } as unknown as GameState)
            : null;
        return render(
            <HeroSeat
                player={hero}
                showdown={showdown}
                privateCards={['AS', 'KS']}
                isCompactTable={false}
                nowMs={0}
                tableScale={uniform(scale)}
            />,
        );
    };

    it('stays pinned at 50% / 86% and keeps hero cards at the heroCard x lg pixel size', () => {
        const seed = 8080;
        const random = mulberry32(seed);
        for (let iteration = 0; iteration < 40; iteration++) {
            const scale = randomBetween(random, 0.3, 1.15);
            const label = `seed ${seed}, iteration ${iteration}, scale ${scale}`;
            renderHero(scale);
            expect(screen.getByTestId('hero-seat'), label).toHaveStyle({ left: '50%', top: '86%' });
            const cards = within(screen.getByTestId('hero-cards')).getAllByRole('img');
            expect(cards, label).toHaveLength(2);
            for (const card of cards) {
                expect(card.style.width, label).toBe(`${Math.round(scale * 1.1 * 48)}px`);
                expect(card.style.height, label).toBe(`${Math.round(scale * 1.1 * 64)}px`);
            }
            const radius = avatarDiameter('md', scale) / 2;
            const heroCards = screen.getByTestId('hero-cards');
            expect(heroCards.style.top, label).toBe(`${radius}px`);
            expect(heroCards.style.transform, label).toBe(`translate(${radius + scale * 16 + 4}px, -50%)`);
            expect(screen.getByTestId('player-pod'), label).toHaveStyle({ width: `${2 * radius}px`, height: `${2 * radius}px` });
            cleanup();
        }
    });

    it('keeps the hero rank, bet and status to the left of the avatar', () => {
        for (const scale of [0.47, 0.66, 1, 1.15]) {
            renderHero(scale, {}, 'FLUSH');
            for (const id of ['seat-hand-rank', 'seat-bet', 'seat-status']) {
                const el = screen.getByTestId(id);
                expect(el.closest('.right-full'), `${id} at scale ${scale}`).not.toBeNull();
                expect(el.closest('.top-full'), `${id} at scale ${scale}`).toBeNull();
            }
            cleanup();
        }
    });
});
