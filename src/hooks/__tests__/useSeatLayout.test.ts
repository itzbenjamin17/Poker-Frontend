import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSeatLayout } from '../useSeatLayout';
import { getTableDimensions } from '../../lib/tableGeometry';

const STANDARD = { width: 900, height: 419 }; // 720 <= width < 1100
const COMPACT = { width: 600, height: 279 };
const WIDE = { width: 1200, height: 558 };

describe('useSeatLayout', () => {
    it('derives the tier from the TABLE width (720 / 1100)', () => {
        const compact = renderHook(() => useSeatLayout(COMPACT, 6)).result.current;
        expect(compact.tableTier).toBe('compact');
        expect(compact.isCompactTable).toBe(true);
        expect(compact.isWideTable).toBe(false);

        const standard = renderHook(() => useSeatLayout(STANDARD, 6)).result.current;
        expect(standard.tableTier).toBe('standard');
        expect(standard.isCompactTable).toBe(false);
        expect(standard.isWideTable).toBe(false);

        const wide = renderHook(() => useSeatLayout(WIDE, 6)).result.current;
        expect(wide.tableTier).toBe('wide');
        expect(wide.isWideTable).toBe(true);
    });

    it('exposes a structured tableScale and a matching scalar scale', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 6));
        expect(result.current.scale).toBe(result.current.tableScale.overall);
        expect(result.current.tableScale.overall).toBeCloseTo(419 / 430, 5);
        expect(result.current.tableDimensions).toBe(STANDARD);
    });

    it('does not read the window (R1)', () => {
        const innerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        const innerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        Object.defineProperty(window, 'innerWidth', { configurable: true, get() { throw new Error('window.innerWidth read'); } });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get() { throw new Error('window.innerHeight read'); } });
        try {
            expect(() => {
                const { result } = renderHook(() => useSeatLayout(STANDARD, 6));
                result.current.getSeatPosition(1, 6, 0);
            }).not.toThrow();
        } finally {
            if (innerWidth) Object.defineProperty(window, 'innerWidth', innerWidth);
            if (innerHeight) Object.defineProperty(window, 'innerHeight', innerHeight);
        }
    });

    it('keeps getSeatPosition identity stable for equal inputs and changes it with table size, count or tier', () => {
        const { result, rerender } = renderHook(
            ({ dims, count }) => useSeatLayout(dims, count),
            { initialProps: { dims: { width: 900, height: 419 }, count: 6 } },
        );
        const first = result.current.getSeatPosition;
        // New object, same values: same identity.
        rerender({ dims: { width: 900, height: 419 }, count: 6 });
        expect(result.current.getSeatPosition).toBe(first);
        // Different table size (same tier).
        rerender({ dims: { width: 950, height: 440 }, count: 6 });
        expect(result.current.getSeatPosition).not.toBe(first);
        const resized = result.current.getSeatPosition;
        // Different player count.
        rerender({ dims: { width: 950, height: 440 }, count: 7 });
        expect(result.current.getSeatPosition).not.toBe(resized);
        const counted = result.current.getSeatPosition;
        // Different tier.
        rerender({ dims: COMPACT, count: 7 });
        expect(result.current.getSeatPosition).not.toBe(counted);
    });
    it('pins the hero to bottom-centre (50, 86) whatever the heroIndex', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 6));
        for (const heroIndex of [0, 1, 5]) {
            const pos = result.current.getSeatPosition(heroIndex, 6, heroIndex);
            expect(pos.left).toBe(50);
            expect(pos.top).toBe(86);
            expect(pos.cardPlacement).toBe('right');
            expect(pos.panelPlacement).toBe('centre');
            expect(pos.verticalZone).toBe('bottom');
        }
    });

    it('seats the single opponent of a heads-up game at the top of the fitted ellipse', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 2));
        const ellipse = result.current.getSeatEllipse(2, 0);
        const pos = result.current.getSeatPosition(1, 2, 0);
        expect(pos.left).toBe(50);
        expect(pos.top).toBeCloseTo(ellipse.cy - ellipse.ry, 1);
        expect(pos.verticalZone).toBe('top');
        // Hero not first: opponent is index 0
        expect(result.current.getSeatPosition(0, 2, 1)).toMatchObject({ left: 50, top: pos.top });
    });
    it('places 3..10 players on the fitted ellipse (no per-count maps, nothing skipped, the clamp never engages)', () => {
        for (const dims of [COMPACT, STANDARD, WIDE]) {
            const { result } = renderHook(() => useSeatLayout(dims, 6));
            for (let total = 3; total <= 10; total++) {
                const { cx, cy, rx, ry } = result.current.getSeatEllipse(total, 0);
                expect(cx).toBe(50);
                expect(rx).toBeGreaterThan(20);
                expect(ry).toBeGreaterThan(20);
                for (let i = 1; i < total; i++) {
                    const pos = result.current.getSeatPosition(i, total, 0);
                    // ((x-50)/rx)^2 + ((y-cy)/ry)^2 == 1 within the 0.1 rounding, for every seat
                    const value = ((pos.left - cx) / rx) ** 2 + ((pos.top - cy) / ry) ** 2;
                    expect(Math.abs(value - 1), `${dims.width}x${dims.height} total ${total} seat ${i}`).toBeLessThan(0.01);
                }
            }
        }
    });
    it('uses a 180..240 degree span over the top that grows with the opponent count', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 4));
        // 3 players -> 2 opponents, span 180: left and right ends on the horizontal diameter of the fitted ellipse
        const { cx, cy, rx } = result.current.getSeatEllipse(3, 0);
        const first = result.current.getSeatPosition(1, 3, 0);
        const last = result.current.getSeatPosition(2, 3, 0);
        expect(first.left).toBeCloseTo(cx - rx, 1);
        expect(first.top).toBeCloseTo(cy, 1);
        expect(last.left).toBeCloseTo(cx + rx, 1);
        expect(last.top).toBeCloseTo(cy, 1);
        // 10 players -> 9 opponents, span 240: end seats dip below the diameter
        const wide = result.current.getSeatPosition(1, 10, 0);
        expect(wide.top).toBeGreaterThan(result.current.getSeatEllipse(10, 0).cy);
    });
    it('orders opponents clockwise starting right after the hero, for heroIndex 0, 1 and last', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 4));
        const total = 4;
        for (const heroIndex of [0, 1, total - 1]) {
            const seats = Array.from({ length: total }, (_, offset) => {
                const playerIndex = (heroIndex + 1 + offset) % total;
                return result.current.getSeatPosition(playerIndex, total, heroIndex);
            }).slice(0, total - 1);

            // Clockwise from the hero: left side first, then over the top, then right side
            expect(seats[0].left).toBeLessThan(seats[1].left);
            expect(seats[1].left).toBeLessThan(seats[2].left);
            expect(seats[0].side).toBe('left');
            expect(seats[2].side).toBe('right');
        }
    });

    it('never gives two players the same seat for any heroIndex', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 6));
        for (let total = 2; total <= 10; total++) {
            for (let heroIndex = 0; heroIndex < total; heroIndex++) {
                const keys = new Set<string>();
                for (let i = 0; i < total; i++) {
                    const p = result.current.getSeatPosition(i, total, heroIndex);
                    keys.add(`${p.left}/${p.top}`);
                }
                expect(keys.size).toBe(total);
            }
        }
    });

    it('describes panel placement, side and vertical zone from the geometry', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 7));
        const left = result.current.getSeatPosition(1, 7, 0);
        const right = result.current.getSeatPosition(6, 7, 0);
        expect(left.panelPlacement).toBe('left');
        expect(left.side).toBe('left');
        expect(left.cardPlacement).toBe('right');
        expect(right.panelPlacement).toBe('right');
        expect(right.side).toBe('right');
        expect(right.cardPlacement).toBe('left');
        // 7 players -> 6 opponents; the 3rd/4th sit near the top centre
        const top = result.current.getSeatPosition(3, 7, 0);
        expect(top.verticalZone).toBe('top');
        expect(top.panelPlacement).toBe('centre');
    });

    it('keeps every seat inside the sanity bound (left 2..98, top 2..80) and the bound never engages', () => {
        for (const dims of [COMPACT, STANDARD, WIDE]) {
            for (let total = 2; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(dims, total));
                for (let i = 1; i < total; i++) {
                    const pos = result.current.getSeatPosition(i, total, 0);
                    expect(pos.left).toBeGreaterThanOrEqual(2);
                    expect(pos.left).toBeLessThanOrEqual(98);
                    expect(pos.top).toBeGreaterThanOrEqual(2);
                    expect(pos.top).toBeLessThanOrEqual(80);
                    // Not clamped: strictly inside the bound, so the position is the ellipse point itself.
                    expect(pos.left).toBeGreaterThan(2);
                    expect(pos.left).toBeLessThan(98);
                    expect(pos.top).toBeGreaterThan(2);
                    expect(pos.top).toBeLessThan(80);
                }
            }
        }
    });
    it('works with the dimensions produced by getTableDimensions', () => {
        const dims = getTableDimensions(844, 310);
        const { result } = renderHook(() => useSeatLayout(dims, 6));
        expect(result.current.tableTier).toBe('compact');
        expect(result.current.scale).toBeGreaterThanOrEqual(0.4);
    });

    it('spaces seats by weighted arc length, so side seats are not squeezed by an equal angle step', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 10));
        // 10 players -> 9 opponents. Vertical pitch between the two lowest left-side seats
        // must be larger than with plain equal angles (ry * (sin 180 - sin 150) = 0.5 * ry of the fitted ellipse).
        const a = result.current.getSeatPosition(1, 10, 0);
        const b = result.current.getSeatPosition(2, 10, 0);
        expect(Math.abs(a.top - b.top)).toBeGreaterThan(0.5 * result.current.getSeatEllipse(10, 0).ry * 1.05);
        // Still strictly clockwise over the top.
        const lefts = Array.from({ length: 9 }, (_, k) => result.current.getSeatPosition(k + 1, 10, 0).left);
        expect(lefts[0]).toBeLessThan(lefts[4]);
        expect(lefts[4]).toBeLessThan(lefts[8]);
    });

    it('puts the cards of top-centre seats below the avatar on crowded tables only', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 10));
        // 10 players -> 9 opponents: the 5th (index 4) is the top-centre seat.
        expect(result.current.getSeatPosition(5, 10, 0)).toMatchObject({ left: 50, cardPlacement: 'below' });
        expect(result.current.getSeatPosition(1, 10, 0).cardPlacement).toBe('right');
        expect(result.current.getSeatPosition(9, 10, 0).cardPlacement).toBe('left');
        // 4 players -> 3 opponents: top-centre seat keeps the inward default.
        expect(result.current.getSeatPosition(2, 4, 0).cardPlacement).not.toBe('below');
    });

    it('puts the hand-rank label under the cards only for side seats whose cards sit beside the avatar', () => {
        const { result } = renderHook(() => useSeatLayout(STANDARD, 7));
        // 7 players -> 6 opponents: the outer seats are left / right side seats with cards beside the avatar.
        expect(result.current.getSeatPosition(1, 7, 0)).toMatchObject({ side: 'left', cardPlacement: 'right', labelPlacement: 'cards' });
        expect(result.current.getSeatPosition(6, 7, 0)).toMatchObject({ side: 'right', cardPlacement: 'left', labelPlacement: 'cards' });
        // Top-centre seats of a crowded table have their cards below the avatar: the label stays with the avatar.
        const crowded = renderHook(() => useSeatLayout(STANDARD, 10)).result.current;
        expect(crowded.getSeatPosition(5, 10, 0)).toMatchObject({ cardPlacement: 'below', labelPlacement: 'avatar' });
        // A centre seat with cards beside the avatar: no lopsided label under off-centre cards.
        const small = renderHook(() => useSeatLayout(STANDARD, 4)).result.current;
        expect(small.getSeatPosition(2, 4, 0)).toMatchObject({ side: 'centre', cardPlacement: 'right', labelPlacement: 'avatar' });
        // Heads-up opponent and the hero.
        const headsUp = renderHook(() => useSeatLayout(STANDARD, 2)).result.current;
        expect(headsUp.getSeatPosition(1, 2, 0).labelPlacement).toBe('avatar');
        for (const heroIndex of [0, 1, 5]) {
            expect(result.current.getSeatPosition(heroIndex, 6, heroIndex).labelPlacement).toBe('avatar');
        }
    });

    it('derives labelPlacement from cardPlacement and side for every seat of every table size', () => {
        for (const dims of [COMPACT, STANDARD, WIDE]) {
            for (let total = 2; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(dims, total));
                for (let i = 1; i < total; i++) {
                    const seat = result.current.getSeatPosition(i, total, 0);
                    const beside = seat.cardPlacement === 'left' || seat.cardPlacement === 'right';
                    expect(seat.labelPlacement, `${dims.width}x${dims.height} total ${total} seat ${i}`)
                        .toBe(beside && seat.side !== 'centre' ? 'cards' : 'avatar');
                }
            }
        }
    });
});
