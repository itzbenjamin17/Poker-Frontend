import { MIN_FONT_PX, ellipseInsetDistance, safeMarginPx, sampleShape } from './tableGeometry';
import type { PartShape, Point } from './tableGeometry';

// The footprint model (tableGeometry) and the instrument share these shape definitions.
export { sampleShape };
export type { PartShape, Point };

/**
 * Pure predicates behind the layout spec's checks G (felt containment) and H (card glyph
 * legibility). No DOM, no React: `e2e/layout-overlap.spec.ts` feeds them measurements taken in
 * the browser, and `layoutChecks.test.ts` feeds them synthetic defective measurements to prove
 * the instrument fails on bad input independently of the app.
 */

/** Minimum effective opacity (product over ancestors) for a card glyph to count as visible. */
export const OPACITY_MIN = 0.35;

/** A containment threshold is this fraction of the design margin (the rest absorbs rounding). */
export const TEST_MARGIN_FRACTION = 0.75;

/** Tolerance (px) when deciding that a glyph rect lies inside its card rect. */
const GLYPH_INSIDE_TOLERANCE_PX = 0.5;

export interface Rect { x: number; y: number; w: number; h: number }

/** The felt: an axis-aligned ellipse in page px (centre and semi-axes). */
export interface FeltEllipse { cx: number; cy: number; a: number; b: number }

export interface ShapePart {
    /** e.g. `seat:p-4/hand-rank`, `hero/avatar-glow`. */
    id: string;
    shape: PartShape;
}

export interface LayoutViolation {
    check: 'G' | 'H';
    a: string;
    b: string;
    detail: string;
    severity: number;
}

/** The felt ellipse of a measured padding box. */
export function feltFromRect(rect: Rect): FeltEllipse {
    return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, a: rect.w / 2, b: rect.h / 2 };
}

/** Smallest signed distance (px, positive inside) from any extreme point of `shape` to the felt edge. */
export function shapeFeltMargin(shape: PartShape, felt: FeltEllipse): number {
    let min = Infinity;
    for (const p of sampleShape(shape)) {
        const d = ellipseInsetDistance({ x: p.x - felt.cx, y: p.y - felt.cy }, felt.a, felt.b);
        if (d < min) min = d;
    }
    return min;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Check G. A part violates when any extreme point is closer to the felt edge than 0.75 x
 * `safeMarginPx(scale)` (negative = outside). `scaleOverall` is the table's `--table-scale`.
 */
export function feltContainmentViolations(
    parts: ShapePart[],
    felt: FeltEllipse,
    scaleOverall: number,
): LayoutViolation[] {
    const scale = scaleOverall > 0 ? scaleOverall : 1;
    const threshold = TEST_MARGIN_FRACTION * safeMarginPx(scale);
    const violations: LayoutViolation[] = [];
    for (const part of parts) {
        const margin = shapeFeltMargin(part.shape, felt);
        if (margin >= threshold) continue;
        violations.push({
            check: 'G',
            a: part.id,
            b: 'felt',
            detail: `${round1(margin)}px (${round1(margin / scale)}u) < ${round1(threshold)}px (${round1(threshold / scale)}u)`,
            severity: Math.max(1, (threshold - margin) * 50),
        });
    }
    return violations;
}

export interface GlyphMeasurement {
    rect: Rect;
    /** Computed font size (px). */
    fontPx: number;
    /** Product of the computed opacity of the glyph and every ancestor up to the card. */
    opacity: number;
    /** Index of the card that owns the topmost element at the glyph centre; null if none of the seat's cards. */
    topmostCard: number | null;
}

export interface CardGlyphMeasurement {
    /** e.g. `seat:p-3/card-0`. */
    id: string;
    /** Card index within its seat. */
    index: number;
    rect: Rect;
    rank: GlyphMeasurement | null;
    suit: GlyphMeasurement | null;
}

const rectInside = (inner: Rect, outer: Rect, tolerance: number) =>
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance;

/**
 * Check H. For every revealed opponent card, both the rank and the suit glyph must be at least
 * `MIN_FONT_PX`, lie inside the card, be the topmost element at their centre (not covered by
 * another card or element) and not be dimmed below `OPACITY_MIN`.
 */
export function cardGlyphViolations(cards: CardGlyphMeasurement[]): LayoutViolation[] {
    const violations: LayoutViolation[] = [];
    for (const card of cards) {
        for (const [name, glyph] of [['rank', card.rank], ['suit', card.suit]] as const) {
            const id = `${card.id}/${name}`;
            const push = (detail: string, severity: number) =>
                violations.push({ check: 'H', a: id, b: 'glyph', detail, severity });

            if (!glyph) {
                push('missing', 1000);
                continue;
            }
            if (glyph.fontPx < MIN_FONT_PX - 0.01) {
                push(`font ${round1(glyph.fontPx)}px<${MIN_FONT_PX}px`, (MIN_FONT_PX - glyph.fontPx) * 100);
            }
            if (!rectInside(glyph.rect, card.rect, GLYPH_INSIDE_TOLERANCE_PX)) {
                push('outside its card', 600);
            }
            if (glyph.topmostCard !== card.index) {
                push(
                    glyph.topmostCard === null
                        ? 'covered by a non-card element'
                        : `covered by card ${glyph.topmostCard}`,
                    900,
                );
            }
            if (glyph.opacity < OPACITY_MIN) {
                push(`opacity ${Math.round(glyph.opacity * 100) / 100}<${OPACITY_MIN}`, 400);
            }
        }
    }
    return violations;
}
