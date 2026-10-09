import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSeatLayout } from '../useSeatLayout';
import { BASE_TABLE_HEIGHT, TABLE_ASPECT } from '../../lib/tableGeometry';
import { mulberry32, randomBetween, randomInt } from '../../test/prng';
import type { SeatPosition } from '../../types';

/**
 * Property 2 (preservation). These assert invariants of the seat layout that the containment fix must keep:
 * hero pinning, numbering, uniqueness, symmetry, one continuous ellipse, tier / scale derivation and the
 * card placement rule. They deliberately do NOT assert coordinates, radii or density values, which the fix
 * changes on purpose. Failing cases print their seed.
 */

const COMPACT = { width: 600, height: 279 };
const STANDARD = { width: 900, height: 419 };
const WIDE = { width: 1200, height: 558 };
const TIER_TABLES = [COMPACT, STANDARD, WIDE];

const seatsOf = (
    getSeatPosition: (i: number, total: number, heroIndex: number) => SeatPosition,
    total: number,
    heroIndex: number,
) => Array.from({ length: total }, (_, i) => getSeatPosition(i, total, heroIndex));

/** Opponents in clockwise order starting right after the hero (or from player 0 when there is no hero). */
const opponentsClockwise = (
    getSeatPosition: (i: number, total: number, heroIndex: number) => SeatPosition,
    total: number,
    heroIndex: number,
) => {
    const hasHero = heroIndex >= 0 && heroIndex < total;
    const count = hasHero ? total - 1 : total;
    return Array.from({ length: count }, (_, k) => {
        const playerIndex = hasHero ? (heroIndex + 1 + k) % total : k;
        return getSeatPosition(playerIndex, total, heroIndex);
    });
};

const SIDE_RANK = { left: 0, centre: 1, right: 2 } as const;

describe('seat layout preservation: hero', () => {
    it('pins the hero at left 50 / top 86 with cardPlacement right, panel centre, zone bottom (2-10 players, any hero index)', () => {
        for (const dims of TIER_TABLES) {
            const { result } = renderHook(() => useSeatLayout(dims, 6));
            for (let total = 2; total <= 10; total++) {
                for (const heroIndex of new Set([0, Math.floor(total / 2), total - 1])) {
                    const hero = result.current.getSeatPosition(heroIndex, total, heroIndex);
                    expect(hero, `total ${total}, heroIndex ${heroIndex}`).toMatchObject({
                        left: 50,
                        top: 86,
                        cardPlacement: 'right',
                        panelPlacement: 'centre',
                        verticalZone: 'bottom',
                    });
                }
            }
        }
    });

    it('places every player as an opponent, on unique seats, when there is no hero (index -1 or out of range)', () => {
        for (const dims of TIER_TABLES) {
            const { result } = renderHook(() => useSeatLayout(dims, 6));
            for (let total = 2; total <= 10; total++) {
                for (const heroIndex of [-1, total, total + 5]) {
                    const seats = seatsOf(result.current.getSeatPosition, total, heroIndex);
                    const keys = new Set(seats.map((s) => `${s.left}/${s.top}`));
                    expect(keys.size, `total ${total}, heroIndex ${heroIndex}`).toBe(total);
                    for (const s of seats) {
                        expect(Number.isFinite(s.left) && Number.isFinite(s.top)).toBe(true);
                    }
                }
            }
        }
    });
});

