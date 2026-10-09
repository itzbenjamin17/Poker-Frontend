import { describe, expect, it } from 'vitest';
import {
    OPACITY_MIN,
    cardGlyphViolations,
    feltContainmentViolations,
    feltFromRect,
    sampleShape,
    shapeFeltMargin,
} from '../layoutChecks';
import type { CardGlyphMeasurement, FeltEllipse, GlyphMeasurement, PartShape, Rect } from '../layoutChecks';
import { safeMarginPx } from '../tableGeometry';

/**
 * Instrument self-test: synthetic measurements prove that checks G and H fire on defective
 * input and stay silent on clean input, independently of the browser and of the app.
 */

// A 400 x 200 felt centred on the origin: semi-axes 200 and 100.
const felt: FeltEllipse = { cx: 0, cy: 0, a: 200, b: 100 };
const scale = 1; // safeMarginPx = 4, test threshold = 3

const circleAt = (cx: number, cy: number, r: number): PartShape => ({ kind: 'circle', cx, cy, r });

describe('feltFromRect', () => {
    it('turns a padding box into a centred ellipse', () => {
        expect(feltFromRect({ x: 100, y: 50, w: 400, h: 200 })).toEqual({ cx: 300, cy: 150, a: 200, b: 100 });
    });
});

describe('sampleShape', () => {
    it('samples a circle with 24 points on its boundary', () => {
        const points = sampleShape(circleAt(10, 20, 30));
        expect(points).toHaveLength(24);
        for (const p of points) expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(30, 8);
    });

    it('returns the four corners of a rect', () => {
        expect(sampleShape({ kind: 'rect', x: 1, y: 2, w: 10, h: 4 })).toEqual([
            { x: 1, y: 2 },
            { x: 11, y: 2 },
            { x: 11, y: 6 },
            { x: 1, y: 6 },
        ]);
    });

    it('samples both rounded ends of a horizontal pill and never goes past its box', () => {
        const pill: PartShape = { kind: 'pill', x: 0, y: 0, w: 40, h: 10 };
        const points = sampleShape(pill);
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        expect(Math.min(...xs)).toBeCloseTo(0, 8);
        expect(Math.max(...xs)).toBeCloseTo(40, 8);
        expect(Math.min(...ys)).toBeCloseTo(0, 8);
        expect(Math.max(...ys)).toBeCloseTo(10, 8);
        // The rounded cap does not reach the box corner.
        expect(points.some((p) => p.x < 0.5 && p.y < 0.5)).toBe(false);
    });

    it('samples the rounded ends of a vertical pill', () => {
        const points = sampleShape({ kind: 'pill', x: 0, y: 0, w: 10, h: 40 });
        expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 8);
        expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(40, 8);
        expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0, 8);
        expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(10, 8);
    });
});

