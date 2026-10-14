import { test, expect, type Browser, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { cardGlyphViolations, feltContainmentViolations, feltFromRect } from '../../src/lib/layoutChecks';
import type { CardGlyphMeasurement, GlyphMeasurement, PartShape, ShapePart } from '../../src/lib/layoutChecks';
import { setupStompWebSocketMock } from '../../e2e/support/stompWsMock';

/**
 * SHOWDOWN overlap / clipping / readability instrument.
 *
 * Measures the real DOM geometry (getBoundingClientRect) of every seat part, the board, the pots, the header
 * and the dock for 3-10 players x 8 viewports and reports violations compactly.
 *
 * Run: npx playwright test -c playwright.layout.config.ts e2e/layout-overlap.spec.ts
 * Filters (csv): LAYOUT_COUNTS=7,10  LAYOUT_VIEWPORTS=MobileLandscape_Min,Tablet
 *                LAYOUT_SCENARIOS=main,heroLast,oppWinsLeft,oppWinsRight,oppWinsTop,splitPot,regular
 *                LAYOUT_CHECKS=A,B,C,D,E,F,G,H,S   (unlisted checks are dropped before pass/fail)
 * Legacy gate (checks A-F on the original 73 cases):
 *   LAYOUT_CHECKS=A,B,C,D,E,F,S LAYOUT_SCENARIOS=main,heroLast
 * Set LAYOUT_DUMP=1 to also write the raw measurement of every case to test-results/layout-overlap/raw/.
 * Output: test-results/layout-overlap/report.json and <prefix>_<N>p_<Viewport>.png
 *   (prefix: showdown for main, else the scenario name)
 */

const viewports = [
    { name: 'iPhone14Landscape', width: 844, height: 390 },
    { name: 'Tablet', width: 1024, height: 768 },
    { name: 'Laptop', width: 1366, height: 768 },
    { name: 'Desktop', width: 1920, height: 1080 },
    { name: 'MobileLandscape_Min', width: 667, height: 375 },
    { name: 'Desktop_MinHeight', width: 1024, height: 600 },
    { name: 'DesktopWide_MinHeight', width: 1920, height: 600 },
    { name: 'Portrait_MinWidth', width: 600, height: 800 },
];

const MIN_FONT_PX = 8;
const TOLERANCE_PX = 1;
const MAX_LINES_PER_COUNT = 25;

const csv = (value: string | undefined) =>
    value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null;
const countFilter = csv(process.env.LAYOUT_COUNTS)?.map(Number) ?? null;
const viewportFilter = csv(process.env.LAYOUT_VIEWPORTS);

const activeCounts = [3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !countFilter || countFilter.includes(n));
const activeViewports = viewports.filter((vp) => !viewportFilter || viewportFilter.includes(vp.name));

type Scenario = 'main' | 'heroLast' | 'oppWinsLeft' | 'oppWinsRight' | 'oppWinsTop' | 'splitPot' | 'regular';
const ALL_SCENARIOS: Scenario[] = ['main', 'heroLast', 'oppWinsLeft', 'oppWinsRight', 'oppWinsTop', 'splitPot', 'regular'];
// LAYOUT_SCENARIOS (csv, default all) selects scenarios; LAYOUT_CHECKS (csv of A..H,S, default all) drops
// violations of unlisted checks before pass/fail, so the legacy gate is
//   LAYOUT_CHECKS=A,B,C,D,E,F,S LAYOUT_SCENARIOS=main,heroLast
const scenarioFilter = csv(process.env.LAYOUT_SCENARIOS);
const checkFilter = csv(process.env.LAYOUT_CHECKS)?.map((c) => c.toUpperCase()) ?? null;
const scenarioActive = (s: Scenario) => !scenarioFilter || scenarioFilter.includes(s);
const unknownScenarios = (scenarioFilter ?? []).filter((s) => !ALL_SCENARIOS.includes(s as Scenario));
if (unknownScenarios.length > 0) {
    throw new Error(`Unknown LAYOUT_SCENARIOS: ${unknownScenarios.join(', ')} (valid: ${ALL_SCENARIOS.join(', ')})`);
}

/** PNG prefix per scenario (`main` and `heroLast` keep the names they always had). */
const PNG_PREFIX: Record<Scenario, string> = {
    main: 'showdown',
    heroLast: 'heroLast',
    oppWinsLeft: 'oppWinsLeft',
    oppWinsRight: 'oppWinsRight',
    oppWinsTop: 'oppWinsTop',
    splitPot: 'splitPot',
    regular: 'regular',
};

const HERO_LAST_COUNTS = [3, 6, 10];
const HERO_LAST_VIEWPORTS = ['Tablet', 'MobileLandscape_Min', 'Desktop'];

const outDir = path.resolve(process.cwd(), 'test-results', 'layout-overlap');
const reportPath = path.join(outDir, 'report.json');

// Fresh report per run. Only the runner process (no TEST_WORKER_INDEX) resets it: workers are restarted
// after every failing test and must keep appending. PNGs are simply overwritten per case.
// Never touches test-results/layout-screenshots.
if (!process.env.TEST_WORKER_INDEX) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.rmSync(reportPath, { force: true });
}

// ---------------------------------------------------------------------------------------------
// Types shared between the in-page collector and the node-side checks
// ---------------------------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }

interface Item extends Rect {
    id: string; // e.g. seat:p-4/hand-rank
    group: string; // seat:<key> | hero | board | header | dock
    part: string;
    minFont: number | null;
    overflow: boolean;
}

