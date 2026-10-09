import type { SeatPosition, TableTier } from '../types';

/** Single source of truth for the table's width:height ratio. */
export const TABLE_ASPECT = 2.15;

/** Stage size assumed while the stage is unmeasured (jsdom, first frame). */
export const FALLBACK_STAGE = { width: 1024, height: 600 } as const;

/** Table height at which the UI scale is 1. */
export const BASE_TABLE_HEIGHT = 430;
/** Lowest overall scale (D5): a table shorter than ~129px is held here, e.g. tiny viewports with the action dock open. */
export const SCALE_FLOOR = 0.3;
export const SCALE_CEILING = 1.15;

/** Smallest font size (px) that is ever rendered inside the table. */
export const MIN_FONT_PX = 8;

/** Card width (px) at scale 1 and size multiplier 1 (see CardUI). */
export const CARD_BASE_WIDTH = 48;

/**
 * Narrowest opponent card (px) the scale model produces. A compact card face
 * (rank above suit at the 8px font floor) still fits at this width.
 */
export const MIN_CARD_WIDTH_PX = 18;

export type CardSize = 'sm' | 'md' | 'lg';

/**
 * Relative multiplier based on semantic card role (CardUI):
 * 'sm': 0.8x, 'md' (standard / community / opponent): 1.0x, 'lg' (hero cards): 1.1x
 */
export const CARD_SIZE_MULTIPLIER: Record<CardSize, number> = { sm: 0.8, md: 1.0, lg: 1.1 };

/**
 * True when the corner index of the regular card face would drop below the
 * font floor, i.e. the card should render the compact face instead.
 */
export function isCompactCardScale(scale: number, size: CardSize = 'md'): boolean {
    return Math.round(scale * CARD_SIZE_MULTIPLIER[size] * 12) < MIN_FONT_PX;
}

/**
 * Below this overall scale (table shorter than ~215px) there is no room for opponent hand-rank labels,
 * so they are kept for screen readers and the expanded seat panel only.
 */
export const OPPONENT_RANK_MIN_SCALE = 0.5;

export type AvatarSize = 'xs' | 'sm' | 'md';

const AVATAR_BASE_DIAMETER: Record<AvatarSize, number> = { xs: 48, sm: 64, md: 80 };

/** Avatar diameter in px. PlayerPod renders it and the seats anchor cards to half of it. */
export function avatarDiameter(size: AvatarSize, scale: number): number {
    return scale * AVATAR_BASE_DIAMETER[size];
}

export interface TableDimensions {
    width: number;
    height: number;
}

export interface TableScale {
    overall: number;
    avatar: number;
    heroCard: number;
    opponentCard: number;
    text: number;
    badge: number;
    spacing: number;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Largest TABLE_ASPECT rectangle that fits into the measured stage, keeping an
 * inset on every side. This is the only place the table size is computed.
 */
export function getTableDimensions(stageWidth: number, stageHeight: number): TableDimensions {
    const inset = Math.min(32, Math.max(8, Math.min(stageWidth, stageHeight) * 0.04));
    const availableWidth = Math.max(0, stageWidth - inset * 2);
    const availableHeight = Math.max(0, stageHeight - inset * 2);

    let width = availableWidth;
    let height = width / TABLE_ASPECT;
    if (height > availableHeight) {
        height = availableHeight;
        width = height * TABLE_ASPECT;
    }
    return { width, height };
}

/** Content-density tier, derived from the TABLE width (never the window). */
export function getTableTier(tableWidth: number): TableTier {
    if (tableWidth < 720) return 'compact';
    if (tableWidth >= 1100) return 'wide';
    return 'standard';
}

/**
 * Density factor applied to opponents only; crowded tables get smaller seats so the seat footprint, the 4u
 * felt margin and the board all fit (D1). Never above 1 and never increasing with the player count.
 */
export function getDensity(playerCount: number): number {
    if (playerCount >= 10) return 0.7;
    if (playerCount >= 9) return 0.76;
    if (playerCount >= 8) return 0.78;
    if (playerCount >= 7) return 0.8;
    return 1;
}

export function getTableScale(tableDimensions: TableDimensions, playerCount: number): TableScale {
    const overall = clamp(tableDimensions.height / BASE_TABLE_HEIGHT, SCALE_FLOOR, SCALE_CEILING);
    const tier = getTableTier(tableDimensions.width);
    const density = getDensity(playerCount);
    const opponentCardFactor = tier === 'compact' ? 0.65 : 0.78;
    // Opponent cards are rendered with CardUI size 'md' (multiplier 1): the role
    // factor lives here, so the card width is opponentCard * CARD_BASE_WIDTH.
    const opponentCardFloor = MIN_CARD_WIDTH_PX / CARD_BASE_WIDTH;

    return {
        overall,
        avatar: overall * density,
        heroCard: overall,
        opponentCard: Math.max(overall * opponentCardFactor * density, opponentCardFloor),
        text: overall,
        badge: overall,
        spacing: overall,
    };
}

/** Font size in px for a base size, never below the readability floor. */
export function fontPx(base: number, textScale: number): number {
    return Math.max(MIN_FONT_PX, Math.round(base * textScale));
}

/** Design margin (in scale units) between any seat part and the felt edge. */
export const SAFE_MARGIN_UNITS = 4;

/** Safe margin in px at an overall table scale: `max(2, 4 * scale)`, never zero. */
export function safeMarginPx(scale: number): number {
    return Math.max(2, SAFE_MARGIN_UNITS * scale);
}

/**
 * Exact signed distance from a point to the boundary of an axis-aligned ellipse,
 * positive inside, negative outside, zero on the boundary. `p` is relative to the
 * ellipse centre, `a` and `b` are the semi-axes (x and y).
 *
 * Iterative closest-point method (8 iterations) in the first quadrant. This is the
 * single containment predicate for the seat fit, the unit tests and the Node side of
 * the e2e check. It is NOT a bounding-rectangle test: the corners of a rectangle that
 * sit inside the ellipse's bounding box can still be far outside the ellipse.
 */
export function ellipseInsetDistance(p: { x: number; y: number }, a: number, b: number): number {
    if (!(a > 0) || !(b > 0)) return -Math.hypot(p.x, p.y);

    const px = Math.abs(p.x);
    const py = Math.abs(p.y);
    const inside = (px / a) ** 2 + (py / b) ** 2 < 1;

    let tx = Math.SQRT1_2;
    let ty = Math.SQRT1_2;
    for (let i = 0; i < 8; i++) {
        const x = a * tx;
        const y = b * ty;
        const ex = ((a * a - b * b) * tx ** 3) / a;
        const ey = ((b * b - a * a) * ty ** 3) / b;
        const rx = x - ex;
        const ry = y - ey;
        const qx = px - ex;
        const qy = py - ey;
        const r = Math.hypot(rx, ry);
        const q = Math.hypot(qx, qy);
        if (q === 0) break;
        tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / a));
        ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / b));
        const t = Math.hypot(tx, ty);
        tx /= t;
        ty /= t;
    }

    const distance = Math.hypot(px - a * tx, py - b * ty);
    return inside ? distance : -distance;
}