describe('check G: feltContainmentViolations', () => {
    it('uses a 3px threshold at scale 1 (0.75 x the 4px design margin)', () => {
        expect(0.75 * safeMarginPx(scale)).toBe(3);
    });

    it('fires for a part 1px inside the 3u threshold and is silent just outside it', () => {
        // Circle of radius 10 on the horizontal axis: nearest felt point is the right edge at x = 200.
        const justInside = circleAt(200 - 10 - 2, 0, 10); // 2px margin < 3
        const justOutside = circleAt(200 - 10 - 3.2, 0, 10); // 3.2px margin >= 3
        expect(shapeFeltMargin(justInside, felt)).toBeCloseTo(2, 1);
        expect(shapeFeltMargin(justOutside, felt)).toBeCloseTo(3.2, 1);

        const fired = feltContainmentViolations([{ id: 'seat:p-2/avatar', shape: justInside }], felt, scale);
        expect(fired).toHaveLength(1);
        expect(fired[0]).toMatchObject({ check: 'G', a: 'seat:p-2/avatar', b: 'felt' });
        expect(fired[0].detail).toMatch(/px \(.+u\)/);

        expect(feltContainmentViolations([{ id: 'seat:p-2/avatar', shape: justOutside }], felt, scale)).toEqual([]);
    });

    it('fires for a part that is fully outside the felt, with a larger severity than a shallow one', () => {
        const outside = feltContainmentViolations([{ id: 'out', shape: circleAt(260, 0, 10) }], felt, scale);
        const shallow = feltContainmentViolations([{ id: 'shallow', shape: circleAt(200 - 10 - 2, 0, 10) }], felt, scale);
        expect(outside).toHaveLength(1);
        expect(shallow).toHaveLength(1);
        expect(outside[0].severity).toBeGreaterThan(shallow[0].severity);
        expect(outside[0].detail).toContain('-');
    });

    it('catches a circle whose only violating point is its 45 degree bulge (axis extremes alone would pass)', () => {
        // Round felt of radius 100. A part circle of radius 20 centred 78 out along the diagonal bulges to 98 from the
        // felt centre (2px margin) on the diagonal, while its horizontal and vertical extremes sit at about 93 (7px).
        const round: FeltEllipse = { cx: 0, cy: 0, a: 100, b: 100 };
        const place = (distance: number) => {
            const c = distance / Math.SQRT2;
            return { c, shape: circleAt(c, c, 20) };
        };
        const bad = place(78);
        const axisMargins = [
            100 - Math.hypot(bad.c + 20, bad.c),
            100 - Math.hypot(bad.c - 20, bad.c),
            100 - Math.hypot(bad.c, bad.c + 20),
            100 - Math.hypot(bad.c, bad.c - 20),
        ];
        expect(Math.min(...axisMargins)).toBeGreaterThan(6); // axis extremes alone would pass a 3px threshold
        expect(shapeFeltMargin(bad.shape, round)).toBeCloseTo(2, 0);
        expect(feltContainmentViolations([{ id: 'bulge', shape: bad.shape }], round, scale)).toHaveLength(1);

        // 1.5px further in the bulge clears the threshold again.
        expect(feltContainmentViolations([{ id: 'ok', shape: place(76.5).shape }], round, scale)).toEqual([]);
    });
    it('catches pill and rect corners that stick out while the centre is well inside', () => {
        // A wide rect centred inside the felt: the corners reach the curved edge first.
        const rect: PartShape = { kind: 'rect', x: -150, y: -80, w: 300, h: 160 };
        expect(feltContainmentViolations([{ id: 'wide-rect', shape: rect }], felt, scale)).toHaveLength(1);
        // Bounding-box logic would say it fits (|x| <= 200 and |y| <= 100) - it does not.
        expect(Math.abs(-150) <= 200 && Math.abs(80) <= 100).toBe(true);

        const pill: PartShape = { kind: 'pill', x: 100, y: 60, w: 90, h: 24 };
        expect(feltContainmentViolations([{ id: 'corner-pill', shape: pill }], felt, scale)).toHaveLength(1);

        const smallRect: PartShape = { kind: 'rect', x: -20, y: -10, w: 40, h: 20 };
        expect(feltContainmentViolations([{ id: 'central', shape: smallRect }], felt, scale)).toEqual([]);
    });

    it('scales the threshold with the table scale (2px floor)', () => {
        // 2.4px margin: fails at scale 1 (threshold 3) but passes at scale 0.3 (floor 2px -> threshold 1.5).
        const part = [{ id: 'p', shape: circleAt(200 - 10 - 2.4, 0, 10) }];
        expect(feltContainmentViolations(part, felt, 1)).toHaveLength(1);
        expect(feltContainmentViolations(part, felt, 0.3)).toEqual([]);
    });

    it('reports the part id and a margin in px and u', () => {
        const [violation] = feltContainmentViolations([{ id: 'hero/avatar-glow', shape: circleAt(0, 95, 20) }], felt, 2);
        expect(violation.a).toBe('hero/avatar-glow');
        expect(violation.detail).toMatch(/-?\d+(\.\d+)?px \(-?\d+(\.\d+)?u\)/);
    });
});