interface Measurement {
    items: Item[];
    table: Rect | null;
    stage: Rect | null;
    viewport: { w: number; h: number };
    opponentKeys: string[];
    heroCount: number;
    heroLabel: string | null;
    heroAvatarCentre: { x: number; y: number } | null;
    podOffsets: { key: string; dx: number; dy: number }[];
    stable: boolean;
    /** `--table-scale` custom property (overall scale) of table-surface; null when not readable. */
    tableScale: number | null;
    /** One entry per seat part with its geometric shape (checks G). Built from the same elements as `items`. */
    shapes: ShapePart[];
    /** Winner decoration extents parsed from the avatar's computed box-shadow (seats that show the crown). */
    winnerDecor: { group: string; avatarRadius: number; ringExtentPx: number; glowExtentPx: number }[];
    /** Per revealed opponent card: glyph rects, fonts, effective opacity and the card on top of each glyph (check H). */
    cardGlyphs: CardGlyphMeasurement[];
}

type Check = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'S';

interface Violation {
    check: Check;
    a: string;
    b: string;
    detail: string;
    severity: number;
}

interface CaseResult {
    count: number;
    viewport: string;
    scenario: Scenario;
    /** True when at least one check gates this case. */
    gating: boolean;
    /** Checks whose violations fail the case. Others are listed in `reportOnlyViolations` only. */
    gatingChecks: Check[];
    pass: boolean;
    /** Gating violations only. */
    violationCount: number;
    byCheck: Partial<Record<Check, number>>;
    minClearance: number | null;
    minPair?: string;
    violations: Violation[];
    /** Violations of checks that do not gate this case (listed, never failing). */
    reportOnlyViolations: Violation[];
    reportOnlyByCheck: Partial<Record<Check, number>>;
}

const ALL_CHECKS: Check[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'S'];
const unknownChecks = (checkFilter ?? []).filter((c) => !ALL_CHECKS.includes(c as Check));
if (unknownChecks.length > 0) {
    throw new Error(`Unknown LAYOUT_CHECKS: ${unknownChecks.join(', ')} (valid: ${ALL_CHECKS.join(', ')})`);
}

/**
 * Which checks fail a case. Everything gates, except the `regular` (flop) scenario, which gates felt
 * containment (G) across all viewports and keeps the pre-existing overlap checks (A-F) report-only.
 */
function gatingChecksFor(scenario: Scenario): Check[] {
    if (scenario !== 'regular') return ALL_CHECKS;
    return ['G', 'S'];
}

// ---------------------------------------------------------------------------------------------
// In-page collector (must stay self-contained: it is serialised and run inside the browser)
// ---------------------------------------------------------------------------------------------