describe('seat layout preservation: numbering, uniqueness, symmetry', () => {
    it('numbers opponents clockwise after the hero (left, then top, then right) with unique mirrored seats', () => {
        const seed = 1357911;
        const random = mulberry32(seed);
        for (let iteration = 0; iteration < 120; iteration++) {
            const dims = TIER_TABLES[randomInt(random, 0, TIER_TABLES.length - 1)];
            const total = randomInt(random, 3, 10);
            const heroIndex = randomInt(random, 0, total - 1);
            const label = `seed ${seed}, iteration ${iteration}: ${dims.width}x${dims.height}, total ${total}, hero ${heroIndex}`;
            const { result } = renderHook(() => useSeatLayout(dims, total));
            const opponents = opponentsClockwise(result.current.getSeatPosition, total, heroIndex);
            const n = opponents.length;

            // Seats are unique.
            expect(new Set(opponents.map((s) => `${s.left}/${s.top}`)).size, label).toBe(n);

            // Left-side seats come before top-centre seats, which come before right-side seats.
            for (let k = 1; k < n; k++) {
                expect(SIDE_RANK[opponents[k].side], label).toBeGreaterThanOrEqual(SIDE_RANK[opponents[k - 1].side]);
            }
            expect(opponents[0].left, label).toBeLessThan(opponents[n - 1].left);

            // Clockwise on screen (y down): the cross product of consecutive offsets from the table centre is positive.
            if (n >= 3) {
                const cx = 50;
                const cy = 47;
                for (let k = 1; k < n; k++) {
                    const ax = opponents[k - 1].left - cx;
                    const ay = opponents[k - 1].top - cy;
                    const bx = opponents[k].left - cx;
                    const by = opponents[k].top - cy;
                    expect(ax * by - ay * bx, `${label}, step ${k}`).toBeGreaterThan(0);
                }
            }

            // Left / right mirror: opponent k and opponent n-1-k are reflections about x = 50.
            for (let k = 0; k < n; k++) {
                expect(Math.abs(opponents[k].left + opponents[n - 1 - k].left - 100), `${label}, mirror ${k}`).toBeLessThanOrEqual(0.2);
            }
        }
    });

    it('never gives two players the same seat for any hero index', () => {
        for (const dims of TIER_TABLES) {
            const { result } = renderHook(() => useSeatLayout(dims, 6));
            for (let total = 2; total <= 10; total++) {
                for (let heroIndex = 0; heroIndex < total; heroIndex++) {
                    const keys = new Set(seatsOf(result.current.getSeatPosition, total, heroIndex).map((p) => `${p.left}/${p.top}`));
                    expect(keys.size, `${dims.width}x${dims.height}, total ${total}, hero ${heroIndex}`).toBe(total);
                }
            }
        }
    });
});

/**
 * Best axis-aligned ellipse centred on x = 50 through the points, in units X = (x - 50) / 50, Y = (y - 47) / 50 (the centre c is searched in Y units).
 * Equation A X^2 + B (Y - c)^2 = 1: for every candidate centre c the coefficients (A, B) are a 2x2 least squares,
 * and the centre with the smallest squared residual wins (grid search, then a finer pass).
 */
function fitEllipseCentredOnX50(points: { X: number; Y: number }[]) {
    const solve = (c: number) => {
        let sxx = 0;
        let sxy = 0;
        let syy = 0;
        let sx = 0;
        let sy = 0;
        for (const p of points) {
            const u = p.X ** 2;
            const v = (p.Y - c) ** 2;
            sxx += u * u;
            sxy += u * v;
            syy += v * v;
            sx += u;
            sy += v;
        }
        const det = sxx * syy - sxy * sxy;
        if (Math.abs(det) < 1e-12) return null;
        const a = (sx * syy - sy * sxy) / det;
        const b = (sy * sxx - sx * sxy) / det;
        let error = 0;
        for (const p of points) error += (a * p.X ** 2 + b * (p.Y - c) ** 2 - 1) ** 2;
        return { a, b, c, error };
    };
    let best: ReturnType<typeof solve> = null;
    for (const [from, to, step] of [[-0.8, 0.8, 0.005], [0, 0, 0]] as const) {
        const centre = best ? best.c : 0;
        const lo = step === 0 ? centre - 0.01 : from;
        const hi = step === 0 ? centre + 0.01 : to;
        const delta = step === 0 ? 0.0002 : step;
        for (let c = lo; c <= hi; c += delta) {
            const candidate = solve(c);
            if (candidate && (!best || candidate.error < best.error)) best = candidate;
        }
    }
    return best;
}