// ---------------------------------------------------------------------------------------------
// Winner decoration and the opponent card fan (shared by the components and the seat footprint)
// ---------------------------------------------------------------------------------------------

/** Gold of the winner ring (`gold-secondary` at 80%) and of the winner glow, as they were in the Tailwind classes. */
const WINNER_RING_COLOR = 'rgba(252, 192, 37, 0.8)';
const WINNER_GLOW_COLOR = 'rgba(252, 211, 77, 0.3)';
/** Felt-coloured gap between the avatar and the gold ring (the old `ring-offset-surface`). */
const WINNER_RING_GAP_COLOR = 'rgb(14, 14, 14)';

export interface WinnerDecoration {
    /** Felt-coloured gap between the avatar edge and the gold ring. */
    ringOffsetPx: number;
    /** Width of the gold ring. */
    ringWidthPx: number;
    /** Blur radius of the glow. */
    glowBlurPx: number;
    /** Ring total (offset + width): how far the ring reaches beyond the avatar edge. */
    ringExtentPx: number;
    /** How far the decoration paints beyond the avatar edge: the larger of the ring and the glow (the glow's blur reaches glowBlurPx). */
    extentPx: number;
    /** The `box-shadow` that paints it (ring gap, gold ring, glow). */
    boxShadow: string;
}

/**
 * Winner ring and glow for an avatar at `scale`. Both scale with the table (they used to be fixed 5px and 18px,
 * which is 38u on the smallest tables), and the component and the seat footprint share this one definition.
 */
export function winnerDecoration(scale: number): WinnerDecoration {
    const ringOffsetPx = Math.max(1, Math.round(2 * scale));
    const ringWidthPx = Math.max(1, Math.round(2 * scale));
    const glowBlurPx = Math.max(4, Math.round(8 * scale));
    const ringExtentPx = ringOffsetPx + ringWidthPx;
    return {
        ringOffsetPx,
        ringWidthPx,
        glowBlurPx,
        ringExtentPx,
        extentPx: Math.max(ringExtentPx, glowBlurPx),
        boxShadow: [
            `0 0 0 ${ringOffsetPx}px ${WINNER_RING_GAP_COLOR}`,
            `0 0 0 ${ringExtentPx}px ${WINNER_RING_COLOR}`,
            `0 0 ${glowBlurPx}px ${WINNER_GLOW_COLOR}`,
        ].join(', '),
    };
}

/**
 * Horizontal strip (px) of the rear opponent card that the front card leaves uncovered, so the rear card's
 * corner index (rank over suit) is always visible. Used for face-down cards too, so revealing never moves the stack.
 */
export function cardFanStrip(cardWidthPx: number, compactFace: boolean): number {
    return compactFace ? 12 : Math.max(18, Math.round(0.47 * cardWidthPx));
}

export interface CornerIndexMetrics {
    rankFontPx: number;
    suitFontPx: number;
    /** Padding between the card edge and the index. */
    paddingPx: number;
    /** Width of the index block including the padding, assuming the widest rank ("10"). */
    widthPx: number;
    /** Height of the index block including the padding (rank above suit, line-height 1). */
    heightPx: number;
}

/** Em-width estimates of the bold rank digits ("10" is the widest rank) and of the suit symbol. */
const RANK_CHAR_EM = 0.62;
const SUIT_EM = 0.85;

/**
 * Size of the corner index (rank over suit at the top-left) of a card face at card scale `cardScale`
 * (`scale * size multiplier`, as CardUI computes it). Fonts never drop below the 8px floor, so the compact
 * face (cards narrower than 30px) uses tighter padding to keep the block inside the 12px strip.
 */
export function cornerIndexMetrics(cardScale: number, compactFace: boolean): CornerIndexMetrics {
    const rankFontPx = fontPx(12, cardScale);
    const suitFontPx = fontPx(10, cardScale);
    const paddingPx = compactFace ? Math.max(1, Math.round(2 * cardScale)) : Math.round(4 * cardScale);
    return {
        rankFontPx,
        suitFontPx,
        paddingPx,
        widthPx: paddingPx + Math.max(2 * RANK_CHAR_EM * rankFontPx, SUIT_EM * suitFontPx),
        heightPx: paddingPx + rankFontPx + suitFontPx,
    };
}

// ---------------------------------------------------------------------------------------------
// Seat classification (shared by useSeatLayout and the seat footprint / ellipse fit)
// ---------------------------------------------------------------------------------------------

/** From this many opponents on, top-centre seats put their cards below the avatar. */
export const CROWDED_OPPONENT_COUNT = 6;
/** Seats whose left is within this many % of the centre line count as top-centre. */
export const CENTRE_BAND = 14;