async function measureInPage(): Promise<Measurement> {
    const q = (root: ParentNode, id: string) =>
        Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));

    const rectOf = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });

    // Visible-painted filter: not display:none / visibility:hidden, effective opacity > 0.05, big enough.
    const isPainted = (el: Element, minSize: number) => {
        const r = el.getBoundingClientRect();
        if (r.width <= minSize || r.height <= minSize) return false;
        if (getComputedStyle(el).visibility === 'hidden') return false;
        let opacity = 1;
        for (let n: Element | null = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none') return false;
            opacity *= parseFloat(cs.opacity);
        }
        return opacity > 0.05;
    };

    // Smallest computed font-size among painted elements that own text.
    const minFontOf = (root: Element | null): number | null => {
        if (!root) return null;
        let min: number | null = null;
        for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const ownsText = Array.from(el.childNodes).some(
                (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim().length > 0,
            );
            if (!ownsText || !isPainted(el, 1.5)) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            min = min === null ? fs : Math.min(min, fs);
        }
        return min;
    };

    const overflows = (el: HTMLElement) =>
        el.clientWidth > 0 &&
        el.clientHeight > 0 &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

    const sample = (): Omit<Measurement, 'stable'> => {
        const items: Item[] = [];
        const push = (group: string, part: string, rect: Rect, minFont: number | null, overflow: boolean) => {
            items.push({ id: `${group}/${part}`, group, part, ...rect, minFont, overflow });
        };

        // Additive measurements for checks G and H. They never feed `items`, so checks A-F are unaffected.
        const shapes: ShapePart[] = [];
        const winnerDecor: Measurement['winnerDecor'] = [];
        const cardGlyphs: CardGlyphMeasurement[] = [];
        const pushShape = (id: string, shape: PartShape) => shapes.push({ id, shape });
        const circleOf = (r: Rect): PartShape => ({ kind: 'circle', cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: r.w / 2 });
        const SHAPE_OF_PART: Record<string, 'circle' | 'pill' | 'rect'> = {
            avatar: 'circle',
            crown: 'circle',
            turn: 'circle',
            chip: 'pill',
            blind: 'pill',
            'hand-rank': 'rect',
            bet: 'rect',
            status: 'rect',
        };
        const shapeOfRect = (kind: 'circle' | 'pill' | 'rect', r: Rect): PartShape =>
            kind === 'circle' ? circleOf(r) : { kind, x: r.x, y: r.y, w: r.w, h: r.h };

        // Largest ring (zero-blur layers) and glow (spread + blur + offset) extents of a computed box-shadow.
        const parseShadowExtents = (value: string) => {
            const layers: string[] = [];
            let depth = 0;
            let start = 0;
            for (let i = 0; i < value.length; i++) {
                const ch = value[i];
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (ch === ',' && depth === 0) {
                    layers.push(value.slice(start, i));
                    start = i + 1;
                }
            }
            layers.push(value.slice(start));
            let ring = 0;
            let glow = 0;
            for (const layer of layers) {
                if (/\binset\b/.test(layer)) continue;
                let stripped = layer.replace(/#[0-9a-f]+/gi, ' ');
                while (/\([^()]*\)/.test(stripped)) stripped = stripped.replace(/[a-z-]*\([^()]*\)/gi, ' ');
                const nums = (stripped.match(/-?\d*\.?\d+/g) ?? []).map(Number);
                if (nums.length < 2) continue;
                const [x = 0, y = 0, blur = 0, spread = 0] = nums;
                const offset = Math.max(Math.abs(x), Math.abs(y));
                if (blur === 0) ring = Math.max(ring, spread + offset);
                glow = Math.max(glow, spread + blur + offset);
            }
            return { ring, glow };
        };

        const seatParts: [string, string][] = [
            ['avatar', 'player-avatar'],
            ['chip', 'seat-chip-badge'],
            ['blind', 'seat-blind-badge'],
            ['crown', 'seat-winner-crown'],
            ['turn', 'seat-turn-indicator'],
            ['hand-rank', 'seat-hand-rank'],
            ['bet', 'seat-bet'],
            ['status', 'seat-status'],
        ];

        const collectSeat = (root: HTMLElement, group: string, cardsId: string) => {
            for (const [part, testId] of seatParts) {
                q(root, testId).forEach((el, i) => {
                    // sr-only text (1x1px, clipped) is not painted: it is not part of the overlap set.
                    if (!isPainted(el, 1.5)) return;
                    const name = i === 0 ? part : `${part}#${i + 1}`;
                    if (part === 'avatar') {
                        // Badges live inside the avatar element: only read the initials font.
                        push(group, name, rectOf(el.getBoundingClientRect()), minFontOf(el.firstElementChild), false);
                    } else {
                        push(group, name, rectOf(el.getBoundingClientRect()), minFontOf(el), overflows(el));
                    }
                    pushShape(`${group}/${name}`, shapeOfRect(SHAPE_OF_PART[part], rectOf(el.getBoundingClientRect())));
                });
            }

            // OFF badge: not part of the overlap set, but it is a seat part that must stay on the felt.
            q(root, 'seat-offline-badge').forEach((el, i) => {
                if (!isPainted(el, 1.5)) return;
                pushShape(`${group}/${i === 0 ? 'offline' : `offline#${i + 1}`}`, shapeOfRect('pill', rectOf(el.getBoundingClientRect())));
            });

            // Winner ring and glow: circles around the avatar, sized from its computed box-shadow.
            const avatarEl = q(root, 'player-avatar')[0];
            if (avatarEl && q(root, 'seat-winner-crown').length > 0) {
                const ar = rectOf(avatarEl.getBoundingClientRect());
                const { ring, glow } = parseShadowExtents(getComputedStyle(avatarEl).boxShadow);
                const radius = ar.w / 2;
                winnerDecor.push({ group, avatarRadius: radius, ringExtentPx: ring, glowExtentPx: glow });
                pushShape(`${group}/avatar-ring`, { kind: 'circle', cx: ar.x + ar.w / 2, cy: ar.y + ar.h / 2, r: radius + ring });
                pushShape(`${group}/avatar-glow`, { kind: 'circle', cx: ar.x + ar.w / 2, cy: ar.y + ar.h / 2, r: radius + glow });
            }
            const stack = q(root, cardsId)[0];
            if (stack) {
                const cards = q(stack, 'card').filter((c) => isPainted(c, 0.5));
                if (cards.length > 0) {
                    const rects = cards.map((c) => c.getBoundingClientRect());
                    const left = Math.min(...rects.map((r) => r.left));
                    const top = Math.min(...rects.map((r) => r.top));
                    const right = Math.max(...rects.map((r) => r.right));
                    const bottom = Math.max(...rects.map((r) => r.bottom));
                    const fonts = cards.map((c) => minFontOf(c)).filter((f): f is number => f !== null);
                    push(
                        group,
                        'cards',
                        { x: left, y: top, w: right - left, h: bottom - top },
                        fonts.length ? Math.min(...fonts) : null,
                        cards.some((c) => overflows(c)),
                    );
                    pushShape(`${group}/cards`, { kind: 'rect', x: left, y: top, w: right - left, h: bottom - top });
                }

                // Check H: glyph legibility of every revealed opponent card (face-down cards have no glyphs).
                if (cardsId === 'seat-cards') {
                    const revealed = q(stack, 'card').filter(
                        (c) => c.getAttribute('aria-label') !== 'Hidden Card' && isPainted(c, 0.5),
                    );
                    const measureGlyph = (cardEl: HTMLElement, testId: string): GlyphMeasurement | null => {
                        const el = q(cardEl, testId)[0];
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        // Effective opacity: glyph, its ancestors, up to and including the card (dimming lives on the card).
                        let opacity = 1;
                        for (let n: Element | null = el; n; n = n.parentElement) {
                            opacity *= parseFloat(getComputedStyle(n).opacity);
                            if (n === cardEl) break;
                        }
                        const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        const owner = topEl ? revealed.findIndex((c) => c.contains(topEl)) : -1;
                        return {
                            rect: rectOf(r),
                            fontPx: parseFloat(getComputedStyle(el).fontSize),
                            opacity,
                            topmostCard: owner >= 0 ? owner : null,
                        };
                    };
                    revealed.forEach((cardEl, ci) => {
                        cardGlyphs.push({
                            id: `${group}/card-${ci}`,
                            index: ci,
                            rect: rectOf(cardEl.getBoundingClientRect()),
                            rank: measureGlyph(cardEl, 'card-rank'),
                            suit: measureGlyph(cardEl, 'card-suit'),
                        });
                    });
                }
            }
        };

        const opponentRoots = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="opponent-seat-"]'),
        );
        const opponentKeys = opponentRoots.map((el) => (el.dataset.testid ?? '').replace('opponent-seat-', ''));
        opponentRoots.forEach((el, i) => collectSeat(el, `seat:${opponentKeys[i]}`, 'seat-cards'));

        const heroRoots = q(document, 'hero-seat');
        heroRoots.forEach((el) => collectSeat(el, 'hero', 'hero-cards'));

        // Board, pots
        for (let i = 0; i < 5; i++) {
            const card = q(document, `board-card-${i}`)[0];
            if (card && isPainted(card, 0.5)) {
                const inner = q(card, 'card')[0];
                push('board', `card-${i}`, rectOf(card.getBoundingClientRect()), minFontOf(card), inner ? overflows(inner) : false);
            }
            const slot = q(document, `board-slot-${i}`)[0];
            if (slot && isPainted(slot, 0.5)) {
                push('board', `slot-${i}`, rectOf(slot.getBoundingClientRect()), minFontOf(slot), false);
            }
        }
        const potParts: [string, string][] = [
            ['pot', 'table-pot'],
            ['side-pot-chip', 'side-pot-chip'],
            ['phase', 'pot-phase'],
        ];
        for (const [part, testId] of potParts) {
            const el = q(document, testId)[0];
            if (el && isPainted(el, 0.5)) {
                push('board', part, rectOf(el.getBoundingClientRect()), minFontOf(el), overflows(el));
            }
        }

        // Chrome
        const header = q(document, 'room-header')[0];
        if (header && isPainted(header, 0.5)) push('header', 'header', rectOf(header.getBoundingClientRect()), null, false);
        const dock = q(document, 'room-dock')[0];
        if (dock && isPainted(dock, 0.5)) push('dock', 'dock', rectOf(dock.getBoundingClientRect()), null, false);

        const table = q(document, 'table-surface')[0];
        const stage = q(document, 'room-stage')[0];
        const tableScaleRaw = table ? parseFloat(getComputedStyle(table).getPropertyValue('--table-scale')) : NaN;

        const heroAvatar = heroRoots[0] ? q(heroRoots[0], 'player-avatar')[0] : undefined;
        const heroAvatarRect = heroAvatar?.getBoundingClientRect();

        const podOffsets = q(document, 'player-pod').map((pod) => {
            const avatar = q(pod, 'player-avatar')[0];
            const seatRoot = pod.closest('[data-testid^="opponent-seat-"], [data-testid="hero-seat"]') as HTMLElement | null;
            const pr = pod.getBoundingClientRect();
            const ar = avatar ? avatar.getBoundingClientRect() : pr;
            return {
                key: seatRoot?.dataset.testid ?? 'pod',
                dx: pr.left + pr.width / 2 - (ar.left + ar.width / 2),
                dy: pr.top + pr.height / 2 - (ar.top + ar.height / 2),
            };
        });

        return {
            items,
            // Padding box: absolutely positioned % children resolve against it, not the border box.
            table: table
                ? (() => {
                    const r = table.getBoundingClientRect();
                    return { x: r.left + table.clientLeft, y: r.top + table.clientTop, w: table.clientWidth, h: table.clientHeight };
                })()
                : null,
            stage: stage ? rectOf(stage.getBoundingClientRect()) : null,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            opponentKeys,
            heroCount: heroRoots.length,
            heroLabel: heroRoots[0]?.getAttribute('aria-label') ?? null,
            heroAvatarCentre: heroAvatarRect
                ? { x: heroAvatarRect.left + heroAvatarRect.width / 2, y: heroAvatarRect.top + heroAvatarRect.height / 2 }
                : null,
            podOffsets,
            tableScale: Number.isFinite(tableScaleRaw) ? tableScaleRaw : null,
            shapes,
            winnerDecor,
            cardGlyphs,
        };
    };

    const close = (a: Rect, b: Rect) =>
        Math.abs(a.x - b.x) <= 0.25 && Math.abs(a.y - b.y) <= 0.25 &&
        Math.abs(a.w - b.w) <= 0.25 && Math.abs(a.h - b.h) <= 0.25;
    const sameOpt = (a: Rect | null, b: Rect | null) => (a === null || b === null ? a === b : close(a, b));
    const same = (a: Omit<Measurement, 'stable'>, b: Omit<Measurement, 'stable'>) =>
        a.items.length === b.items.length &&
        a.items.every((it, i) => it.id === b.items[i].id && close(it, b.items[i])) &&
        sameOpt(a.table, b.table) &&
        sameOpt(a.stage, b.stage);

    await document.fonts.ready;
    const deadline = performance.now() + 5000;
    let previous = sample();
    for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 32));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const current = sample();
        if (same(previous, current)) return { ...current, stable: true };
        previous = current;
        if (performance.now() > deadline) return { ...current, stable: false };
    }
}

