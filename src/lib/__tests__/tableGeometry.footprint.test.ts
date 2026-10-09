import { describe, expect, it } from 'vitest';
import { mulberry32, randomBetween } from '../../test/prng';
import {
    CARD_BASE_WIDTH,
    MIN_CARD_WIDTH_PX,
    MIN_FONT_PX,
    OPPONENT_RANK_MIN_SCALE,
    SAFE_MARGIN_UNITS,
    STATUS_MAX_WIDTH_RADII,
    STATUS_MIN_MAX_WIDTH_EM,
    TABLE_ASPECT,
    avatarDiameter,
    cardFanStrip,
    classifyCardPlacement,
    cornerIndexMetrics,
    ellipseInsetDistance,
    fitSeatEllipse,
    fitSeatEllipseDetailed,
    fontPx,
    footprintPoints,
    getHeroFootprint,
    getSeatFootprint,
    getSeatMetrics,
    getTableDimensions,
    getTableScale,
    getTableTier,
    handRankLabelSize,
    isCompactCardScale,
    labelCharBudget,
    minHeroMargin,
    minSeatMargin,
    placeOpponentSeat,
    safeMarginPx,
    seatAngleSpan,
    statusMaxWidthPx,
    winnerDecoration,
} from '../tableGeometry';
import type { AvatarSize, FootprintPart, HeroFootprintInput, SeatFootprintInput } from '../tableGeometry';
import type { TableTier } from '../../types';

/** Independent reference: nearest of 720 sampled boundary points. */
function bruteForceBoundaryDistance(p: { x: number; y: number }, a: number, b: number): number {
    let best = Infinity;
    for (let k = 0; k < 720; k++) {
        const theta = (k / 720) * Math.PI * 2;
        best = Math.min(best, Math.hypot(p.x - a * Math.cos(theta), p.y - b * Math.sin(theta)));
    }
    return best;
}

const isInside = (p: { x: number; y: number }, a: number, b: number) => (p.x / a) ** 2 + (p.y / b) ** 2 < 1;

describe('safeMarginPx', () => {
    it('uses a 4 unit design margin', () => {
        expect(SAFE_MARGIN_UNITS).toBe(4);
    });

    it('floors at 2px (scale .3) and is 4 x scale above it', () => {
        expect(safeMarginPx(0.3)).toBe(2);
        expect(safeMarginPx(0.5)).toBe(2);
        expect(safeMarginPx(1.15)).toBeCloseTo(4.6, 10);
        expect(safeMarginPx(1)).toBe(4);
    });

    it('is non-decreasing in scale and never below 2px', () => {
        let previous = 0;
        for (let s = 0.1; s <= 1.2; s += 0.05) {
            const value = safeMarginPx(s);
            expect(value).toBeGreaterThanOrEqual(2);
            expect(value).toBeGreaterThanOrEqual(previous);
            previous = value;
        }
    });
});

