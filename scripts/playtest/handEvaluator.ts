/**
 * Independent Texas Hold'em evaluator used as a test oracle for the server's showdown results.
 * Cards use the wire format: rank then suit letter, e.g. "10S", "QH", "2C".
 */

export const HAND_CATEGORIES = [
    'HIGH_CARD', 'ONE_PAIR', 'TWO_PAIR', 'THREE_OF_A_KIND', 'STRAIGHT',
    'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH',
] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandValue {
    category: HandCategory;
    /** Category index first, then tiebreak ranks; compare lexicographically. */
    score: number[];
}

const RANK_VALUES: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

function parse(card: string): { value: number; suit: string } {
    const value = RANK_VALUES[card.slice(0, -1)];
    if (value === undefined) throw new Error(`Unrecognised card ${card}`);
    return { value, suit: card.slice(-1) };
}

function straightHigh(values: number[]): number | null {
    const unique = [...new Set(values)].sort((a, b) => b - a);
    if (unique.length !== 5) return null;
    if (unique[0] - unique[4] === 4) return unique[0];
    if (unique.join(',') === '14,5,4,3,2') return 5;
    return null;
}

function evaluateFive(cards: string[]): HandValue {
    const parsed = cards.map(parse);
    const values = parsed.map(c => c.value).sort((a, b) => b - a);
    const flush = parsed.every(c => c.suit === parsed[0].suit);
    const high = straightHigh(values);
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const shape = groups.map(g => g[1]).join('');
    const byGroup = groups.map(g => g[0]);
    const make = (category: HandCategory, ranks: number[]): HandValue =>
        ({ category, score: [HAND_CATEGORIES.indexOf(category), ...ranks] });

    if (flush && high !== null) return make(high === 14 ? 'ROYAL_FLUSH' : 'STRAIGHT_FLUSH', [high]);
    if (shape === '41') return make('FOUR_OF_A_KIND', byGroup);
    if (shape === '32') return make('FULL_HOUSE', byGroup);
    if (flush) return make('FLUSH', values);
    if (high !== null) return make('STRAIGHT', [high]);
    if (shape === '311') return make('THREE_OF_A_KIND', byGroup);
    if (shape === '221') return make('TWO_PAIR', byGroup);
    if (shape === '2111') return make('ONE_PAIR', byGroup);
    return make('HIGH_CARD', values);
}

export function compareHands(a: HandValue, b: HandValue): number {
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
        const diff = (a.score[i] ?? 0) - (b.score[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** Best five-card hand from any 5–7 cards. */
export function bestHand(cards: string[]): HandValue {
    let best: HandValue | null = null;
    const pick = (start: number, chosen: string[]) => {
        if (chosen.length === 5) {
            const value = evaluateFive(chosen);
            if (!best || compareHands(value, best) > 0) best = value;
            return;
        }
        for (let i = start; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
    };
    pick(0, []);
    if (!best) throw new Error(`Need at least five cards, got ${cards.length}`);
    return best;
}

/** Names of the players holding the strongest hand (several on a tie). */
export function expectedWinners(board: string[], holes: Record<string, string[]>): string[] {
    const values = Object.entries(holes).map(([name, hole]) => ({ name, value: bestHand([...hole, ...board]) }));
    const top = values.reduce((best, v) => (compareHands(v.value, best) > 0 ? v.value : best), values[0].value);
    return values.filter(v => compareHands(v.value, top) === 0).map(v => v.name).sort();
}