// ---------------------------------------------------------------------------------------------
// Node-side checks A-F (+ S for "never settled")
// ---------------------------------------------------------------------------------------------

const BADGES = new Set(['chip', 'blind', 'crown', 'turn']);
const basePart = (part: string) => part.replace(/#\d+$/, '');

const overlapOf = (a: Rect, b: Rect) => ({
    ox: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    oy: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
});

function analyze(m: Measurement, count: number, heroLast: boolean): { violations: Violation[]; minClearance: number | null; minPair: string } {
    const violations: Violation[] = [];
    let minClearance: number | null = null;
    let minPair = '';
    const r1 = (n: number) => Math.round(n * 10) / 10;

    if (!m.stable) {
        violations.push({ check: 'S', a: 'layout', b: '-', detail: 'did not settle in 5s', severity: 1000 });
    }

    // A + B: pairwise intersections
    for (let i = 0; i < m.items.length; i++) {
        for (let j = i + 1; j < m.items.length; j++) {
            const a = m.items[i];
            const b = m.items[j];
            const sameGroup = a.group === b.group;
            if (sameGroup) {
                if (a.group === 'board') {
                    // everything disjoint
                } else if (a.group.startsWith('seat:') || a.group === 'hero') {
                    const pa = basePart(a.part);
                    const pb = basePart(b.part);
                    const badgeVsAvatar =
                        (BADGES.has(pa) && pb === 'avatar') || (BADGES.has(pb) && pa === 'avatar');
                    if (badgeVsAvatar) continue; // allowed
                } else {
                    continue;
                }
            }
            const { ox, oy } = overlapOf(a, b);
            const clearance = ox > 0 && oy > 0 ? -Math.min(ox, oy) : Math.max(-ox, -oy);
            if (minClearance === null || clearance < minClearance) {
                minClearance = clearance;
                minPair = `${a.id} x ${b.id}`;
            }
            if (ox > TOLERANCE_PX && oy > TOLERANCE_PX) {
                violations.push({
                    check: sameGroup ? 'B' : 'A',
                    a: a.id,
                    b: b.id,
                    detail: `${Math.round(ox)}x${Math.round(oy)}px`,
                    severity: ox * oy,
                });
            }
        }
    }

    // C: inside viewport, and inside the room stage (header/dock excluded from the stage rule)
    for (const it of m.items) {
        const outViewport = Math.max(
            -it.x,
            -it.y,
            it.x + it.w - m.viewport.w,
            it.y + it.h - m.viewport.h,
        );
        if (outViewport > TOLERANCE_PX) {
            violations.push({ check: 'C', a: it.id, b: 'viewport', detail: `${Math.round(outViewport)}px out`, severity: outViewport * 50 });
        }
        if (it.group === 'header' || it.group === 'dock') continue;
        if (!m.stage) continue;
        const s = m.stage;
        const outStage = Math.max(
            s.x - it.x,
            s.y - it.y,
            it.x + it.w - (s.x + s.w),
            it.y + it.h - (s.y + s.h),
        );
        if (outStage > TOLERANCE_PX) {
            violations.push({ check: 'C', a: it.id, b: 'stage', detail: `${Math.round(outStage)}px out`, severity: outStage * 50 });
        }
    }

    // D: readable fonts
    for (const it of m.items) {
        if (it.minFont !== null && it.minFont < MIN_FONT_PX - 0.01) {
            violations.push({
                check: 'D',
                a: it.id,
                b: 'font',
                detail: `${r1(it.minFont)}px<${MIN_FONT_PX}px`,
                severity: (MIN_FONT_PX - it.minFont) * 100,
            });
        }
    }

    // E: clipped content
    for (const it of m.items) {
        if (it.overflow) {
            violations.push({ check: 'E', a: it.id, b: 'content', detail: 'clipped/overflowing', severity: 500 });
        }
    }

    // F: architecture guards
    if (!m.table) {
        violations.push({ check: 'F', a: 'table-surface', b: '-', detail: 'missing', severity: 1000 });
    } else if (m.heroAvatarCentre) {
        const ex = m.table.x + m.table.w * 0.5;
        const ey = m.table.y + m.table.h * 0.86;
        const dx = m.heroAvatarCentre.x - ex;
        const dy = m.heroAvatarCentre.y - ey;
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
            violations.push({
                check: 'F',
                a: 'hero/avatar',
                b: 'table(50%,86%)',
                detail: `off ${r1(dx)},${r1(dy)}px`,
                severity: 800,
            });
        }
    }
    for (const p of m.podOffsets) {
        if (Math.abs(p.dx) > 0.5 || Math.abs(p.dy) > 0.5) {
            violations.push({
                check: 'F',
                a: p.key,
                b: 'pod-vs-avatar-centre',
                detail: `off ${r1(p.dx)},${r1(p.dy)}px`,
                severity: 800,
            });
        }
    }
    if (m.heroCount !== 1 || m.opponentKeys.length !== count - 1) {
        violations.push({
            check: 'F',
            a: 'seats',
            b: `expected ${count - 1}+1`,
            detail: `got ${m.opponentKeys.length}+${m.heroCount}`,
            severity: 1000,
        });
    }
    if (heroLast && !(m.heroLabel ?? '').startsWith('Host')) {
        violations.push({
            check: 'F',
            a: 'hero-seat',
            b: 'label Host',
            detail: `got ${m.heroLabel ?? 'none'}`,
            severity: 1000,
        });
    }

    // G: every seat part (incl. winner ring, glow and crown) stays inside the felt ellipse by a safe margin.
    if (m.table && m.tableScale !== null) {
        violations.push(...feltContainmentViolations(m.shapes, feltFromRect(m.table), m.tableScale));
    } else {
        violations.push({ check: 'G', a: 'table-surface', b: '--table-scale', detail: 'felt or scale not measurable', severity: 1000 });
    }

    // H: both revealed opponent cards expose a legible rank and suit glyph.
    violations.push(...cardGlyphViolations(m.cardGlyphs));

    return { violations, minClearance, minPair };
}

