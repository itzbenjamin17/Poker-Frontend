// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPotBreakdown, formatHandRank, formatHandRankShort } from '../game';

describe('lib/game - getPotBreakdown', () => {
    it('returns pots array when pots is non-empty', () => {
        const result = getPotBreakdown({
            pot: 1500,
            pots: [1000, 500],
        });
        expect(result).toEqual([1000, 500]);
    });

    it('returns [pot] as fallback when pots is undefined', () => {
        const result = getPotBreakdown({
            pot: 750,
        });
        expect(result).toEqual([750]);
    });

    it('returns [pot] as fallback when pots is null or empty array', () => {
        const resultWithEmpty = getPotBreakdown({
            pot: 500,
            pots: [],
        });
        expect(resultWithEmpty).toEqual([500]);

        const resultWithNull = getPotBreakdown({
            pot: 250,
            pots: null as unknown as number[],
        });
        expect(resultWithNull).toEqual([250]);
    });

    it('handles zero-value pots correctly', () => {
        const resultZeroPots = getPotBreakdown({
            pot: 0,
            pots: [0],
        });
        expect(resultZeroPots).toEqual([0]);

        const resultZeroPotFallback = getPotBreakdown({
            pot: 0,
            pots: [],
        });
        expect(resultZeroPotFallback).toEqual([0]);
    });

    it('handles multiple side pots with precision', () => {
        const pots = [1000, 500, 300, 200];
        const result = getPotBreakdown({
            pot: 2000,
            pots,
        });
        expect(result).toEqual([1000, 500, 300, 200]);
        expect(result).toHaveLength(4);
    });
});

describe('lib/game - formatHandRank', () => {
    it('formats hand rank by replacing underscores with spaces', () => {
        expect(formatHandRank('ROYAL_FLUSH')).toBe('ROYAL FLUSH');
        expect(formatHandRank('TWO_PAIR')).toBe('TWO PAIR');
        expect(formatHandRank('HIGH_CARD')).toBe('HIGH CARD');
    });

    it('returns null for NO_HAND in any casing', () => {
        expect(formatHandRank('NO_HAND')).toBeNull();
        expect(formatHandRank('no_hand')).toBeNull();
        expect(formatHandRank('No_Hand')).toBeNull();
    });

    it('returns null for undefined or empty strings', () => {
        expect(formatHandRank(undefined)).toBeNull();
        expect(formatHandRank('')).toBeNull();
    });

    it('formats full house with 10s correctly', () => {
        expect(formatHandRank('FULL_HOUSE', ['10H', '10D', '10C', '9S', '9D'])).toBe('Full House (10s full of 9s)');
        expect(formatHandRank('FULL_HOUSE', ['9H', '9D', '9C', '10S', '10D'])).toBe('Full House (9s full of 10s)');
    });

    it('formats lowercase suits and ranks accurately for pairs and flushes', () => {
        expect(formatHandRank('ONE_PAIR', ['Ah', 'Ad', 'Ks', 'Qc', 'Jd'])).toBe('One Pair (Aces)');
        expect(formatHandRank('TWO_PAIR', ['Ah', 'Ad', 'Ks', 'Kd', 'Qc'])).toBe('Two Pair (Aces & Kings)');
        expect(formatHandRank('FLUSH', ['Ah', 'Kh', '9h', '5h', '2h'])).toBe('Flush, Hearts');
        expect(formatHandRank('ROYAL_FLUSH', ['Ah', 'Kh', 'Qh', 'Jh', '10h'])).toBe('Royal Flush, Hearts');
        expect(formatHandRank('STRAIGHT_FLUSH', ['9d', '8d', '7d', '6d', '5d'])).toBe('Straight Flush (9 High, Diamonds)');
    });
});

