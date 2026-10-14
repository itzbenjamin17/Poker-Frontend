// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    TABLE_ASPECT,
    getTableDimensions,
    getTableTier,
    getTableScale,
    getDensity,
    fontPx,
    avatarDiameter,
    isCompactCardScale,
    CARD_BASE_WIDTH,
    MIN_CARD_WIDTH_PX,
    SCALE_FLOOR,
    SCALE_CEILING,
    getBoardClusterHalfHeight,
    seatHandRankFits,
    seatStatusFitsFelt,
    fitSeatEllipse,
    placeOpponentSeat,
    opponentAvatarSize,
    statusBoxSize,
} from '../tableGeometry';

describe('getTableDimensions', () => {
    it('uses a 4% inset clamped to 8..32px', () => {
        // min side 300 -> 12px inset -> available 626x276, width-limited? 626/2.15=291 > 276 -> height limited
        const small = getTableDimensions(650, 300);
        expect(small.height).toBeCloseTo(300 - 24, 5);
        expect(small.width).toBeCloseTo((300 - 24) * TABLE_ASPECT, 5);

        // tiny stage -> 8px inset floor
        const tiny = getTableDimensions(100, 100);
        expect(tiny.width).toBeCloseTo(84, 5);

        // huge stage -> 32px inset cap
        const huge = getTableDimensions(3000, 3000);
        expect(huge.width).toBeCloseTo(3000 - 64, 5);
    });

    it('fits width-limited stages and always keeps TABLE_ASPECT', () => {
        const dims = getTableDimensions(600, 800);
        const inset = Math.min(32, Math.max(8, 600 * 0.04));
        expect(dims.width).toBeCloseTo(600 - inset * 2, 5);
        expect(dims.width / dims.height).toBeCloseTo(TABLE_ASPECT, 5);
    });

    it('fits height-limited stages', () => {
        const dims = getTableDimensions(1920, 520);
        const inset = Math.min(32, Math.max(8, 520 * 0.04));
        expect(dims.height).toBeCloseTo(520 - inset * 2, 5);
        expect(dims.width / dims.height).toBeCloseTo(TABLE_ASPECT, 5);
    });

    it('never returns negative sizes', () => {
        expect(getTableDimensions(0, 0)).toEqual({ width: 0, height: 0 });
    });
});

describe('getTableTier', () => {
    it('uses 720 / 1100 table width thresholds', () => {
        expect(getTableTier(719)).toBe('compact');
        expect(getTableTier(720)).toBe('standard');
        expect(getTableTier(1099)).toBe('standard');
        expect(getTableTier(1100)).toBe('wide');
    });
});

describe('getDensity', () => {
    it('shrinks opponents on crowded tables', () => {
        expect(getDensity(6)).toBe(1);
        expect(getDensity(7)).toBe(0.8);
        expect(getDensity(8)).toBe(0.78);
        expect(getDensity(9)).toBe(0.76);
        expect(getDensity(10)).toBe(0.7);
    });
});

describe('getTableScale', () => {
    it('is height based and clamped', () => {
        expect(getTableScale({ width: 900, height: 215 }, 4).overall).toBeCloseTo(0.5, 5);
        expect(getTableScale({ width: 100, height: 20 }, 4).overall).toBe(SCALE_FLOOR);
        // A 301x140 table (tiny viewport with the action dock open) is no longer held at 0.4.
        expect(getTableScale({ width: 301, height: 140 }, 4).overall).toBeCloseTo(140 / 430, 5);
        expect(getTableScale({ width: 301, height: 140 }, 4).overall).toBeLessThan(0.4);
        expect(getTableScale({ width: 301, height: 140 }, 4).overall).toBeGreaterThanOrEqual(SCALE_FLOOR);
        expect(getTableScale({ width: 2000, height: 930 }, 4).overall).toBe(SCALE_CEILING);
    });

    it('applies density to opponents only', () => {
        const dims = { width: 920, height: 430 };
        const few = getTableScale(dims, 4);
        const many = getTableScale(dims, 10);
        expect(many.overall).toBe(few.overall);
        expect(many.heroCard).toBe(few.heroCard);
        expect(many.avatar).toBeCloseTo(few.avatar * getDensity(10), 5);
        expect(many.opponentCard).toBeCloseTo(few.opponentCard * getDensity(10), 5);
    });

    it('uses smaller opponent cards in the compact tier', () => {
        const compact = getTableScale({ width: 600, height: 280 }, 4);
        expect(compact.opponentCard).toBeCloseTo(compact.overall * 0.65, 5);
        const standard = getTableScale({ width: 900, height: 420 }, 4);
        expect(standard.opponentCard).toBeCloseTo(standard.overall * 0.78, 5);
    });
});