// ---------------------------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------------------------

const generatePlayers = (count: number) => {
    const players = [];
    for (let i = 1; i <= count; i++) {
        players.push({
            id: `p-${i}`,
            name: i === 1 ? 'Host' : `Player ${i}`,
            chips: 1000 - (i * 10),
            currentBet: i === 1 ? 20 : i === 2 ? 10 : 0,
            status: 'ACTIVE',
            hasFolded: false,
            isBigBlind: i === 1,
            isSmallBlind: i === 2,
        });
    }
    return players;
};

/** What the mocked backend returns for one scenario (see specFor). */
interface MockSpec {
    phase: 'showdown' | 'flop';
    heroLast: boolean;
    /** Production-like showdown data: enum hand ranks with bestHand, one best-hand hole card, READY winners. */
    rich: boolean;
    winnerIds: string[];
    disconnectedIds: string[];
}

/** The ten hand categories as the backend sends them, each with a five-card best hand. */
const HAND_CATEGORIES: { rank: string; best: string[] }[] = [
    { rank: 'HIGH_CARD', best: ['AS', 'KD', '9C', '7H', '3S'] },
    { rank: 'ONE_PAIR', best: ['QS', 'QD', '9C', '7H', '3S'] },
    { rank: 'TWO_PAIR', best: ['QS', 'QD', 'JC', 'JH', '3S'] },
    { rank: 'THREE_OF_A_KIND', best: ['9S', '9D', '9C', 'KH', '4S'] },
    { rank: 'STRAIGHT', best: ['9S', '8D', '7C', '6H', '5S'] },
    { rank: 'FLUSH', best: ['AH', 'JH', '9H', '6H', '2H'] },
    { rank: 'FULL_HOUSE', best: ['QS', 'QD', 'QC', 'JH', 'JS'] },
    { rank: 'FOUR_OF_A_KIND', best: ['9S', '9D', '9C', '9H', 'KS'] },
    { rank: 'STRAIGHT_FLUSH', best: ['9H', '8H', '7H', '6H', '5H'] },
    // Starts with the ten, so the widest rank glyph ("10") is exercised.
    { rank: 'ROYAL_FLUSH', best: ['TS', 'JS', 'QS', 'KS', 'AS'] },
];
/** Hole card that is never part of a best hand, so a winner always has one dimmed card (red / black alternating). */
const DIMMED_HOLE_CARDS = ['2C', '3D'];
const WINNER_BET = 12500;
const DISCONNECT_WINDOW_MS = 5 * 60 * 1000 - 500;