/** Panel placement, side and vertical zone from a seat's own coordinates (percent of the table). */
export function describeSeat(left: number, top: number): Pick<SeatPosition, 'panelPlacement' | 'side' | 'verticalZone'> {
    return {
        panelPlacement: left < 30 ? 'left' : left > 70 ? 'right' : 'centre',
        side: left < 45 ? 'left' : left > 55 ? 'right' : 'centre',
        verticalZone: top < 35 ? 'top' : top > 65 ? 'bottom' : 'middle',
    };
}

/**
 * Hole cards face into the table. On a crowded table the seats along the top centre would face each other,
 * so their cards go below the avatar.
 */
export function classifyCardPlacement(left: number, top: number, opponentCount: number): SeatPosition['cardPlacement'] {
    return opponentCount >= CROWDED_OPPONENT_COUNT && Math.abs(left - 50) <= CENTRE_BAND && top < 35
        ? 'below'
        : left <= 50 ? 'right' : 'left';
}

/**
 * The hand-rank label goes under the cards for seats whose cards sit beside the avatar and which are not on the
 * centre line. Cards-below seats, centre seats (heads-up included) and the hero keep it with the avatar.
 */
export function classifyLabelPlacement(
    cardPlacement: SeatPosition['cardPlacement'],
    side: SeatPosition['side'],
): SeatPosition['labelPlacement'] {
    return (cardPlacement === 'left' || cardPlacement === 'right') && side !== 'centre' ? 'cards' : 'avatar';
}

// ---------------------------------------------------------------------------------------------
// Part shapes (shared by the seat footprint and the layout instrument)
// ---------------------------------------------------------------------------------------------

export interface Point { x: number; y: number }

export type PartShape =
    | { kind: 'circle'; cx: number; cy: number; r: number }
    /** Stadium: fully rounded ends, radius = min(w, h) / 2. */
    | { kind: 'pill'; x: number; y: number; w: number; h: number }
    | { kind: 'rect'; x: number; y: number; w: number; h: number };

const CIRCLE_SAMPLES = 24;
const CAP_SAMPLES = 12;

/**
 * Extreme points of a part. The signed distance to a convex set is concave, so for a convex part
 * the minimum margin is attained on its boundary: corners for a rect, the two end caps for a pill
 * and a sampled circle (24 points, at most 0.9% of the radius below the true bulge).
 */
export function sampleShape(shape: PartShape): Point[] {
    if (shape.kind === 'circle') {
        return Array.from({ length: CIRCLE_SAMPLES }, (_, k) => {
            const theta = (k / CIRCLE_SAMPLES) * Math.PI * 2;
            return { x: shape.cx + shape.r * Math.cos(theta), y: shape.cy + shape.r * Math.sin(theta) };
        });
    }
    if (shape.kind === 'rect') {
        return [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.w, y: shape.y },
            { x: shape.x + shape.w, y: shape.y + shape.h },
            { x: shape.x, y: shape.y + shape.h },
        ];
    }

    // Pill: two semicircular caps along the longer side.
    const r = Math.min(shape.w, shape.h) / 2;
    const horizontal = shape.w >= shape.h;
    const points: Point[] = [];
    const capCentres = horizontal
        ? [
            { c: { x: shape.x + r, y: shape.y + shape.h / 2 }, from: Math.PI / 2 },
            { c: { x: shape.x + shape.w - r, y: shape.y + shape.h / 2 }, from: -Math.PI / 2 },
        ]
        : [
            { c: { x: shape.x + shape.w / 2, y: shape.y + r }, from: Math.PI },
            { c: { x: shape.x + shape.w / 2, y: shape.y + shape.h - r }, from: 0 },
        ];
    for (const { c, from } of capCentres) {
        for (let k = 0; k <= CAP_SAMPLES; k++) {
            const theta = from + (k / CAP_SAMPLES) * Math.PI;
            points.push({ x: c.x + r * Math.cos(theta), y: c.y + r * Math.sin(theta) });
        }
    }
    return points;
}

// ---------------------------------------------------------------------------------------------
// Seat metrics and footprint
//
// The footprint is every part a seat can ever show, relative to the avatar centre (the seat anchor), in px,
// y down. It is worst-case static: the winner decoration, the longest label, a 14 character BET, a two line
// reconnect status, every badge and the tilted face-down stack are always included, and nothing depends on
// game state, so seats never move when somebody wins or bets. The sizes mirror the DOM (calibrated against
// measurements: 1.5em line height, 2px borders, 0.62em label glyphs, 0.53em BET glyphs).
// ---------------------------------------------------------------------------------------------

const LINE_HEIGHT_EM = 1.5;
const BORDER_PX = 2;
const LABEL_GLYPH_EM = 0.62;
const BET_GLYPH_EM = 0.53;
const BET_MAX_CHARS = 14;
const STATUS_GLYPH_EM = 0.65;
/** "Reconnect in 04:59": the longest status text. */
const STATUS_MAX_CHARS = 18;
const CHIP_TEXT_EM = 3.6; // six characters, e.g. "12,450"
const BLIND_TEXT_EM = 1.45; // "BB"
const OFF_TEXT_EM = 2.1; // "OFF"
/** The status text wraps within this many avatar radii ... */
export const STATUS_MAX_WIDTH_RADII = 2.4;
/** ... but never narrower than this many ems: the longest word ("RECONNECT") must fit, so the text wraps to two lines ("RECONNECT / IN 04:59") on tiny seats. */
export const STATUS_MIN_MAX_WIDTH_EM = 6.5;
/** Width of the longest status text on one line, in ems (measured: 11.7em for "RECONNECT IN 04:58"). */
const STATUS_TEXT_EM = STATUS_MAX_CHARS * STATUS_GLYPH_EM;

/** `max-width` (px) of the seat status text: 2.4 avatar radii, at least 8.6em. PlayerStatus and the footprint share it. */
export function statusMaxWidthPx(avatarRadius: number, statusFontPx: number): number {
    return Math.max(STATUS_MAX_WIDTH_RADII * avatarRadius, STATUS_MIN_MAX_WIDTH_EM * statusFontPx);
}