describe('opponent card floor', () => {
    it('never produces an opponent card narrower than MIN_CARD_WIDTH_PX', () => {
        for (const players of [3, 6, 10]) {
            for (const height of [120, 190, 285, 430]) {
                const { opponentCard } = getTableScale({ width: height * TABLE_ASPECT, height }, players);
                expect(opponentCard * CARD_BASE_WIDTH).toBeGreaterThanOrEqual(MIN_CARD_WIDTH_PX);
            }
        }
    });
});

describe('avatarDiameter', () => {
    it('multiplies the design-system base diameter by the scale', () => {
        expect(avatarDiameter('xs', 1)).toBe(48);
        expect(avatarDiameter('sm', 1)).toBe(64);
        expect(avatarDiameter('md', 1)).toBe(80);
        expect(avatarDiameter('sm', 0.8)).toBeCloseTo(51.2, 5);
        expect(avatarDiameter('md', 2)).toBe(160);
    });
});

describe('isCompactCardScale', () => {
    it('flips when the corner index would drop below the 8px font floor', () => {
        expect(isCompactCardScale(0.6)).toBe(true);
        expect(isCompactCardScale(0.625)).toBe(false);
        expect(isCompactCardScale(1)).toBe(false);
        // size multiplier counts: 0.6 * 1.1 = 0.66
        expect(isCompactCardScale(0.6, 'lg')).toBe(false);
        expect(isCompactCardScale(0.7, 'sm')).toBe(true);
    });
});

describe('fontPx', () => {
    it('never goes below 8px', () => {
        expect(fontPx(10, 0.4)).toBe(8);
        expect(fontPx(10, 1)).toBe(10);
        expect(fontPx(12, 1.15)).toBe(14);
    });
});

describe('getBoardClusterHalfHeight', () => {
    it('scales monotonically with table scale', () => {
        const small = getBoardClusterHalfHeight(getTableScale({ width: 650, height: 202 }, 8));
        const large = getBoardClusterHalfHeight(getTableScale({ width: 1920, height: 863 }, 8));
        expect(small).toBeGreaterThan(0);
        expect(large).toBeGreaterThan(small);
    });
});

describe('seatHandRankFits', () => {
    it('always fits for non-below seats', () => {
        const scale = getTableScale({ width: 650, height: 202 }, 8);
        expect(seatHandRankFits({ top: 50, cardPlacement: 'left' }, { width: 650, height: 202 }, scale, 'compact')).toBe(true);
        expect(seatHandRankFits({ top: 50, cardPlacement: 'right' }, { width: 650, height: 202 }, scale, 'compact')).toBe(true);
    });

    it('returns false for below seats on constrained tables where clearance is exhausted', () => {
        const table = { width: 976, height: 454 };
        const scale = getTableScale(table, 8);
        expect(seatHandRankFits({ top: 13.7, cardPlacement: 'below' }, table, scale, 'standard')).toBe(false);
    });

    it('returns true for below seats on large desktop tables with ample clearance', () => {
        const table = { width: 1855, height: 863 };
        const scale = getTableScale(table, 8);
        expect(seatHandRankFits({ top: 10, cardPlacement: 'below' }, table, scale, 'wide')).toBe(true);
    });
});

describe('seatStatusFitsFelt', () => {
    it('returns true for inner seats on standard tables', () => {
        const table = { width: 1000, height: 465 };
        const scale = getTableScale(table, 6);
        expect(seatStatusFitsFelt({ left: 50, top: 15 }, table, scale, 'standard')).toBe(true);
    });

    it('returns false for equator-edge seats on constrained tables where status breaches the felt', () => {
        const table = { width: 774, height: 360 };
        const scale = getTableScale(table, 4);
        expect(seatStatusFitsFelt({ left: 8.2, top: 49.5 }, table, scale, 'standard')).toBe(false);
    });

    it('fits a lower side seat with a bet row and wrapped reconnect status at 10 players on an 860x400 table', () => {
        const table = { width: 860, height: 400 };
        const players = 10;
        const tier = getTableTier(table.width);
        const scale = getTableScale(table, players);
        const ellipse = fitSeatEllipse(table, scale, tier, players - 1);
        const sideSeats = Array.from({ length: players - 1 }, (_, index) =>
            placeOpponentSeat(index, players - 1, ellipse),
        ).filter((seat) => seat.left < 35 || seat.left > 65);
        const lowerSideSeat = sideSeats.reduce((lowest, seat) => seat.top > lowest.top ? seat : lowest);
        const radius = avatarDiameter(opponentAvatarSize(tier), scale.avatar) / 2;

        expect(statusBoxSize(radius, scale.text).height).toBeGreaterThan(1.5 * fontPx(9, scale.text));
        expect(seatStatusFitsFelt(lowerSideSeat, table, scale, tier)).toBe(true);
    });
});