const playerNumber = (id: string) => Number(id.replace('p-', ''));

function buildMocks(roomId: string, numPlayers: number, spec: MockSpec) {
    // R3 scenario: Host (the hero) is moved to the LAST index of players.
    const ordered = (list: ReturnType<typeof generatePlayers>) =>
        spec.heroLast ? [...list.slice(1), list[0]] : list;

    const room = {
        roomId,
        roomName: `Test Room ${numPlayers}P`,
        maxPlayers: numPlayers,
        buyIn: 1000,
        smallBlind: 10,
        bigBlind: 20,
        createdAt: '2026-01-01T00:00:00.000Z',
        hostName: 'Host',
        currentPlayers: numPlayers,
        canStartGame: false,
        players: ordered(generatePlayers(numPlayers)).map(p => ({ name: p.name, isHost: p.id === 'p-1', joinedAt: '2026-01-01T00:00:00.000Z' })),
        gameStarted: true,
    };

    const flop = {
        gameId: roomId,
        maxPlayers: numPlayers,
        phase: 'FLOP',
        pot: 80,
        pots: [30, 20, 15, 10, 5],
        currentBet: 20,
        communityCards: ['QH', 'JH', 'TH'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'Host',
        legalActions: ['FOLD', 'CALL', 'RAISE'],
        players: ordered(generatePlayers(numPlayers)),
        isGameOver: false,
    };

    if (spec.phase === 'flop') return { room, state: flop };

    const winners = new Set(spec.winnerIds);
    const disconnected = new Set(spec.disconnectedIds);
    const firstWinner = spec.winnerIds[0] ?? 'p-1';
    const deadline = Date.now() + DISCONNECT_WINDOW_MS;

    const players = flop.players.map((p) => {
        if (!spec.rich) {
            return {
                ...p,
                holeCards: p.id === 'p-1' ? ['AS', 'KS'] : ['9H', '8H'],
                handRank: p.id === 'p-1' ? 'Royal Flush' : 'Two Pair',
                bestHand: p.id === 'p-1' ? ['AS', 'KS', 'QH', 'JH', 'TH'] : ['QH', 'JH', '9H', '8H', 'TH'],
                isWinner: winners.has(p.id),
                chipsWon: winners.has(p.id) ? 80 : 0,
            };
        }

        const num = playerNumber(p.id);
        const isWinner = winners.has(p.id);
        const isOffline = disconnected.has(p.id);
        // The hero keeps the main scenario's hand; opponents cycle through all ten categories.
        const category = HAND_CATEGORIES[(num + numPlayers) % HAND_CATEGORIES.length];
        const hero = p.id === 'p-1';
        // Blinds: the (first) winner has the big blind; the small blind is the hero, or p-2 when the hero has the big blind.
        const isBigBlind = firstWinner === 'p-1' ? p.id === 'p-1' : p.id === firstWinner;
        const isSmallBlind = firstWinner === 'p-1' ? p.id === 'p-2' : p.id === 'p-1';
        return {
            ...p,
            status: isOffline ? 'DISCONNECTED' : 'ACTIVE',
            ...(isOffline ? { disconnectDeadlineEpochMs: deadline } : {}),
            isBigBlind,
            isSmallBlind,
            // A lone opponent winner has a bet (longer text); in a split pot everyone keeps the base bets.
            currentBet: !hero && isWinner && winners.size === 1 ? WINNER_BET : p.currentBet,
            isReadyForNextHand: isWinner && !isOffline && !hero,
            holeCards: hero ? ['AS', 'KS'] : [category.best[0], DIMMED_HOLE_CARDS[num % 2]],
            handRank: hero ? 'Royal Flush' : category.rank,
            bestHand: hero ? ['AS', 'KS', 'QH', 'JH', 'TH'] : category.best,
            isWinner,
            chipsWon: isWinner ? Math.round(80 / winners.size) : 0,
        };
    });

    const winnerCategory = HAND_CATEGORIES[(playerNumber(firstWinner) + numPlayers) % HAND_CATEGORIES.length];
    const state = {
        ...flop,
        // GameTableView shows a "Waiting for <current player> to reconnect" banner (outside the stage, shrinking it)
        // whenever a player is DISCONNECTED and somebody is on turn. A finished hand has nobody on turn, so the
        // rich scenarios omit the turn: the seat geometry is measured on the same felt as the other showdowns.
        ...(spec.rich ? { currentPlayerId: '', currentPlayerName: '' } : {}),
        phase: 'SHOWDOWN',
        communityCards: ['QH', 'JH', 'TH', '2S', '2D'],
        isGameOver: true,
        showdownWinner: {
            playerId: firstWinner,
            handRank: spec.rich && firstWinner !== 'p-1' ? winnerCategory.rank : 'Royal Flush',
            bestHand: spec.rich && firstWinner !== 'p-1' ? winnerCategory.best : ['AS', 'KS', 'QH', 'JH', 'TH'],
            payouts: Object.fromEntries(spec.winnerIds.map((id) => [id, Math.round(80 / spec.winnerIds.length)])),
        },
        players,
    };
    return { room, state };
}

async function openShowdown(
    browser: Browser,
    numPlayers: number,
    spec: MockSpec,
): Promise<{ page: Page; close: () => Promise<void>; apply: (next: MockSpec) => Promise<void> }> {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
    const roomId = `ROOM_${numPlayers}P`;

    await page.addInitScript(({ authToken, id }) => {
        window.localStorage.setItem('poker-auth', JSON.stringify({
            token: authToken,
            roomId: id,
            playerName: 'Host',
            message: 'Success',
        }));
    }, { authToken: token, id: roomId });

    await setupStompWebSocketMock(page);

    // Later-registered routes win, so applying a new spec just registers the mocks again.
    const mock = async (next: MockSpec) => {
        const { room, state } = buildMocks(roomId, numPlayers, next);
        await page.route(`**/api/room/${roomId}`, (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(room),
        }));
        await page.route(`**/api/game/${roomId}/state`, (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(state),
        }));
        await page.route(`**/api/game/${roomId}/private-state`, (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ playerId: 'p-1', holeCards: ['AS', 'KS'] }),
        }));
    };
    const settle = async () => {
        await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
        await expect(page.getByTestId('hero-seat')).toBeVisible();
        await page.waitForTimeout(450);
    };

    await mock(spec);
    await page.goto(`http://localhost:5173/room/${roomId}`);
    await settle();

    return {
        page,
        close: () => context.close(),
        apply: async (next) => {
            await mock(next);
            await page.reload();
            await settle();
        },
    };
}