/** Size of the status text box in its worst case ("Reconnect in 04:59"): the wrapped box, at most two lines. */
export function statusBoxSize(avatarRadius: number, textScale: number): { width: number; height: number } {
    const font = fontPx(9, textScale);
    const maxWidth = statusMaxWidthPx(avatarRadius, font);
    const textWidth = STATUS_TEXT_EM * font;
    // Height is modelled as ONE line: the long reconnect text wraps to a second line only on avatars smaller than ~50px, and a
    // second line of 8-10px text under BET is not worth the room it would cost every seat (BET and status already hang
    // under the avatar). A wrapped second line is measured by the e2e containment check, not budgeted by the fit.
    return { width: Math.min(textWidth, maxWidth), height: LINE_HEIGHT_EM * font };
}
/** Rotation of the face-down cards is +-6 degrees: the bounding box grows by sin(6deg) of the other dimension. */
const TILT_EM = 0.105;

/** Characters the seat label may use: the ladder of `formatHandRankShort`. */
export function labelCharBudget(tier: TableTier): number {
    return tier === 'compact' ? 9 : 11;
}

/** The compact label style (tighter padding, narrower tracking) is used on compact tables and under the cards. */
export function usesCompactLabelStyle(tier: TableTier, cardPlacement: SeatPosition['cardPlacement']): boolean {
    return tier === 'compact' || cardPlacement === 'below';
}

export interface LabelSize { width: number; height: number; fontPx: number }

/** Outer size of the hand-rank label (`PlayerHandRank`) holding `chars` characters. */
export function handRankLabelSize(chars: number, avatarScale: number, textScale: number, compactStyle: boolean): LabelSize {
    const font = fontPx(9, textScale);
    const tracking = compactStyle ? 0.05 : 0.1;
    const padX = avatarScale * (compactStyle ? 3 : 8);
    const padY = avatarScale * (compactStyle ? 2 : 4);
    return {
        width: chars * (LABEL_GLYPH_EM + tracking) * font + 2 * padX + BORDER_PX,
        height: LINE_HEIGHT_EM * font + 2 * padY + BORDER_PX,
        fontPx: font,
    };
}

export interface SeatMetricsInput {
    /** Avatar radius (px). */
    avatarRadius: number;
    /** Avatar scale: badges, label padding and the gap below the avatar follow it. */
    avatarScale: number;
    /** Spacing scale: card offsets and gaps follow it. */
    spacingScale: number;
    /** `tableScale.opponentCard`. */
    cardScale: number;
    /** True when the cards use the compact face (`isCompactCardScale`). */
    compactFace: boolean;
}

export interface SeatMetrics {
    radius: number;
    cardWidth: number;
    cardHeight: number;
    /** Part of the rear card the front card leaves uncovered. */
    strip: number;
    stackWidth: number;
    /** Distance from the avatar centre to the near edge of the card stack (side seats). */
    xOffset: number;
    /** Gap between the card stack and the label row below it. */
    gapRow: number;
    /** Gap between the avatar and the label row. */
    gapAvatar: number;
    /** Growth of the face-down stack's bounding box caused by the tilt and the drop of the second card. */
    tiltExtraWidth: number;
    tiltExtraHeight: number;
    /** How far the face-down stack reaches below the upright card bottom (half the tilt growth plus the 3 sc drop of the second card). */
    tiltBottomExtra: number;
    /** Label row of a side seat, in px from the avatar centre / seat root: where it starts, how wide it is, its top (from the root top). */
    labelRowStart: number;
    labelRowWidth: number;
    labelRowTop: number;
    /** Cards-below seats: gap between the avatar and the cards, and where the details start under the cards. */
    belowGap: number;
    belowDetailsOffsetTop: number;
}

/** The offsets that OpponentSeats positions things with; the footprint uses the very same numbers. */
export function getSeatMetrics(input: SeatMetricsInput): SeatMetrics {
    const { avatarRadius: radius, avatarScale: sa, spacingScale: sp, cardScale, compactFace } = input;
    const cardWidth = Math.round(cardScale * CARD_BASE_WIDTH);
    const cardHeight = Math.round(cardScale * 64);
    const strip = cardFanStrip(cardWidth, compactFace);
    const stackWidth = cardWidth + strip;
    const xOffset = radius + sp * 8 + (compactFace ? Math.round(sp * 4) : 4);
    const gapRow = Math.max(2, Math.round(3 * sp));
    const gapAvatar = Math.max(2, Math.round(2 * sp));
    const tiltExtraWidth = TILT_EM * cardHeight;
    const tiltExtraHeight = TILT_EM * cardWidth + 3 * cardScale;
    const belowGap = Math.max(2, Math.round(5.0 * sp));
    const tiltBottomExtra = (TILT_EM * cardWidth) / 2 + 3 * cardScale;
    const belowLabelTop = radius + belowGap + cardHeight + Math.ceil(tiltBottomExtra) + gapRow;
    const labelRowStart = radius + gapAvatar;
    return {
        radius,
        cardWidth,
        cardHeight,
        strip,
        stackWidth,
        xOffset,
        gapRow,
        gapAvatar,
        tiltExtraWidth,
        tiltExtraHeight,
        tiltBottomExtra,
        labelRowStart,
        labelRowWidth: Math.max(0, 2 * (xOffset + stackWidth / 2 - labelRowStart)),
        labelRowTop: radius + cardHeight / 2 + gapRow,
        belowGap,
        belowDetailsOffsetTop: Math.max(0, Math.round(belowLabelTop - (radius + 8 * sa))),
    };
}

export interface FootprintPart { id: string; shape: PartShape }

export interface SeatFootprintInput extends SeatMetricsInput {
    avatarSize: AvatarSize;
    textScale: number;
    cardPlacement: SeatPosition['cardPlacement'];
    labelPlacement: SeatPosition['labelPlacement'];
    tier: TableTier;
    /** False when the label is screen-reader only (small tables) or has been dropped by the label budget. */
    showLabel: boolean;
    /** Face-down cards are tilted; revealed ones are upright. The static footprint uses face-down. */
    faceDown?: boolean;
}