describe('lib/game - formatHandRankShort (seat label ladder)', () => {
    const CATEGORIES = [
        'HIGH_CARD', 'ONE_PAIR', 'TWO_PAIR', 'THREE_OF_A_KIND', 'STRAIGHT',
        'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH',
    ];

    it('keeps the short categories unchanged on every tier', () => {
        for (const tier of ['compact', 'standard', 'wide'] as const) {
            expect(formatHandRankShort('HIGH_CARD', tier)).toBe('HIGH CARD');
            expect(formatHandRankShort('ONE_PAIR', tier)).toBe('ONE PAIR');
            expect(formatHandRankShort('TWO_PAIR', tier)).toBe('TWO PAIR');
            expect(formatHandRankShort('STRAIGHT', tier)).toBe('STRAIGHT');
            expect(formatHandRankShort('FLUSH', tier)).toBe('FLUSH');
        }
    });

    it('shortens the long categories per tier', () => {
        expect(formatHandRankShort('THREE_OF_A_KIND', 'standard')).toBe('3 OF A KIND');
        expect(formatHandRankShort('THREE_OF_A_KIND', 'wide')).toBe('3 OF A KIND');
        expect(formatHandRankShort('THREE_OF_A_KIND', 'compact')).toBe('TRIPS');
        expect(formatHandRankShort('FOUR_OF_A_KIND', 'standard')).toBe('4 OF A KIND');
        expect(formatHandRankShort('FOUR_OF_A_KIND', 'compact')).toBe('QUADS');
        expect(formatHandRankShort('FULL_HOUSE', 'standard')).toBe('FULL HOUSE');
        expect(formatHandRankShort('FULL_HOUSE', 'compact')).toBe('FULL HSE');
        expect(formatHandRankShort('STRAIGHT_FLUSH', 'wide')).toBe('STR. FLUSH');
        expect(formatHandRankShort('STRAIGHT_FLUSH', 'compact')).toBe('ST. FLUSH');
        expect(formatHandRankShort('ROYAL_FLUSH', 'standard')).toBe('ROYAL FLUSH');
        expect(formatHandRankShort('ROYAL_FLUSH', 'compact')).toBe('ROYAL FL.');
    });

    it('stays within 11 characters on standard / wide tables and 9 on compact ones, for all ten categories', () => {
        for (const category of CATEGORIES) {
            for (const tier of ['standard', 'wide'] as const) {
                expect(formatHandRankShort(category, tier)!.length, `${category} ${tier}`).toBeLessThanOrEqual(11);
            }
            expect(formatHandRankShort(category, 'compact')!.length, `${category} compact`).toBeLessThanOrEqual(9);
        }
    });

    it('is never longer than the full text and is the same for mixed casing and spaces', () => {
        expect(formatHandRankShort('two_pair', 'standard')).toBe('TWO PAIR');
        expect(formatHandRankShort('Two Pair', 'compact')).toBe('TWO PAIR');
        expect(formatHandRankShort('Royal Flush', 'compact')).toBe('ROYAL FL.');
        expect(formatHandRankShort('Royal Flush', 'standard')).toBe('ROYAL FLUSH');
    });

    it('falls back to upper-cased text with spaces for unknown values', () => {
        expect(formatHandRankShort('Mystery_Hand', 'standard')).toBe('MYSTERY HAND');
    });

    it('returns null for sentinels, empty and undefined, like formatHandRank', () => {
        expect(formatHandRankShort('NO_HAND', 'standard')).toBeNull();
        expect(formatHandRankShort('no_hand', 'compact')).toBeNull();
        expect(formatHandRankShort('', 'wide')).toBeNull();
        expect(formatHandRankShort(undefined, 'standard')).toBeNull();
    });

    it('does not change formatHandRank: full text, with and without bestHand', () => {
        expect(formatHandRank('THREE_OF_A_KIND')).toBe('THREE OF A KIND');
        expect(formatHandRank('FULL_HOUSE', ['QS', 'QD', 'QC', 'JH', 'JS'])).toBe('Full House (Queens full of Jacks)');
        expect(formatHandRank('ROYAL_FLUSH', ['TS', 'JS', 'QS', 'KS', 'AS'])).toBe('Royal Flush, Spades');
        expect(formatHandRank('NO_HAND')).toBeNull();
    });
});