describe('seat layout preservation: one continuous ellipse', () => {
    it('puts the unclamped opponents of every (table, count) on a single ellipse centred on x = 50', () => {
        // A mirrored table has only (n + 1) / 2 distinct seat positions, so a 3-parameter ellipse (A, B, centre) is
        // over-determined from 8 players (7 opponents, 4 distinct positions) upwards.
        const heights = [190, 240, 280, 330, 380, 419, 470, 558, 700, 840];
        let checked = 0;
        for (const height of heights) {
            const dims = { width: Math.round(height * TABLE_ASPECT), height };
            for (let total = 8; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(dims, total));
                const opponents = opponentsClockwise(result.current.getSeatPosition, total, 0)
                    // Seats pinned by a sanity clamp are not on the ellipse.
                    .filter((s) => s.top > 4 && s.top < 72 && s.left > 4 && s.left < 96);
                if (opponents.length < 7) continue;
                const points = opponents.map((s) => ({ X: (s.left - 50) / 50, Y: (s.top - 47) / 50 }));
                const fit = fitEllipseCentredOnX50(points);
                const label = `${dims.width}x${dims.height}, total ${total}`;
                expect(fit, label).not.toBeNull();
                if (!fit) continue;

                for (const [i, p] of points.entries()) {
                    const residual = fit.a * p.X ** 2 + fit.b * (p.Y - fit.c) ** 2 - 1;
                    expect(Math.abs(residual), `${label}: residual at ${opponents[i].left}/${opponents[i].top}`).toBeLessThan(0.03);
                }
                // A real ellipse with a sane centre (in % of the table height) and radii.
                expect(fit.a, label).toBeGreaterThan(0);
                expect(fit.b, label).toBeGreaterThan(0);
                expect(47 + fit.c * 50, label).toBeGreaterThan(30);
                expect(47 + fit.c * 50, label).toBeLessThan(60);
                expect(50 / Math.sqrt(fit.a), label).toBeGreaterThan(20);
                expect(50 / Math.sqrt(fit.b), label).toBeGreaterThan(20);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(15);
    });
});

describe('seat layout preservation: tier and scale derivation', () => {
    it('derives the tier from the table width (720 / 1100), independent of height', () => {
        const seed = 2468;
        const random = mulberry32(seed);
        for (let i = 0; i < 80; i++) {
            const width = Math.round(randomBetween(random, 300, 1600));
            const height = Math.round(randomBetween(random, 150, 700));
            const { result } = renderHook(() => useSeatLayout({ width, height }, randomInt(random, 3, 10)));
            const expected = width < 720 ? 'compact' : width >= 1100 ? 'wide' : 'standard';
            expect(result.current.tableTier, `seed ${seed}, ${width}x${height}`).toBe(expected);
            expect(result.current.isCompactTable).toBe(expected === 'compact');
            expect(result.current.isWideTable).toBe(expected === 'wide');
        }
    });

    it('derives the overall scale from the table height (height / 430) wherever it is unclamped before and after the fix', () => {
        const seed = 8642;
        const random = mulberry32(seed);
        for (let i = 0; i < 80; i++) {
            // 172..494: above the old 0.4 floor, below the 1.15 ceiling (the new floor is 0.3).
            const height = randomBetween(random, 174, 492);
            const width = randomBetween(random, 300, 1500);
            const total = randomInt(random, 3, 10);
            const { result } = renderHook(() => useSeatLayout({ width, height }, total));
            expect(result.current.tableScale.overall, `seed ${seed}, ${width}x${height}`).toBeCloseTo(height / BASE_TABLE_HEIGHT, 8);
            expect(result.current.scale).toBe(result.current.tableScale.overall);
        }
    });
});

describe('seat layout preservation: seat description and card placement', () => {
    it('places cards below the avatar only for crowded top-centre seats, otherwise towards the table', () => {
        const seed = 97531;
        const random = mulberry32(seed);
        let belowSeen = 0;
        for (let iteration = 0; iteration < 120; iteration++) {
            const dims = TIER_TABLES[randomInt(random, 0, TIER_TABLES.length - 1)];
            const total = randomInt(random, 2, 10);
            const heroIndex = randomInt(random, 0, total - 1);
            const { result } = renderHook(() => useSeatLayout(dims, total));
            const opponentCount = total - 1;
            for (const seat of opponentsClockwise(result.current.getSeatPosition, total, heroIndex)) {
                const label = `seed ${seed}, iteration ${iteration}: ${dims.width}x${dims.height}, total ${total}, seat ${seat.left}/${seat.top}`;
                const crowdedTop = opponentCount >= 6 && Math.abs(seat.left - 50) <= 14 && seat.top < 35;
                if (crowdedTop) {
                    expect(seat.cardPlacement, label).toBe('below');
                    belowSeen++;
                } else {
                    expect(seat.cardPlacement, label).toBe(seat.left <= 50 ? 'right' : 'left');
                }
            }
        }
        expect(belowSeen).toBeGreaterThan(0);
    });

    it('describes panel placement, side and vertical zone from the seat coordinates', () => {
        for (const dims of TIER_TABLES) {
            for (let total = 2; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(dims, total));
                for (const seat of seatsOf(result.current.getSeatPosition, total, 0)) {
                    const label = `${dims.width}x${dims.height}, total ${total}, seat ${seat.left}/${seat.top}`;
                    expect(seat.panelPlacement, label).toBe(seat.left < 30 ? 'left' : seat.left > 70 ? 'right' : 'centre');
                    expect(seat.side, label).toBe(seat.left < 45 ? 'left' : seat.left > 55 ? 'right' : 'centre');
                    expect(seat.verticalZone, label).toBe(seat.top < 35 ? 'top' : seat.top > 65 ? 'bottom' : 'middle');
                }
            }
        }
    });
});