const rectPart = (id: string, x0: number, y0: number, x1: number, y1: number): FootprintPart => ({
    id,
    shape: { kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
});

/** BET, status and the (optional) label that hang under the avatar, in the order PlayerPod stacks them. */
function hangingDetails(
    id: string,
    centreX: number,
    top: number,
    input: Pick<SeatFootprintInput, 'avatarRadius' | 'avatarScale' | 'textScale'>,
    label: LabelSize | null,
): FootprintPart[] {
    const parts: FootprintPart[] = [];
    const font = fontPx(9, input.textScale);
    let y = top;
    if (label) {
        parts.push(rectPart(`${id}/label`, centreX - label.width / 2, y, centreX + label.width / 2, y + label.height));
        y += label.height + 4 * input.avatarScale;
    }
    const betWidth = BET_MAX_CHARS * BET_GLYPH_EM * font;
    parts.push(rectPart(`${id}/bet`, centreX - betWidth / 2, y, centreX + betWidth / 2, y + LINE_HEIGHT_EM * font));
    y += LINE_HEIGHT_EM * font;
    const status = statusBoxSize(input.avatarRadius, input.textScale);
    parts.push(rectPart(`${id}/status`, centreX - status.width / 2, y, centreX + status.width / 2, y + status.height));
    return parts;
}

/** Parts that every avatar can carry: the disc, the winner decoration and the badges pinned to it. */
function avatarParts(id: string, radius: number, sa: number, textScale: number, avatarSize: AvatarSize): FootprintPart[] {
    const decoration = winnerDecoration(sa);
    const chipFont = fontPx(avatarSize === 'sm' ? 8 : 9, textScale);
    const chipWidth = CHIP_TEXT_EM * chipFont + 12 * sa + BORDER_PX;
    const chipHeight = LINE_HEIGHT_EM * chipFont + 4 * sa + BORDER_PX;
    const blindFont = fontPx(9, textScale);
    const blindWidth = BLIND_TEXT_EM * blindFont + 12 * sa + BORDER_PX;
    const blindHeight = LINE_HEIGHT_EM * blindFont + 4 * sa + BORDER_PX;
    const offFont = fontPx(8, textScale);
    const offWidth = OFF_TEXT_EM * offFont + 12 * sa + BORDER_PX;
    const offHeight = LINE_HEIGHT_EM * offFont + 4 * sa + BORDER_PX;
    const crownRadius = 9 * sa;
    return [
        { id: `${id}/avatar`, shape: { kind: 'circle', cx: 0, cy: 0, r: radius } },
        { id: `${id}/glow`, shape: { kind: 'circle', cx: 0, cy: 0, r: radius + decoration.extentPx } },
        { id: `${id}/crown`, shape: { kind: 'circle', cx: radius + 4 - crownRadius, cy: -radius - 4 + crownRadius, r: crownRadius } },
        { id: `${id}/turn`, shape: { kind: 'circle', cx: radius - 4 * sa, cy: -radius + 4 * sa, r: 8 * sa } },
        { id: `${id}/chip`, shape: { kind: 'pill', x: -chipWidth / 2, y: radius + 6 * sa - chipHeight, w: chipWidth, h: chipHeight } },
        { id: `${id}/blind`, shape: { kind: 'pill', x: -radius - 8 * sa, y: -radius - 8 * sa, w: blindWidth, h: blindHeight } },
        { id: `${id}/offline`, shape: { kind: 'pill', x: radius + 4 * sa - offWidth, y: -radius - 4 * sa, w: offWidth, h: offHeight } },
    ];
}

/**
 * Every part an opponent seat can show, relative to the avatar centre. Side seats put the card stack beside the
 * avatar (mirrored for `left`), the hand-rank label in its own row under the stack and BET / status under the
 * avatar; cards-below seats stack avatar, cards, label, BET and status in one column.
 */
export function getSeatFootprint(input: SeatFootprintInput): FootprintPart[] {
    const id = 'seat';
    const metrics = getSeatMetrics(input);
    const { avatarRadius: radius, avatarScale: sa } = input;
    const faceDown = input.faceDown ?? true;
    const parts = avatarParts(id, radius, sa, input.textScale, input.avatarSize);

    const compactStyle = usesCompactLabelStyle(input.tier, input.cardPlacement);
    const label = input.showLabel ? handRankLabelSize(labelCharBudget(input.tier), sa, input.textScale, compactStyle) : null;
    const tiltW = faceDown ? metrics.tiltExtraWidth : 0;
    const tiltH = faceDown ? metrics.tiltExtraHeight : 0;
    const { cardHeight, stackWidth } = metrics;

    if (input.cardPlacement === 'below') {
        const top = radius + metrics.belowGap;
        parts.push(rectPart(`${id}/cards`, -stackWidth / 2 - tiltW / 2, top, stackWidth / 2 + tiltW / 2, top + cardHeight + tiltH));
        const detailsTop = radius + 8 * sa + metrics.belowDetailsOffsetTop;
        parts.push(...hangingDetails(id, 0, detailsTop, input, label));
        return parts;
    }

    const sign = input.cardPlacement === 'left' ? -1 : 1;
    // Near / far edge of the stack (the tilted face-down cards overhang by half the growth on each side).
    const lo = metrics.xOffset - tiltW / 2;
    const hi = metrics.xOffset + stackWidth + tiltW / 2;
    parts.push(rectPart(`${id}/cards`, sign > 0 ? lo : -hi, -cardHeight / 2 - tiltH / 2, sign > 0 ? hi : -lo, cardHeight / 2 + tiltH / 2));

    if (input.labelPlacement === 'cards') {
        // BET and status take the first slot under the avatar; the label sits under the cards, centred on the stack.
        parts.push(...hangingDetails(id, 0, radius + 8 * sa, input, null));
        if (label) {
            const stackCentre = metrics.xOffset + stackWidth / 2;
            const start = Math.max(metrics.labelRowStart, stackCentre - label.width / 2);
            const top = metrics.labelRowTop - radius;
            const a = sign * start;
            const b = sign * (start + label.width);
            parts.push(rectPart(`${id}/label`, Math.min(a, b), top, Math.max(a, b), top + label.height));
        }
    } else {
        parts.push(...hangingDetails(id, 0, radius + 8 * sa, input, label));
    }
    return parts;
}

/** The sampled extreme points of a footprint. */
export function footprintPoints(parts: FootprintPart[]): Point[] {
    return parts.flatMap((part) => sampleShape(part.shape));
}

export interface HeroFootprintInput {
    avatarRadius: number;
    /** The hero's avatar follows the overall scale (never thinned by density). */
    avatarScale: number;
    textScale: number;
    spacingScale: number;
    avatarSize: AvatarSize;
    /** `tableScale.heroCard`. */
    cardScale: number;
    compactFace: boolean;
}

/** Characters assumed for the hero's full hand-rank text ("ROYAL FLUSH"). */
const HERO_LABEL_CHARS = 11;
/** Width of "READY" in ems (measured 3.67em). */
const HERO_STATUS_TEXT_EM = 3.7;

/**
 * Everything the hero seat can show. The hero is pinned at (50%, 86%), so this is checked, never fitted: rank, BET and
 * status stack to the left of the avatar (vertically centred on it), the two lg cards sit to the right.
 */
export function getHeroFootprint(input: HeroFootprintInput): FootprintPart[] {
    const id = 'hero';
    const { avatarRadius: radius, avatarScale: sa, textScale: st, spacingScale: sp } = input;
    const parts = avatarParts(id, radius, sa, st, input.avatarSize);

    const cardWidth = Math.round(input.cardScale * CARD_SIZE_MULTIPLIER.lg * CARD_BASE_WIDTH);
    const cardHeight = Math.round(input.cardScale * CARD_SIZE_MULTIPLIER.lg * 64);
    const x0 = radius + sp * 16 + 4;
    parts.push(rectPart(`${id}/cards`, x0, -cardHeight / 2, x0 + 2 * cardWidth + input.cardScale * 4, cardHeight / 2));

    // Details column, right-aligned against the avatar with an 8 sa gap, vertically centred.
    const label = handRankLabelSize(HERO_LABEL_CHARS, sa, st, false);
    const font = fontPx(9, st);
    const betWidth = BET_MAX_CHARS * BET_GLYPH_EM * font;
    // The hero never sees themselves as disconnected (the table is covered by the reconnect overlay), so the longest
    // hero status is the single line "READY".
    const statusWidth = HERO_STATUS_TEXT_EM * font;
    const betHeight = LINE_HEIGHT_EM * font;
    const statusHeight = LINE_HEIGHT_EM * font;
    const height = label.height + 4 * sa + betHeight + statusHeight;
    const right = -radius - 8 * sa;
    let y = -height / 2;
    parts.push(rectPart(`${id}/label`, right - label.width, y, right, y + label.height));
    y += label.height + 4 * sa;
    parts.push(rectPart(`${id}/bet`, right - betWidth, y, right, y + betHeight));
    y += betHeight;
    parts.push(rectPart(`${id}/status`, right - statusWidth, y, right, y + statusHeight));
    return parts;
}

// ---------------------------------------------------------------------------------------------
// Seat placement on the ellipse and the footprint-driven ellipse fit
// ---------------------------------------------------------------------------------------------

/**
 * Seats are tall (avatar plus the labels hanging below it) but not wide, so vertical travel along the ellipse
 * counts more than horizontal travel when spacing them. 1 = plain arc length.
 */
const VERTICAL_SPACING_WEIGHT = 1.25;
const ANGLE_SAMPLES = 360;

/** The seat ellipse in percent of the table: centre and radii. */
export interface SeatEllipse { cx: number; cy: number; rx: number; ry: number }

/** Angular span (degrees) over the top that the opponents share: 180 for two, +10 per extra opponent, at most 240. */
export function seatAngleSpan(opponentCount: number): number {
    return clamp(180 + (opponentCount - 2) * 10, 180, 240);
}

/**
 * Angle (degrees, screen clockwise) of an opponent on the ellipse. Seats are spaced evenly by weighted arc length in
 * the real 2.15:1 table proportions, so the near-vertical sides of the ellipse are not squeezed the way an equal
 * angle step squeezes them. Still one continuous formula for every player count.
 */
export function getSeatAngle(
    opponentIndex: number,
    opponentCount: number,
    startAngle: number,
    span: number,
    radiusX: number,
    radiusY: number,
): number {
    const stepRad = (span * Math.PI) / 180 / ANGLE_SAMPLES;
    const startRad = (startAngle * Math.PI) / 180;
    const cumulative = [0];
    for (let k = 1; k <= ANGLE_SAMPLES; k++) {
        const mid = startRad + (k - 0.5) * stepRad;
        const dx = radiusX * TABLE_ASPECT * Math.sin(mid);
        const dy = radiusY * VERTICAL_SPACING_WEIGHT * Math.cos(mid);
        cumulative.push(cumulative[k - 1] + Math.hypot(dx, dy) * stepRad);
    }

    const target = (opponentIndex / (opponentCount - 1)) * cumulative[ANGLE_SAMPLES];
    let k = 1;
    while (k < ANGLE_SAMPLES && cumulative[k] < target) k++;
    const segment = cumulative[k] - cumulative[k - 1];
    const fraction = segment > 0 ? (target - cumulative[k - 1]) / segment : 0;
    return startAngle + ((k - 1 + fraction) / ANGLE_SAMPLES) * span;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Percent coordinates (rounded to 0.1) of opponent `opponentIndex` of `opponentCount` on `ellipse`. */
export function placeOpponentSeat(
    opponentIndex: number,
    opponentCount: number,
    ellipse: SeatEllipse,
): { left: number; top: number } {
    // A heads-up opponent sits at the top of the ellipse.
    if (opponentCount <= 1) return { left: round1(ellipse.cx), top: round1(ellipse.cy - ellipse.ry) };
    const span = seatAngleSpan(opponentCount);
    const angle = getSeatAngle(opponentIndex, opponentCount, 270 - span / 2, span, ellipse.rx, ellipse.ry);
    const radians = (angle * Math.PI) / 180;
    return {
        left: round1(ellipse.cx + ellipse.rx * Math.cos(radians)),
        top: round1(ellipse.cy + ellipse.ry * Math.sin(radians)),
    };
}

/** Centre-y of the fitted ellipse per tier (percent). */
const FIT_CENTRE_Y: Record<TableTier, number> = { compact: 44, standard: 48, wide: 47 };
/** Widest horizontal radius (percent). */
const FIT_RX_MAX = 44;
/** The guard never shrinks the fitted radii below this fraction. */
const FIT_MIN_SHRINK = 0.8;
const FIT_SHRINK_STEP = 0.985;

/** The hand-picked ellipse the layout used before it was fitted; the fallback for degenerate tables. */
function legacyEllipse(tier: TableTier): SeatEllipse {
    return tier === 'compact'
        ? { cx: 50, cy: 47, rx: 40, ry: 41 }
        : tier === 'wide'
            ? { cx: 50, cy: 46, rx: 43, ry: 41 }
            : { cx: 50, cy: 46, rx: 42, ry: 40 };
}

const FIT_CACHE_LIMIT = 256;
const fitCache = new Map<string, SeatEllipse>();

/**
 * `fitSeatEllipse` memoised by its inputs (a pure function of the table size, the player count, the tier and the
 * opponent count). The fit is a few milliseconds, so the layout hook asks for it lazily per count and reuses it
 * while the table does not change size.
 */
export function fitSeatEllipseCached(table: TableDimensions, totalPlayers: number, tier: TableTier, opponentCount: number): SeatEllipse {
    const key = `${table.width}x${table.height}|${totalPlayers}|${tier}|${opponentCount}`;
    const hit = fitCache.get(key);
    if (hit) return hit;
    const ellipse = fitSeatEllipse(table, getTableScale(table, totalPlayers), tier, opponentCount);
    if (fitCache.size >= FIT_CACHE_LIMIT) fitCache.clear();
    fitCache.set(key, ellipse);
    return ellipse;
}

/** Avatar size class the table renders opponents with (the compact tier uses the smaller disc). */
export function opponentAvatarSize(tier: TableTier): AvatarSize {
    return tier === 'compact' ? 'sm' : 'md';
}

/** The footprint input of the opponent seated at (left, top), built from the table scale like OpponentSeats does. */
export function opponentFootprintInput(
    left: number,
    top: number,
    opponentCount: number,
    scale: TableScale,
    tier: TableTier,
): SeatFootprintInput {
    const avatarSize = opponentAvatarSize(tier);
    const cardPlacement = classifyCardPlacement(left, top, opponentCount);
    return {
        avatarRadius: avatarDiameter(avatarSize, scale.avatar) / 2,
        avatarScale: scale.avatar,
        textScale: scale.text,
        spacingScale: scale.spacing,
        avatarSize,
        cardScale: scale.opponentCard,
        compactFace: isCompactCardScale(scale.opponentCard),
        cardPlacement,
        labelPlacement: classifyLabelPlacement(cardPlacement, describeSeat(left, top).side),
        tier,
        showLabel: scale.overall >= OPPONENT_RANK_MIN_SCALE,
    };
}

/**
 * Smallest signed distance (px, positive inside) from any extreme point of any opponent's footprint to the felt
 * ellipse, with the opponents placed on `ellipse`. This is the exact predicate the fit is driven by.
 */
export function minSeatMargin(
    table: TableDimensions,
    scale: TableScale,
    tier: TableTier,
    opponentCount: number,
    ellipse: SeatEllipse,
): number {
    let min = Infinity;
    for (let k = 0; k < Math.max(1, opponentCount); k++) {
        const { left, top } = placeOpponentSeat(k, opponentCount, ellipse);
        const anchor = { x: ((left - 50) / 100) * table.width, y: ((top - 50) / 100) * table.height };
        const parts = getSeatFootprint(opponentFootprintInput(left, top, opponentCount, scale, tier));
        for (const point of footprintPoints(parts)) {
            const d = ellipseInsetDistance({ x: anchor.x + point.x, y: anchor.y + point.y }, table.width / 2, table.height / 2);
            if (d < min) min = d;
        }
    }
    return min;
}

/**
 * The seat ellipse for a table: the largest one (up to the old shape) whose seats keep every part of their footprint at
 * least `safeMarginPx` inside the felt. A closed-form start covers the two binding directions (the top-centre seat's
 * decoration above its avatar, and the side seats' badges beside theirs), then an exact guard shrinks both radii
 * uniformly until the minimum footprint margin clears the safe margin. Still ONE continuous ellipse for every count.
 */
export function fitSeatEllipse(
    table: TableDimensions,
    scale: TableScale,
    tier: TableTier,
    opponentCount: number,
): SeatEllipse {
    return fitSeatEllipseDetailed(table, scale, tier, opponentCount).ellipse;
}

export interface SeatEllipseFit {
    ellipse: SeatEllipse;
    /** Radii of the closed-form start, before the guard. */
    start: { rx: number; ry: number };
    /** Fraction of the start radii that the guard kept (1 = no shrinking, never below 0.8). */
    shrink: number;
}

/** `fitSeatEllipse` with the closed-form start and the guard's shrink factor exposed (for tests and tuning). */
export function fitSeatEllipseDetailed(
    table: TableDimensions,
    scale: TableScale,
    tier: TableTier,
    opponentCount: number,
): SeatEllipseFit {
    if (!(table.width > 1) || !(table.height > 1) || !(opponentCount >= 1) || !Number.isFinite(scale.overall)) {
        const ellipse = legacyEllipse(tier);
        return { ellipse, start: { rx: ellipse.rx, ry: ellipse.ry }, shrink: 1 };
    }

    const cy = FIT_CENTRE_Y[tier];
    const margin = safeMarginPx(scale.overall);
    const radius = avatarDiameter(opponentAvatarSize(tier), scale.avatar) / 2;
    const decoration = winnerDecoration(scale.avatar).extentPx;
    const topPx = margin + decoration + radius;
    const sidePx = margin + Math.max(decoration, 8 * scale.avatar) + radius;
    const ry = clamp(cy - (100 * topPx) / table.height, 10, cy - 4);
    const rx = clamp(50 - (100 * sidePx) / table.width, 10, FIT_RX_MAX);

    // Exact guard: shrink both radii uniformly until every opponent's footprint clears the safe margin.
    let shrink = 1;
    while (
        shrink > FIT_MIN_SHRINK
        && minSeatMargin(table, scale, tier, opponentCount, { cx: 50, cy, rx: rx * shrink, ry: ry * shrink }) < margin
    ) {
        shrink *= FIT_SHRINK_STEP;
    }
    return { ellipse: { cx: 50, cy, rx: rx * shrink, ry: ry * shrink }, start: { rx, ry }, shrink };
}
/**
 * Smallest signed distance (px, positive inside) from any extreme point of the hero's footprint to the felt. The hero
 * is pinned at (50%, 86%): this is checked (tests), never fitted. If it ever fails, the lever is the decoration size.
 */
export function minHeroMargin(table: TableDimensions, scale: TableScale, tier: TableTier): number {
    const avatarSize = opponentAvatarSize(tier);
    const parts = getHeroFootprint({
        avatarRadius: avatarDiameter(avatarSize, scale.overall) / 2,
        avatarScale: scale.overall,
        textScale: scale.text,
        spacingScale: scale.spacing,
        avatarSize,
        cardScale: scale.heroCard,
        compactFace: isCompactCardScale(scale.heroCard, 'lg'),
    });
    const anchor = { x: 0, y: 0.36 * table.height };
    let min = Infinity;
    for (const point of footprintPoints(parts)) {
        const d = ellipseInsetDistance({ x: anchor.x + point.x, y: anchor.y + point.y }, table.width / 2, table.height / 2);
        if (d < min) min = d;
    }
    return min;
}

/**
 * Estimated height of the central BoardCluster above its vertical midpoint (50%).
 * BoardCluster contains TablePots (phase + pot + gaps) and CommunityCardsArea.
 */
export function getBoardClusterHalfHeight(scale: TableScale): number {
    const sp = scale.spacing;
    const st = scale.text;
    const sc = scale.overall;
    const phaseH = fontPx(10, st) * 1.5;
    const potH = fontPx(24, st) + 2 * (8 * sp);
    const gapPhasePot = 8 * sp;
    const gapPotsCards = 8 * sp;
    const cardsH = 64 * sc;
    const sidePotExtra = 12 * sp;
    const totalH = phaseH + gapPhasePot + potH + gapPotsCards + cardsH + sidePotExtra;
    return totalH / 2;
}

/**
 * Returns true if an opponent seat's hand-rank label has sufficient vertical clearance
 * to the central board cluster. When false, the hand-rank label should gracefully move
 * to sr-only (retaining the expanded panel "Hand" row) to prevent board collisions.
 */
export function seatHandRankFits(
    seat: Pick<SeatPosition, 'top' | 'cardPlacement'> & { left?: number },
    table: TableDimensions,
    scale: TableScale,
    tier: TableTier,
): boolean {
    const isTopCentre = seat.left !== undefined && Math.abs(seat.left - 50) <= CENTRE_BAND && seat.top < 35;
    // Only 'below' seats and top-centre seats stack vertically directly above the central board cluster.
    if (seat.cardPlacement !== 'below' && !isTopCentre) return true;

    const avatarSize = opponentAvatarSize(tier);
    const radius = avatarDiameter(avatarSize, scale.avatar) / 2;
    const metrics = getSeatMetrics({
        avatarRadius: radius,
        avatarScale: scale.avatar,
        spacingScale: scale.spacing,
        cardScale: scale.opponentCard,
        compactFace: isCompactCardScale(scale.opponentCard),
    });

    const compactStyle = usesCompactLabelStyle(tier, seat.cardPlacement);
    const labelSize = handRankLabelSize(labelCharBudget(tier), scale.avatar, scale.text, compactStyle);

    const anchorY = (seat.top / 100) * table.height;
    const detailsOffset = seat.cardPlacement === 'below' ? metrics.belowDetailsOffsetTop : 0;
    const font = fontPx(9, scale.text);
    // When seat is directly above the board, details (hand rank, bet, status) hang below.
    const detailsH = labelSize.height + 2 * (LINE_HEIGHT_EM * font);
    const labelTop = anchorY + (radius + 8 * scale.avatar + detailsOffset);
    const labelBottom = labelTop + detailsH;

    const boardTop = 0.5 * table.height - getBoardClusterHalfHeight(scale);
    const clearance = boardTop - labelBottom;

    // Minimum 2px clearance required to avoid Check A overlap with board elements.
    return clearance >= 2;
}

/**
 * Returns true if an opponent seat's status text has sufficient margin to the table felt ellipse.
 * When false, the status gracefully moves to sr-only to avoid felt boundary breaches (Check G).
 */
export function seatStatusFitsFelt(
    seat: Pick<SeatPosition, 'left' | 'top'>,
    table: TableDimensions,
    scale: TableScale,
    tier: TableTier,
): boolean {
    const avatarSize = opponentAvatarSize(tier);
    const radius = avatarDiameter(avatarSize, scale.avatar) / 2;
    const font = fontPx(9, scale.text);
    const status = statusBoxSize(radius, scale.text);
    const anchorX = ((seat.left - 50) / 100) * table.width;
    const anchorY = ((seat.top - 50) / 100) * table.height;
    const topY = anchorY + radius + 8 * scale.avatar;
    const bottomY = topY + 2 * (LINE_HEIGHT_EM * font);
    const halfW = status.width / 2;
    const margin = safeMarginPx(scale.overall);

    for (const sx of [-halfW, halfW]) {
        const d = ellipseInsetDistance({ x: anchorX + sx, y: bottomY }, table.width / 2, table.height / 2);
        if (d < margin) return false;
    }
    return true;
}