describe('check H: cardGlyphViolations', () => {
    const cardRect: Rect = { x: 100, y: 100, w: 40, h: 56 };
    const goodGlyph = (rect: Rect): GlyphMeasurement => ({ rect, fontPx: 10, opacity: 1, topmostCard: 0 });
    const rankRect: Rect = { x: 104, y: 104, w: 8, h: 10 };
    const suitRect: Rect = { x: 104, y: 116, w: 8, h: 9 };

    const makeCard = (overrides: Partial<CardGlyphMeasurement> = {}): CardGlyphMeasurement => ({
        id: 'seat:p-2/card-0',
        index: 0,
        rect: cardRect,
        rank: goodGlyph(rankRect),
        suit: goodGlyph(suitRect),
        ...overrides,
    });

    it('is silent for a clean pair', () => {
        const front = makeCard({
            id: 'seat:p-2/card-1',
            index: 1,
            rect: { x: 120, y: 100, w: 40, h: 56 },
            rank: { rect: { x: 124, y: 104, w: 8, h: 10 }, fontPx: 10, opacity: 1, topmostCard: 1 },
            suit: { rect: { x: 124, y: 116, w: 8, h: 9 }, fontPx: 10, opacity: 1, topmostCard: 1 },
        });
        expect(cardGlyphViolations([makeCard(), front])).toEqual([]);
    });

    it('fires for a glyph covered by another card', () => {
        const violations = cardGlyphViolations([makeCard({ suit: { ...goodGlyph(suitRect), topmostCard: 1 } })]);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ check: 'H', a: 'seat:p-2/card-0/suit' });
        expect(violations[0].detail).toContain('covered by card 1');
    });

    it('fires for a glyph covered by something that is not a card (null owner)', () => {
        const violations = cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), topmostCard: null } })]);
        expect(violations).toHaveLength(1);
        expect(violations[0].a).toBe('seat:p-2/card-0/rank');
        expect(violations[0].detail).toContain('non-card');
    });

    it('fires for a 7.9px font but not for 8px', () => {
        expect(cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), fontPx: 7.9 } })])).toHaveLength(1);
        expect(cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), fontPx: 8 } })])).toEqual([]);
    });

    it('fires for a glyph outside its card', () => {
        const violations = cardGlyphViolations([
            makeCard({ suit: goodGlyph({ x: 104, y: 150, w: 8, h: 14 }) }), // sticks out of the bottom
        ]);
        expect(violations).toHaveLength(1);
        expect(violations[0].detail).toContain('outside');
    });

    it('fires for an effective opacity of .30 and accepts the floor', () => {
        expect(OPACITY_MIN).toBe(0.35);
        expect(cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), opacity: 0.3 } })])).toHaveLength(1);
        expect(cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), opacity: 0.35 } })])).toEqual([]);
        expect(cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), opacity: 0.55 } })])).toEqual([]);
    });

    it('reports rank-only and suit-only failures separately', () => {
        const rankOnly = cardGlyphViolations([makeCard({ rank: { ...goodGlyph(rankRect), topmostCard: 1 } })]);
        expect(rankOnly.map((v) => v.a)).toEqual(['seat:p-2/card-0/rank']);
        const suitOnly = cardGlyphViolations([makeCard({ suit: { ...goodGlyph(suitRect), fontPx: 6 } })]);
        expect(suitOnly.map((v) => v.a)).toEqual(['seat:p-2/card-0/suit']);
    });

    it('fires when a glyph is missing entirely', () => {
        const violations = cardGlyphViolations([makeCard({ suit: null })]);
        expect(violations).toHaveLength(1);
        expect(violations[0].detail).toBe('missing');
    });

    it('reports every failing glyph of every card', () => {
        const rear = makeCard({
            rank: { ...goodGlyph(rankRect), topmostCard: 1 },
            suit: { ...goodGlyph(suitRect), topmostCard: 1 },
        });
        const dimmed = makeCard({
            id: 'seat:p-2/card-1',
            index: 1,
            rank: { rect: rankRect, fontPx: 10, opacity: 0.2, topmostCard: 1 },
            suit: { rect: suitRect, fontPx: 10, opacity: 1, topmostCard: 1 },
        });
        const violations = cardGlyphViolations([rear, dimmed]);
        expect(violations.map((v) => v.a).sort()).toEqual([
            'seat:p-2/card-0/rank',
            'seat:p-2/card-0/suit',
            'seat:p-2/card-1/rank',
        ]);
    });});