/** Opponent seats with the smallest x, the largest x and the smallest y (avatar centres, DOM order breaks ties). */
interface Extremes { left: string; right: string; top: string }

async function readExtremes(page: Page): Promise<Extremes | null> {
    return page.evaluate(() => {
        const seats = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="opponent-seat-"]')).map((el) => {
            const avatar = el.querySelector<HTMLElement>('[data-testid="player-avatar"]');
            const r = (avatar ?? el).getBoundingClientRect();
            return { id: (el.dataset.testid ?? '').replace('opponent-seat-', ''), x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (seats.length === 0) return null;
        const pick = (better: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean) =>
            seats.reduce((best, s) => (better(s, best) ? s : best)).id;
        return {
            left: pick((a, b) => a.x < b.x - 0.5),
            right: pick((a, b) => a.x > b.x + 0.5),
            top: pick((a, b) => a.y < b.y - 0.5),
        };
    });
}

/** Scenarios whose winner / disconnected seats depend on where the seats actually are. */
const isDynamic = (scenario: Scenario) =>
    scenario === 'oppWinsLeft' || scenario === 'oppWinsRight' || scenario === 'oppWinsTop' || scenario === 'splitPot';

function specFor(scenario: Scenario, count: number, extremes: Extremes | null): MockSpec {
    switch (scenario) {
        case 'main':
            return { phase: 'showdown', heroLast: false, rich: false, winnerIds: ['p-1'], disconnectedIds: [] };
        case 'heroLast':
            return { phase: 'showdown', heroLast: true, rich: false, winnerIds: ['p-1'], disconnectedIds: [] };
        case 'regular':
            return { phase: 'flop', heroLast: false, rich: false, winnerIds: [], disconnectedIds: [] };
        case 'splitPot': {
            const offline = extremes ? [...new Set([extremes.left, extremes.right, extremes.top])] : [];
            const all = Array.from({ length: count }, (_, i) => `p-${i + 1}`);
            return { phase: 'showdown', heroLast: false, rich: true, winnerIds: all, disconnectedIds: offline };
        }
        default: {
            const role = scenario === 'oppWinsLeft' ? 'left' : scenario === 'oppWinsRight' ? 'right' : 'top';
            // Before the seats are measured the winner is a placeholder (p-2); the first viewport re-mocks.
            const winner = extremes ? extremes[role] : 'p-2';
            const others = extremes ? [...new Set([extremes.left, extremes.right, extremes.top])].filter((id) => id !== winner) : [];
            return { phase: 'showdown', heroLast: false, rich: true, winnerIds: [winner], disconnectedIds: others };
        }
    }
}
const summarise = (violations: Violation[]) => {
    const byCheck: Partial<Record<Check, number>> = {};
    for (const v of violations) byCheck[v.check] = (byCheck[v.check] ?? 0) + 1;
    return byCheck;
};

const formatLine = (r: CaseResult, v: Violation) =>
    `${r.scenario === 'main' ? '' : `${r.scenario} `}${r.count}p@${r.viewport}  ${v.check}  ${v.a} x ${v.b}  ${v.detail}`;

/** Up to `cap` lines, round-robin across viewports, worst offenders first within each viewport. */
function pickLines(results: CaseResult[], cap: number): string[] {
    const queues = results
        .filter((r) => r.violations.length > 0)
        .map((r) => ({ r, list: [...r.violations].sort((x, y) => y.severity - x.severity), at: 0 }));
    const lines: string[] = [];
    while (lines.length < cap && queues.some((qq) => qq.at < qq.list.length)) {
        for (const qq of queues) {
            if (lines.length >= cap) break;
            if (qq.at < qq.list.length) lines.push(formatLine(qq.r, qq.list[qq.at++]));
        }
    }
    return lines;
}

function writeReport(results: CaseResult[]) {
    fs.mkdirSync(outDir, { recursive: true });
    const existing: CaseResult[] = fs.existsSync(reportPath)
        ? (JSON.parse(fs.readFileSync(reportPath, 'utf8')).cases as CaseResult[])
        : [];
    const key = (r: CaseResult) => `${r.scenario}:${r.count}:${r.viewport}`;
    const merged = new Map(existing.map((r) => [key(r), r]));
    for (const r of results) merged.set(key(r), r);
    const cases = [...merged.values()].sort(
        (a, b) => a.scenario.localeCompare(b.scenario) || a.count - b.count || a.viewport.localeCompare(b.viewport),
    );
    const byScenario: Record<string, { cases: number; failingCases: number; violations: number; reportOnlyViolations: number }> = {};
    for (const c of cases) {
        const s = (byScenario[c.scenario] ??= { cases: 0, failingCases: 0, violations: 0, reportOnlyViolations: 0 });
        s.cases += 1;
        s.failingCases += c.pass ? 0 : 1;
        s.violations += c.violationCount;
        s.reportOnlyViolations += c.reportOnlyViolations.length;
    }
    fs.writeFileSync(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        totalCases: cases.length,
        failingCases: cases.filter((c) => !c.pass).length,
        // Gating violations only; report-only violations are listed per case and totalled separately.
        totalViolations: cases.reduce((sum, c) => sum + c.violationCount, 0),
        reportOnlyViolations: cases.reduce((sum, c) => sum + c.reportOnlyViolations.length, 0),
        byScenario,
        cases,
    }, null, 1));
}

