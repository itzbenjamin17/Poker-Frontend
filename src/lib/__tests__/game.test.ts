import { describe, expect, it } from 'vitest';
import { getPotBreakdown, formatHandRank } from '../game';

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
});