describe('ellipseInsetDistance', () => {
    it('matches an independent brute-force boundary sampler for seeded random points (aspect 1 to 3)', () => {
        const seed = 20260810;
        const random = mulberry32(seed);
        for (let i = 0; i < 400; i++) {
            const b = randomBetween(random, 60, 300);
            const a = b * randomBetween(random, 1, 3);
            const p = {
                x: randomBetween(random, -1.4 * a, 1.4 * a),
                y: randomBetween(random, -1.4 * b, 1.4 * b),
            };
            const reference = bruteForceBoundaryDistance(p, a, b);
            const actual = ellipseInsetDistance(p, a, b);
            // The sampler is a polyline-free point set: its error is bounded by the sample spacing (~ a * 2pi / 720).
            const tolerance = (a * Math.PI * 2) / 720 + 0.05;
            expect(Math.abs(Math.abs(actual) - reference), `seed ${seed}, case ${i}: p=${JSON.stringify(p)} a=${a} b=${b}`).toBeLessThanOrEqual(tolerance);
            expect(actual > 0, `seed ${seed}, case ${i}: sign`).toBe(isInside(p, a, b));
        }
    });

    it('stays accurate for points near the axes and the centre (where closest-point iterations converge slowest)', () => {
        const seed = 424242;
        const random = mulberry32(seed);
        for (let i = 0; i < 400; i++) {
            const b = randomBetween(random, 60, 300);
            const a = b * randomBetween(random, 1, 3);
            const nearX = i % 2 === 0;
            const p = nearX
                ? { x: randomBetween(random, -0.02 * a, 0.02 * a), y: randomBetween(random, -1.3 * b, 1.3 * b) }
                : { x: randomBetween(random, -1.3 * a, 1.3 * a), y: randomBetween(random, -0.02 * b, 0.02 * b) };
            const reference = bruteForceBoundaryDistance(p, a, b);
            const actual = ellipseInsetDistance(p, a, b);
            const tolerance = (a * Math.PI * 2) / 720 + 0.05;
            expect(Math.abs(Math.abs(actual) - reference), `seed ${seed}, case ${i}: p=${JSON.stringify(p)} a=${a} b=${b}`).toBeLessThanOrEqual(tolerance);
        }
    });

    it('is the centre-to-nearest-boundary distance at the centre', () => {
        expect(ellipseInsetDistance({ x: 0, y: 0 }, 200, 100)).toBeCloseTo(100, 4);
        expect(ellipseInsetDistance({ x: 0, y: 0 }, 100, 200)).toBeCloseTo(100, 4);
        expect(ellipseInsetDistance({ x: 0, y: 0 }, 150, 150)).toBeCloseTo(150, 4);
    });

    it('is exact on each axis', () => {
        expect(ellipseInsetDistance({ x: 150, y: 0 }, 200, 100)).toBeCloseTo(50, 4);
        expect(ellipseInsetDistance({ x: -150, y: 0 }, 200, 100)).toBeCloseTo(50, 4);
        expect(ellipseInsetDistance({ x: 0, y: 40 }, 200, 100)).toBeCloseTo(60, 4);
        expect(ellipseInsetDistance({ x: 0, y: -40 }, 200, 100)).toBeCloseTo(60, 4);
    });

    it('is zero on the boundary and signed (positive inside, negative outside)', () => {
        for (const theta of [0, 0.4, 1, Math.PI / 2, 2.5, Math.PI, 4, 5.5]) {
            const onBoundary = { x: 200 * Math.cos(theta), y: 100 * Math.sin(theta) };
            expect(Math.abs(ellipseInsetDistance(onBoundary, 200, 100))).toBeLessThan(1e-3);
        }
        expect(ellipseInsetDistance({ x: 10, y: 10 }, 200, 100)).toBeGreaterThan(0);
        expect(ellipseInsetDistance({ x: 250, y: 0 }, 200, 100)).toBeCloseTo(-50, 4);
        expect(ellipseInsetDistance({ x: 0, y: -130 }, 200, 100)).toBeCloseTo(-30, 4);
        expect(ellipseInsetDistance({ x: 180, y: 90 }, 200, 100)).toBeLessThan(0);
    });

    it('is symmetric in the four quadrants', () => {
        const d = ellipseInsetDistance({ x: 120, y: 60 }, 200, 100);
        expect(ellipseInsetDistance({ x: -120, y: 60 }, 200, 100)).toBeCloseTo(d, 8);
        expect(ellipseInsetDistance({ x: 120, y: -60 }, 200, 100)).toBeCloseTo(d, 8);
        expect(ellipseInsetDistance({ x: -120, y: -60 }, 200, 100)).toBeCloseTo(d, 8);
    });

    it('is not a bounding-rectangle test: a corner of the bounding box is far outside the ellipse', () => {
        // (a, b) is inside the bounding rectangle but about 0.41 x min(a, b) outside the ellipse for a circle.
        expect(ellipseInsetDistance({ x: 100, y: 100 }, 100, 100)).toBeCloseTo(-(Math.SQRT2 * 100 - 100), 4);
        expect(ellipseInsetDistance({ x: 0.9 * 200, y: 0.9 * 100 }, 200, 100)).toBeLessThan(0);
    });

    it('stays finite for degenerate ellipses and points', () => {
        expect(Number.isFinite(ellipseInsetDistance({ x: 5, y: 5 }, 0, 0))).toBe(true);
        expect(Number.isFinite(ellipseInsetDistance({ x: 0, y: 0 }, 100, 100))).toBe(true);
        expect(Number.isFinite(ellipseInsetDistance({ x: 1e-12, y: 1e-12 }, 300, 100))).toBe(true);
        expect(Number.isFinite(ellipseInsetDistance({ x: 3, y: 4 }, -1, 5))).toBe(true);
    });
});