async function runScenario(
    browser: Browser,
    count: number,
    vps: typeof viewports,
    scenario: Scenario,
): Promise<CaseResult[]> {
    const heroLast = scenario === 'heroLast';
    const initial = specFor(scenario, count, null);
    const { page, close, apply } = await openShowdown(browser, count, initial);
    const dynamic = isDynamic(scenario);
    let applied = JSON.stringify(initial);
    const results: CaseResult[] = [];
    try {
        for (const vp of vps) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            if (dynamic) {
                // The winner / disconnected seats are the ones on the left, right and top of THIS viewport's layout.
                const next = specFor(scenario, count, await readExtremes(page));
                if (JSON.stringify(next) !== applied) {
                    await apply(next);
                    applied = JSON.stringify(next);
                    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
                }
            }
            const measurement = await page.evaluate(measureInPage);
            const { violations: found, minClearance, minPair } = analyze(measurement, count, heroLast);
            // LAYOUT_CHECKS drops unlisted checks entirely, before the gating split.
            const kept = found.filter((v) => !checkFilter || checkFilter.includes(v.check));
            const gatingChecks = gatingChecksFor(scenario);
            const violations = kept.filter((v) => gatingChecks.includes(v.check));
            const reportOnlyViolations = kept.filter((v) => !gatingChecks.includes(v.check));
            fs.mkdirSync(outDir, { recursive: true });
            if (process.env.LAYOUT_DUMP) {
                // Diagnostics for instrument sanity checks: the raw measurement of every case.
                fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });
                fs.writeFileSync(
                    path.join(outDir, 'raw', `${scenario}_${count}p_${vp.name}.json`),
                    JSON.stringify(measurement, null, 1),
                );
            }
            await page.screenshot({
                path: path.join(outDir, `${PNG_PREFIX[scenario]}_${count}p_${vp.name}.png`),
            });
            results.push({
                count,
                viewport: vp.name,
                scenario,
                gating: gatingChecks.length > 0,
                gatingChecks,
                pass: violations.length === 0,
                violationCount: violations.length,
                byCheck: summarise(violations),
                minClearance: minClearance === null ? null : Math.round(minClearance * 10) / 10,
                minPair,
                violations,
                reportOnlyViolations,
                reportOnlyByCheck: summarise(reportOnlyViolations),
            });
        }
    } finally {
        await close();
    }
    return results;
}

function assertResults(count: number, results: CaseResult[]) {
    writeReport(results);
    const total = results.reduce((sum, r) => sum + r.violationCount, 0);
    const reportOnly = results.reduce((sum, r) => sum + r.reportOnlyViolations.length, 0);
    const failing = results.filter((r) => !r.pass);
    const perViewport = results
        .map((r) => `${r.viewport}=${r.violationCount}${r.violationCount ? `(${Object.entries(r.byCheck).map(([k, v]) => `${k}${v}`).join(',')})` : ''}`)
        .join(' ');
    const lines = pickLines(results, MAX_LINES_PER_COUNT);
    const more = total - lines.length;
    const scenario = results[0]?.scenario ?? 'main';
    const message = [
        `${scenario === 'main' ? '' : `${scenario} `}${count}p: ${total} violations in ${failing.length}/${results.length} viewports  [${perViewport}]${reportOnly ? `  (+${reportOnly} report-only)` : ''}`,
        ...lines,
        more > 0 ? `... ${more} more (see test-results/layout-overlap/report.json)` : '',
    ].filter(Boolean).join('\n');
    expect.soft(total, message).toBe(0);
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

if (scenarioActive('main')) {
    test.describe('Showdown overlap 3 to 10 players', () => {
        test.setTimeout(120000);

        for (const count of activeCounts) {
            test(`No overlap, clipping or tiny text with ${count} players`, async ({ browser }) => {
                const results = await runScenario(browser, count, activeViewports, 'main');
                assertResults(count, results);
            });
        }
    });
}

if (scenarioActive('heroLast')) {
    test.describe('Showdown overlap, hero not first in players', () => {
        test.setTimeout(120000);

        const heroLastViewports = activeViewports.filter((vp) => HERO_LAST_VIEWPORTS.includes(vp.name));
        for (const count of activeCounts.filter((n) => HERO_LAST_COUNTS.includes(n))) {
            if (heroLastViewports.length === 0) continue;
            test(`hero not first with ${count} players`, async ({ browser }) => {
                const results = await runScenario(browser, count, heroLastViewports, 'heroLast');
                assertResults(count, results);
            });
        }
    });
}
const EXTRA_SCENARIOS: { scenario: Scenario; title: string }[] = [
    { scenario: 'oppWinsLeft', title: 'Opponent on the leftmost seat wins' },
    { scenario: 'oppWinsRight', title: 'Opponent on the rightmost seat wins' },
    { scenario: 'oppWinsTop', title: 'Opponent on the topmost seat wins' },
    { scenario: 'splitPot', title: 'Split pot, every player wins' },
    { scenario: 'regular', title: 'Regular state (flop), felt containment' },
];

for (const { scenario, title } of EXTRA_SCENARIOS) {
    if (!scenarioActive(scenario)) continue;
    test.describe(title, () => {
        // Dynamic scenarios re-mock and reload when the extreme seats change between viewports.
        test.setTimeout(240000);

        for (const count of activeCounts) {
            test(`${title}: ${count} players`, async ({ browser }) => {
                const results = await runScenario(browser, count, activeViewports, scenario);
                assertResults(count, results);
            });
        }
    });
}
