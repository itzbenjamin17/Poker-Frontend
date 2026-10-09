import { describe, expect, it } from 'vitest';
import {
    BASE_TABLE_HEIGHT,
    CARD_BASE_WIDTH,
    CARD_SIZE_MULTIPLIER,
    MIN_CARD_WIDTH_PX,
    MIN_FONT_PX,
    SCALE_CEILING,
    SCALE_FLOOR,
    TABLE_ASPECT,
    avatarDiameter,
    fontPx,
    getDensity,
    getTableDimensions,
    getTableScale,
    getTableTier,
    isCompactCardScale,
} from '../tableGeometry';
import { mulberry32, randomBetween, randomInt } from '../../test/prng';

/**
 * Property 2 (preservation). Invariants of the geometry helpers that the containment fix must keep:
 * the table is sized from the measured stage, the tier from the table width, the scale from the table
 * height, density only touches opponents and never grows, and the legibility floors hold. No density
 * values, scale floors or coordinates are asserted here because the fix changes those on purpose.
 * Failing cases print their seed.
 */

describe('getTableDimensions preservation', () => {
    it('keeps TABLE_ASPECT, fits inside the stage minus a 4% inset clamped to 8..32px, and touches one side', () => {
        const seed = 55;
        const random = mulberry32(seed);
        for (let i = 0; i < 200; i++) {
            const stageWidth = randomBetween(random, 200, 3000);
            const stageHeight = randomBetween(random, 150, 2000);
            const label = `seed ${seed}, stage ${stageWidth.toFixed(1)}x${stageHeight.toFixed(1)}`;
            const inset = Math.min(32, Math.max(8, Math.min(stageWidth, stageHeight) * 0.04));
            const { width, height } = getTableDimensions(stageWidth, stageHeight);

            expect(width / height, label).toBeCloseTo(TABLE_ASPECT, 8);
            expect(width, label).toBeLessThanOrEqual(stageWidth - inset * 2 + 1e-6);
            expect(height, label).toBeLessThanOrEqual(stageHeight - inset * 2 + 1e-6);
            const touchesWidth = Math.abs(width - (stageWidth - inset * 2)) < 1e-6;
            const touchesHeight = Math.abs(height - (stageHeight - inset * 2)) < 1e-6;
            expect(touchesWidth || touchesHeight, label).toBe(true);
        }
    });

    it('never returns negative sizes, even for degenerate stages', () => {
        for (const [w, h] of [[0, 0], [10, 10], [5, 400], [400, 5]] as const) {
            const { width, height } = getTableDimensions(w, h);
            expect(width).toBeGreaterThanOrEqual(0);
            expect(height).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('getTableTier preservation', () => {
    it('uses the 720 / 1100 thresholds on the table width', () => {
        const seed = 77;
        const random = mulberry32(seed);
        expect(getTableTier(719.99)).toBe('compact');
        expect(getTableTier(720)).toBe('standard');
        expect(getTableTier(1099.99)).toBe('standard');
        expect(getTableTier(1100)).toBe('wide');
        for (let i = 0; i < 100; i++) {
            const width = randomBetween(random, 0, 2400);
            const expected = width < 720 ? 'compact' : width >= 1100 ? 'wide' : 'standard';
            expect(getTableTier(width), `seed ${seed}, width ${width}`).toBe(expected);
        }
    });
});

describe('getTableScale preservation', () => {
    it('keeps overall within [SCALE_FLOOR, SCALE_CEILING] and equal to height / 430 where unclamped', () => {
        const seed = 1234;
        const random = mulberry32(seed);
        for (let i = 0; i < 200; i++) {
            const height = randomBetween(random, 60, 1200);
            const width = height * TABLE_ASPECT;
            const count = randomInt(random, 2, 10);
            const { overall } = getTableScale({ width, height }, count);
            const label = `seed ${seed}, ${width.toFixed(0)}x${height.toFixed(0)}, ${count} players`;
            expect(overall, label).toBeGreaterThanOrEqual(SCALE_FLOOR);
            expect(overall, label).toBeLessThanOrEqual(SCALE_CEILING);
            const natural = height / BASE_TABLE_HEIGHT;
            if (natural >= 0.41 && natural <= SCALE_CEILING) {
                expect(overall, label).toBeCloseTo(natural, 8);
            }
        }
    });

    it('applies density to opponents only: overall, hero card, text, badge and spacing never depend on the player count', () => {
        const seed = 4321;
        const random = mulberry32(seed);
        for (let i = 0; i < 120; i++) {
            const height = randomBetween(random, 120, 800);
            const dims = { width: height * TABLE_ASPECT, height };
            const base = getTableScale(dims, 3);
            const crowded = getTableScale(dims, randomInt(random, 4, 10));
            const label = `seed ${seed}, height ${height.toFixed(1)}`;
            expect(crowded.overall, label).toBe(base.overall);
            expect(crowded.heroCard, label).toBe(base.heroCard);
            expect(crowded.text, label).toBe(base.text);
            expect(crowded.badge, label).toBe(base.badge);
            expect(crowded.spacing, label).toBe(base.spacing);
            expect(crowded.avatar, label).toBeLessThanOrEqual(base.avatar + 1e-12);
            expect(crowded.opponentCard, label).toBeLessThanOrEqual(base.opponentCard + 1e-12);
        }
    });

    it('never produces an opponent card narrower than MIN_CARD_WIDTH_PX', () => {
        const seed = 999;
        const random = mulberry32(seed);
        for (let i = 0; i < 200; i++) {
            const height = randomBetween(random, 60, 1200);
            const dims = { width: randomBetween(random, 300, 2000), height };
            const { opponentCard } = getTableScale(dims, randomInt(random, 2, 10));
            expect(opponentCard * CARD_BASE_WIDTH, `seed ${seed}, ${JSON.stringify(dims)}`).toBeGreaterThanOrEqual(MIN_CARD_WIDTH_PX - 1e-9);
        }
    });

    it('keeps the compact tier opponent cards smaller than the standard tier ones at the same density and scale', () => {
        const compact = getTableScale({ width: 600, height: 279 }, 4);
        const standard = getTableScale({ width: 900, height: 279 }, 4);
        expect(compact.opponentCard).toBeLessThan(standard.opponentCard);
        expect(compact.overall).toBe(standard.overall);
    });
});

describe('getDensity preservation', () => {
    it('is at most 1, is 1 up to 6 players, never increases with the player count and stays positive', () => {
        for (let count = 1; count <= 6; count++) expect(getDensity(count), `count ${count}`).toBe(1);
        let previous = 1;
        for (let count = 2; count <= 14; count++) {
            const density = getDensity(count);
            expect(density, `count ${count}`).toBeGreaterThan(0.5);
            expect(density, `count ${count}`).toBeLessThanOrEqual(1);
            expect(density, `count ${count}`).toBeLessThanOrEqual(previous);
            previous = density;
        }
    });
});

describe('legibility helpers preservation', () => {
    it('fontPx never drops below the 8px floor and follows round(base * scale) above it', () => {
        const seed = 31;
        const random = mulberry32(seed);
        expect(MIN_FONT_PX).toBe(8);
        for (let i = 0; i < 200; i++) {
            const base = randomBetween(random, 6, 30);
            const scale = randomBetween(random, 0.2, 1.4);
            expect(fontPx(base, scale), `seed ${seed}, ${base} x ${scale}`).toBe(Math.max(8, Math.round(base * scale)));
        }
    });

    it('avatarDiameter is the design-system base diameter times the scale', () => {
        for (const scale of [0.3, 0.47, 0.8, 1, 1.15]) {
            expect(avatarDiameter('xs', scale)).toBeCloseTo(48 * scale, 10);
            expect(avatarDiameter('sm', scale)).toBeCloseTo(64 * scale, 10);
            expect(avatarDiameter('md', scale)).toBeCloseTo(80 * scale, 10);
        }
    });

    it('isCompactCardScale flips exactly when the corner index would fall below the font floor', () => {
        const seed = 12;
        const random = mulberry32(seed);
        for (let i = 0; i < 200; i++) {
            const scale = randomBetween(random, 0.2, 1.3);
            for (const size of ['sm', 'md', 'lg'] as const) {
                expect(isCompactCardScale(scale, size), `seed ${seed}, ${scale} ${size}`)
                    .toBe(Math.round(scale * CARD_SIZE_MULTIPLIER[size] * 12) < MIN_FONT_PX);
            }
        }
    });
});