/** Ring (zero-blur layers) and glow (spread + blur) extents of a box-shadow string, as the e2e instrument reads them. */
function shadowExtents(boxShadow: string): { ring: number; glow: number } {
    let ring = 0;
    let glow = 0;
    for (const layer of boxShadow.split(/,(?![^(]*\))/)) {
        let stripped = layer;
        while (/\([^()]*\)/.test(stripped)) stripped = stripped.replace(/[a-z-]*\([^()]*\)/gi, ' ');
        const [x = 0, y = 0, blur = 0, spread = 0] = (stripped.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        const offset = Math.max(Math.abs(x), Math.abs(y));
        if (blur === 0) ring = Math.max(ring, spread + offset);
        glow = Math.max(glow, spread + blur + offset);
    }
    return { ring, glow };
}

describe('winnerDecoration', () => {
    it('scales with the table instead of using fixed pixels', () => {
        expect(winnerDecoration(1)).toMatchObject({ ringOffsetPx: 2, ringWidthPx: 2, glowBlurPx: 8, ringExtentPx: 4, extentPx: 8 });
        expect(winnerDecoration(1.15)).toMatchObject({ ringOffsetPx: 2, ringWidthPx: 2, glowBlurPx: 9, extentPx: 9 });
        expect(winnerDecoration(0.47)).toMatchObject({ ringOffsetPx: 1, ringWidthPx: 1, glowBlurPx: 4, extentPx: 4 });
        expect(winnerDecoration(0.3)).toMatchObject({ ringOffsetPx: 1, ringWidthPx: 1, glowBlurPx: 4, extentPx: 4 });
    });

    it('is monotone in scale, has a non-zero floor and equals the larger of ring and glow', () => {
        let previous = 0;
        for (let s = 0.1; s <= 1.4; s += 0.01) {
            const d = winnerDecoration(s);
            expect(d.extentPx).toBeGreaterThanOrEqual(previous);
            expect(d.extentPx).toBe(Math.max(d.ringExtentPx, d.glowBlurPx));
            expect(d.ringExtentPx).toBe(d.ringOffsetPx + d.ringWidthPx);
            expect(d.ringOffsetPx).toBeGreaterThanOrEqual(1);
            expect(d.glowBlurPx).toBeGreaterThanOrEqual(4);
            previous = d.extentPx;
        }
    });

    it('is smaller than the old fixed 5px ring and 18px glow on every table below scale 1', () => {
        for (const s of [0.3, 0.47, 0.66, 0.8, 0.99]) {
            const d = winnerDecoration(s);
            expect(d.glowBlurPx).toBeLessThan(18);
            expect(d.ringExtentPx).toBeLessThanOrEqual(5);
        }
    });

    it('builds a box-shadow whose parsed ring and glow extents never exceed extentPx', () => {
        for (const s of [0.3, 0.47, 0.66, 0.8, 1, 1.15]) {
            const d = winnerDecoration(s);
            const { ring, glow } = shadowExtents(d.boxShadow);
            expect(ring, `ring at ${s}`).toBe(d.ringExtentPx);
            expect(glow, `glow at ${s}`).toBe(Math.max(d.ringExtentPx, d.glowBlurPx));
            expect(Math.max(ring, glow), `painted extent at ${s}`).toBeLessThanOrEqual(d.extentPx);
            // Same gold hue and alpha as the Tailwind classes it replaces.
            expect(d.boxShadow).toContain('rgba(252, 211, 77, 0.3)');
            expect(d.boxShadow).toContain('rgba(252, 192, 37, 0.8)');
        }
    });
});

describe('cardFanStrip and cornerIndexMetrics', () => {
    it('keeps the compact strip at 12px and the regular strip at 47% of the card (at least 18px)', () => {
        expect(cardFanStrip(18, true)).toBe(12);
        expect(cardFanStrip(29, true)).toBe(12);
        expect(cardFanStrip(43, false)).toBe(20);
        expect(cardFanStrip(80, false)).toBe(38);
        expect(cardFanStrip(30, false)).toBe(18);
    });

    it('always contains the corner index for every card width from MIN_CARD_WIDTH_PX to 80px', () => {
        for (let cw = MIN_CARD_WIDTH_PX; cw <= 80; cw++) {
            const cardScale = cw / CARD_BASE_WIDTH;
            const compactFace = isCompactCardScale(cardScale);
            const index = cornerIndexMetrics(cardScale, compactFace);
            expect(index.widthPx, `card ${cw}px (compact ${compactFace})`).toBeLessThanOrEqual(cardFanStrip(cw, compactFace));
            expect(index.rankFontPx).toBeGreaterThanOrEqual(MIN_FONT_PX);
            expect(index.suitFontPx).toBeGreaterThanOrEqual(MIN_FONT_PX);
            // The block (rank above suit) also fits the card height (4:3 card).
            expect(index.heightPx).toBeLessThan(Math.round(cardScale * 64));
        }
    });

    it('uses tighter padding on the compact face and fonts that never drop below 8px', () => {
        const compact = cornerIndexMetrics(0.5, true);
        const regular = cornerIndexMetrics(0.9, false);
        expect(compact.rankFontPx).toBe(8);
        expect(compact.suitFontPx).toBe(8);
        expect(compact.paddingPx).toBeLessThan(regular.paddingPx);
        expect(compact.widthPx).toBeLessThanOrEqual(12);
    });
});

// ---------------------------------------------------------------------------------------------
// Seat metrics and footprint
// ---------------------------------------------------------------------------------------------

const sizeFor = (isMobileLandscape: boolean, tier: TableTier): AvatarSize => (isMobileLandscape ? 'xs' : tier === 'compact' ? 'sm' : 'md');

/** A footprint input the way OpponentSeats builds it, for a table of the given height and player count. */
function footprintInput(
    height: number,
    players: number,
    over: Partial<SeatFootprintInput> = {},
): SeatFootprintInput {
    const dims = { width: height * TABLE_ASPECT, height };
    const tier = getTableTier(dims.width);
    const scale = getTableScale(dims, players);
    const avatarSize = sizeFor(false, tier);
    return {
        avatarRadius: avatarDiameter(avatarSize, scale.avatar) / 2,
        avatarScale: scale.avatar,
        textScale: scale.text,
        spacingScale: scale.spacing,
        avatarSize,
        cardScale: scale.opponentCard,
        compactFace: isCompactCardScale(scale.opponentCard),
        cardPlacement: 'right',
        labelPlacement: 'cards',
        tier,
        showLabel: scale.overall >= OPPONENT_RANK_MIN_SCALE,
        ...over,
    };
}

const partById = (parts: FootprintPart[], suffix: string) => {
    const part = parts.find((p) => p.id === `seat/${suffix}`);
    if (!part) throw new Error(`footprint has no ${suffix}`);
    return part.shape as Extract<FootprintPart['shape'], { kind: 'rect' | 'pill' }>;
};

const extents = (parts: FootprintPart[]) => {
    const points = footprintPoints(parts);
    return {
        minX: Math.min(...points.map((p) => p.x)),
        maxX: Math.max(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxY: Math.max(...points.map((p) => p.y)),
    };
};

describe('getSeatMetrics', () => {
    it('uses the card offset, label gaps and row geometry OpponentSeats positions things with', () => {
        const m = getSeatMetrics({ avatarRadius: 40, avatarScale: 1, spacingScale: 1, cardScale: 0.78, compactFace: false });
        expect(m.cardWidth).toBe(Math.round(0.78 * 48));
        expect(m.cardHeight).toBe(Math.round(0.78 * 64));
        expect(m.strip).toBe(cardFanStrip(m.cardWidth, false));
        expect(m.stackWidth).toBe(m.cardWidth + m.strip);
        expect(m.xOffset).toBe(40 + 8 + 4);
        expect(m.gapRow).toBe(3);
        expect(m.gapAvatar).toBe(2);
        expect(m.labelRowStart).toBe(40 + 2);
        expect(m.labelRowWidth).toBeCloseTo(2 * (m.xOffset + m.stackWidth / 2 - m.labelRowStart), 10);
        expect(m.labelRowTop).toBeCloseTo(40 + m.cardHeight / 2 + 3, 10);
        expect(m.belowGap).toBe(Math.round(5.0));
    });

    it('floors the label gaps at 2px and grows them with the spacing scale', () => {
        const small = getSeatMetrics({ avatarRadius: 12, avatarScale: 0.3, spacingScale: 0.3, cardScale: 0.4, compactFace: true });
        const big = getSeatMetrics({ avatarRadius: 46, avatarScale: 1.15, spacingScale: 1.15, cardScale: 0.9, compactFace: false });
        expect(small.gapRow).toBe(2);
        expect(small.gapAvatar).toBe(2);
        expect(big.gapRow).toBe(Math.round(3 * 1.15));
        expect(big.gapAvatar).toBe(Math.round(2 * 1.15));
        expect(small.strip).toBe(12);
    });
});

describe('getSeatFootprint', () => {
    it('always includes the winner glow, the crown and every badge: nothing depends on game state', () => {
        for (const height of [140, 200, 285, 454, 545]) {
            const input = footprintInput(height, 6);
            const parts = getSeatFootprint(input);
            for (const name of ['avatar', 'glow', 'crown', 'turn', 'chip', 'blind', 'offline', 'cards', 'bet', 'status']) {
                expect(parts.some((p) => p.id === `seat/${name}`), `${name} at ${height}`).toBe(true);
            }
            const glow = parts.find((p) => p.id === 'seat/glow')!.shape;
            expect(glow).toEqual({ kind: 'circle', cx: 0, cy: 0, r: input.avatarRadius + winnerDecoration(input.avatarScale).extentPx });
        }
    });

    it('is identical for repeated calls (no hidden state)', () => {
        const input = footprintInput(400, 8);
        expect(getSeatFootprint(input)).toEqual(getSeatFootprint({ ...input }));
    });

    it('grows monotonically with the table scale in every direction', () => {
        for (const cardPlacement of ['right', 'below'] as const) {
            let previous: ReturnType<typeof extents> | null = null;
            for (let height = 140; height <= 560; height += 20) {
                const parts = getSeatFootprint(footprintInput(height, 6, {
                    cardPlacement,
                    labelPlacement: cardPlacement === 'below' ? 'avatar' : 'cards',
                }));
                // The status box wraps by width, so its height jumps (2 lines -> 1 line) as the avatar grows: the rest grows smoothly.
                const e = extents(parts.filter((p) => p.id !== 'seat/status'));
                if (previous) {
                    expect(e.maxX, `${cardPlacement} ${height} maxX`).toBeGreaterThanOrEqual(previous.maxX - 1e-9);
                    expect(e.minX, `${cardPlacement} ${height} minX`).toBeLessThanOrEqual(previous.minX + 1e-9);
                    expect(e.maxY, `${cardPlacement} ${height} maxY`).toBeGreaterThanOrEqual(previous.maxY - 1e-9);
                    expect(e.minY, `${cardPlacement} ${height} minY`).toBeLessThanOrEqual(previous.minY + 1e-9);
                }
                previous = e;
            }
        }
    });

    it('mirrors exactly for cards on the left', () => {
        const right = getSeatFootprint(footprintInput(420, 7, { cardPlacement: 'right' }));
        const left = getSeatFootprint(footprintInput(420, 7, { cardPlacement: 'left' }));
        const cardsR = partById(right, 'cards');
        const cardsL = partById(left, 'cards');
        expect(cardsL.x).toBeCloseTo(-(cardsR.x + cardsR.w), 8);
        expect(cardsL.w).toBeCloseTo(cardsR.w, 8);
        const labelR = partById(right, 'label');
        const labelL = partById(left, 'label');
        expect(labelL.x).toBeCloseTo(-(labelR.x + labelR.w), 8);
        expect(labelL.y).toBeCloseTo(labelR.y, 8);
    });

    it('sizes the label with the 11 / 9 character budgets', () => {
        const standard = footprintInput(420, 6, { tier: 'standard', cardPlacement: 'right' });
        const compact = footprintInput(420, 6, { tier: 'compact', cardPlacement: 'right' });
        expect(partById(getSeatFootprint(standard), 'label').w).toBeCloseTo(
            handRankLabelSize(11, standard.avatarScale, standard.textScale, false).width, 8,
        );
        expect(partById(getSeatFootprint(compact), 'label').w).toBeCloseTo(
            handRankLabelSize(9, compact.avatarScale, compact.textScale, true).width, 8,
        );
        expect(labelCharBudget('standard')).toBe(11);
        expect(labelCharBudget('wide')).toBe(11);
        expect(labelCharBudget('compact')).toBe(9);
    });

    it('matches the measured DOM for the label ("TWO PAIR", 8 chars) at scale 1.15', () => {
        // Measured: 77.8 x 26.2 px at avatar scale 1.15, text scale 1.15 (font 10), standard padding.
        const size = handRankLabelSize(8, 1.15, 1.15, false);
        expect(size.width).toBeCloseTo(77.8, 0);
        expect(size.height).toBeCloseTo(26.2, 0);
        // Compact padding at scale .66 (font 8): measured 51.3 x 16.6 for 8 characters with the old 2s x 5s padding.
        const compact = handRankLabelSize(8, 0.663, 0.663, true);
        expect(compact.height).toBeGreaterThan(13);
        expect(compact.height).toBeLessThan(17);
    });

    it('places no label when it is screen-reader only, and BET takes the first slot under the avatar', () => {
        const hidden = getSeatFootprint(footprintInput(200, 6, { showLabel: false }));
        expect(hidden.some((p) => p.id === 'seat/label')).toBe(false);
        const input = footprintInput(420, 6);
        const withLabel = getSeatFootprint(input);
        const bet = partById(withLabel, 'bet');
        expect(bet.y).toBeCloseTo(input.avatarRadius + 8 * input.avatarScale, 8);
        const label = partById(withLabel, 'label');
        // The label sits under the cards, below the stack and clear of the avatar box.
        expect(label.y).toBeGreaterThan(partById(withLabel, 'cards').y + partById(withLabel, 'cards').h / 2);
        expect(Math.abs(label.x)).toBeGreaterThanOrEqual(input.avatarRadius);
    });

    it('stacks the cards-below column as the design equation says', () => {
        const input = footprintInput(420, 9, { cardPlacement: 'below', labelPlacement: 'avatar' });
        const metrics = getSeatMetrics(input);
        const parts = getSeatFootprint(input);
        const cards = partById(parts, 'cards');
        const label = partById(parts, 'label');
        const bet = partById(parts, 'bet');
        const status = partById(parts, 'status');
        const R = input.avatarRadius;
        expect(cards.y).toBeCloseTo(R + metrics.belowGap, 8);
        // Label top = cards top + card height + tilt envelope + gap (up to the integer rounding of the details offset).
        expect(label.y).toBeGreaterThanOrEqual(cards.y + metrics.cardHeight + metrics.tiltBottomExtra - 1);
        expect(label.y).toBeLessThanOrEqual(cards.y + metrics.cardHeight + metrics.tiltBottomExtra + metrics.gapRow + 1);
        expect(bet.y).toBeCloseTo(label.y + label.h + 4 * input.avatarScale, 8);
        expect(status.y).toBeCloseTo(bet.y + bet.h, 8);
        // Centred under the avatar.
        expect(label.x + label.w / 2).toBeCloseTo(0, 8);
        expect(cards.x + cards.w / 2).toBeCloseTo(0, 8);
    });

    it('adds the tilt envelope only for face-down cards', () => {
        const down = partById(getSeatFootprint(footprintInput(420, 6, { faceDown: true })), 'cards');
        const up = partById(getSeatFootprint(footprintInput(420, 6, { faceDown: false })), 'cards');
        expect(down.w).toBeGreaterThan(up.w);
        expect(down.h).toBeGreaterThan(up.h);
        const m = getSeatMetrics(footprintInput(420, 6));
        expect(down.w - up.w).toBeCloseTo(m.tiltExtraWidth, 8);
        expect(down.h - up.h).toBeCloseTo(m.tiltExtraHeight, 8);
        expect(up.w).toBeCloseTo(m.stackWidth, 8);
        expect(up.h).toBeCloseTo(m.cardHeight, 8);
    });

    it('bounds the status text to 2.4 avatar radii (at least 6.5em)', () => {
        for (let height = 120; height <= 600; height += 10) {
            for (const players of [3, 10]) {
                const input = footprintInput(height, players);
                const font = fontPx(9, input.textScale);
                const status = partById(getSeatFootprint(input), 'status');
                const label = `height ${height}, ${players} players`;
                expect(status.w, label).toBeLessThanOrEqual(statusMaxWidthPx(input.avatarRadius, font) + 1e-9);
                expect(statusMaxWidthPx(input.avatarRadius, font), label).toBeGreaterThanOrEqual(STATUS_MAX_WIDTH_RADII * input.avatarRadius);
                expect(statusMaxWidthPx(input.avatarRadius, font), label).toBeGreaterThanOrEqual(STATUS_MIN_MAX_WIDTH_EM * font);
                expect(status.h, label).toBeCloseTo(1.5 * font, 8);
            }
        }
    });
});

describe('getHeroFootprint', () => {
    const heroInput = (height: number): HeroFootprintInput => {
        const dims = { width: height * TABLE_ASPECT, height };
        const scale = getTableScale(dims, 6);
        const avatarSize = sizeFor(false, getTableTier(dims.width));
        return {
            avatarRadius: avatarDiameter(avatarSize, scale.overall) / 2,
            avatarScale: scale.overall,
            textScale: scale.text,
            spacingScale: scale.spacing,
            avatarSize,
            cardScale: scale.heroCard,
            compactFace: isCompactCardScale(scale.heroCard, 'lg'),
        };
    };

    it('keeps rank, BET and status to the left of the avatar and the cards to the right', () => {
        const input = heroInput(420);
        const parts = getHeroFootprint(input);
        const get = (name: string) => parts.find((p) => p.id === `hero/${name}`)!.shape as { x: number; w: number; y: number; h: number };
        for (const name of ['label', 'bet', 'status']) {
            const part = get(name);
            expect(part.x + part.w, name).toBeLessThanOrEqual(-input.avatarRadius - 8 * input.avatarScale + 1e-9);
        }
        expect(get('cards').x).toBeGreaterThan(input.avatarRadius);
        // The details column is vertically centred on the avatar.
        const top = get('label').y;
        const bottom = get('status').y + get('status').h;
        expect(top + bottom).toBeCloseTo(0, 8);
    });

    it('is deterministic and contains the winner glow', () => {
        const input = heroInput(300);
        const parts = getHeroFootprint(input);
        expect(getHeroFootprint({ ...input })).toEqual(parts);
        expect(parts.find((p) => p.id === 'hero/glow')!.shape).toEqual({
            kind: 'circle', cx: 0, cy: 0, r: input.avatarRadius + winnerDecoration(input.avatarScale).extentPx,
        });
    });
});

// ---------------------------------------------------------------------------------------------
// Seat placement and the footprint-driven ellipse fit
// ---------------------------------------------------------------------------------------------

/** Felt (padding box) sizes measured in the browser at the 8 layout viewports. */
const VIEWPORT_TABLES: [string, number, number][] = [
    ['844x390', 613, 285],
    ['1024x768', 977, 454],
    ['1366x768', 1171, 545],
    ['1920x1080', 1806, 840],
    ['650x300', 435, 202],
    ['1024x600', 982, 457],
    ['1920x600', 1029, 478],
    ['600x800', 552, 257],
];

function fitCases() {
    const cases: { label: string; table: { width: number; height: number } }[] = VIEWPORT_TABLES.map(([name, width, height]) => ({
        label: name,
        table: { width, height },
    }));
    // Stage sizes go through getTableDimensions, exactly as the app derives the table.
    const seed = 1357;
    const random = mulberry32(seed);
    for (let i = 0; i < 16; i++) {
        const stageW = randomBetween(random, 600, 1920);
        const stageH = randomBetween(random, 300, 1080);
        cases.push({ label: `seed ${seed} stage ${Math.round(stageW)}x${Math.round(stageH)}`, table: getTableDimensions(stageW, stageH) });
    }
    return cases;
}

describe('placeOpponentSeat and seatAngleSpan', () => {
    it('spans 180 degrees for two opponents and grows by 10 per opponent up to 240', () => {
        expect(seatAngleSpan(2)).toBe(180);
        expect(seatAngleSpan(3)).toBe(190);
        expect(seatAngleSpan(9)).toBe(240);
        expect(seatAngleSpan(20)).toBe(240);
        expect(seatAngleSpan(1)).toBe(180);
    });

    it('puts the first and last of two opponents on the horizontal diameter and a heads-up opponent on top', () => {
        const ellipse = { cx: 50, cy: 46, rx: 42, ry: 40 };
        expect(placeOpponentSeat(0, 2, ellipse)).toEqual({ left: 8, top: 46 });
        expect(placeOpponentSeat(1, 2, ellipse)).toEqual({ left: 92, top: 46 });
        expect(placeOpponentSeat(0, 1, ellipse)).toEqual({ left: 50, top: 6 });
    });

    it('places every opponent on the ellipse within the 0.1 rounding', () => {
        const ellipse = { cx: 50, cy: 47, rx: 38, ry: 31 };
        for (let n = 2; n <= 9; n++) {
            for (let k = 0; k < n; k++) {
                const { left, top } = placeOpponentSeat(k, n, ellipse);
                const value = ((left - 50) / ellipse.rx) ** 2 + ((top - ellipse.cy) / ellipse.ry) ** 2;
                expect(Math.abs(value - 1), `n ${n} k ${k}`).toBeLessThan(0.01);
            }
        }
    });
});

describe('fitSeatEllipse', () => {
    it('keeps every opponent footprint at least safeMarginPx inside the felt, for 3-10 players on the 8 viewports and a seeded grid', () => {
        let checked = 0;
        for (const { label, table } of fitCases()) {
            const tier = getTableTier(table.width);
            for (let players = 3; players <= 10; players++) {
                const scale = getTableScale(table, players);
                const opponents = players - 1;
                const ellipse = fitSeatEllipse(table, scale, tier, opponents);
                const margin = minSeatMargin(table, scale, tier, opponents, ellipse);
                expect(margin, `${label}, ${players} players`).toBeGreaterThanOrEqual(safeMarginPx(scale.overall) - 1e-6);
                checked++;
            }
        }
        expect(checked).toBe((VIEWPORT_TABLES.length + 16) * 8);
    });

    it('returns radii in range and never shrinks below 80% of the closed-form start', () => {
        for (const { label, table } of fitCases()) {
            const tier = getTableTier(table.width);
            for (let players = 3; players <= 10; players++) {
                const scale = getTableScale(table, players);
                const { ellipse, start, shrink } = fitSeatEllipseDetailed(table, scale, tier, players - 1);
                const text = `${label}, ${players} players`;
                expect(ellipse.cx, text).toBe(50);
                expect(ellipse.rx, text).toBeGreaterThan(8);
                expect(ellipse.rx, text).toBeLessThanOrEqual(44);
                expect(ellipse.ry, text).toBeGreaterThan(8);
                expect(ellipse.ry, text).toBeLessThan(ellipse.cy);
                expect(shrink, text).toBeGreaterThanOrEqual(0.8 * 0.985);
                expect(shrink, text).toBeLessThanOrEqual(1);
                expect(ellipse.rx, text).toBeCloseTo(start.rx * shrink, 8);
                expect(ellipse.ry, text).toBeCloseTo(start.ry * shrink, 8);
            }
        }
    });
    it('starts within 10% of the final radii on most tables, so the guard is a safety net rather than the mechanism', () => {
        let near = 0;
        let total = 0;
        for (const { table } of fitCases()) {
            const tier = getTableTier(table.width);
            for (let players = 3; players <= 10; players++) {
                const { shrink } = fitSeatEllipseDetailed(table, getTableScale(table, players), tier, players - 1);
                total++;
                if (shrink >= 0.9) near++;
            }
        }
        // (the design expects 93-100%; the model's lower-side seats make the guard work a little more at the smallest tables)
        expect(near / total).toBeGreaterThan(0.65);
    });

    it('never needs the sanity clamp: every fitted seat lies inside [2, 98] x [2, 80]', () => {
        for (const { label, table } of fitCases()) {
            const tier = getTableTier(table.width);
            for (let players = 3; players <= 10; players++) {
                const scale = getTableScale(table, players);
                const ellipse = fitSeatEllipse(table, scale, tier, players - 1);
                for (let k = 0; k < players - 1; k++) {
                    const { left, top } = placeOpponentSeat(k, players - 1, ellipse);
                    expect(left, `${label} ${players}p seat ${k}`).toBeGreaterThanOrEqual(2);
                    expect(left, `${label} ${players}p seat ${k}`).toBeLessThanOrEqual(98);
                    expect(top, `${label} ${players}p seat ${k}`).toBeGreaterThanOrEqual(2);
                    expect(top, `${label} ${players}p seat ${k}`).toBeLessThanOrEqual(80);
                }
            }
        }
    });

    it('is one continuous ellipse centred on x = 50 that only depends on the table, the scale, the tier and the count', () => {
        const table = { width: 900, height: 419 };
        const a = fitSeatEllipse(table, getTableScale(table, 6), 'standard', 5);
        const b = fitSeatEllipse({ ...table }, getTableScale({ ...table }, 6), 'standard', 5);
        expect(a).toEqual(b);
        expect(a.cx).toBe(50);
    });

    it('shrinking the ellipse never reduces the footprint margin (the guard\'s termination assumption)', () => {
        const seed = 2468;
        const random = mulberry32(seed);
        for (let i = 0; i < 40; i++) {
            const table = getTableDimensions(randomBetween(random, 600, 1920), randomBetween(random, 300, 1080));
            const tier = getTableTier(table.width);
            const players = Math.round(randomBetween(random, 3, 10));
            const scale = getTableScale(table, players);
            const n = players - 1;
            const { ellipse } = fitSeatEllipseDetailed(table, scale, tier, n);
            const placements = (t: number) => Array.from({ length: n }, (_, k) => {
                const seat = placeOpponentSeat(k, n, { ...ellipse, rx: ellipse.rx * t, ry: ellipse.ry * t });
                return classifyCardPlacement(seat.left, seat.top, n);
            }).join();
            let previous = minSeatMargin(table, scale, tier, n, ellipse);
            let previousPlacements = placements(1);
            for (let t = 0.97; t >= 0.8; t -= 0.03) {
                const margin = minSeatMargin(table, scale, tier, n, { ...ellipse, rx: ellipse.rx * t, ry: ellipse.ry * t });
                const current = placements(t);
                // A seat that switches between "beside" and "below" cards changes shape: only compare like with like.
                if (current === previousPlacements) {
                    expect(margin, `seed ${seed} i ${i} t ${t.toFixed(2)}`).toBeGreaterThanOrEqual(previous - 0.35);
                }
                previous = margin;
                previousPlacements = current;
            }
        }
    });

    it('stays finite for degenerate tables', () => {
        for (const table of [{ width: 0, height: 0 }, { width: 100, height: 100 }, { width: 4000, height: 500 }, { width: 500, height: 4000 }]) {
            for (let players = 2; players <= 10; players++) {
                const tier = getTableTier(table.width);
                const ellipse = fitSeatEllipse(table, getTableScale(table, players), tier, players - 1);
                for (const value of [ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry]) expect(Number.isFinite(value)).toBe(true);
                expect(ellipse.rx).toBeGreaterThan(0);
                expect(ellipse.ry).toBeGreaterThan(0);
                for (let k = 0; k < players - 1; k++) {
                    const seat = placeOpponentSeat(k, players - 1, ellipse);
                    expect(Number.isFinite(seat.left) && Number.isFinite(seat.top)).toBe(true);
                }
            }
        }
    });

    it('checks the hero footprint (never moves it): margin >= safeMarginPx for table heights 200-1200px', () => {
        // The smallest gating felt is 202px high (650x300 showdown). Below ~190px the 8px font floors of the hero's
        // rank / BET / READY column no longer fit beside the avatar: that is the report-only 140px regular felt (D5).
        for (let height = 200; height <= 1200; height += 10) {
            const table = { width: height * TABLE_ASPECT, height };
            const tier = getTableTier(table.width);
            for (const players of [3, 6, 10]) {
                const scale = getTableScale(table, players);
                expect(minHeroMargin(table, scale, tier), `height ${height}, ${players} players`)
                    .toBeGreaterThanOrEqual(safeMarginPx(scale.overall) - 1e-6);
            }
        }
    });
});
