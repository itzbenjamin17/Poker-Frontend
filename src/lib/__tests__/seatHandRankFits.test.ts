import { describe, it, expect } from 'vitest';
import { getTableScale, seatHandRankFits } from '../tableGeometry';

describe('seatHandRankFits extraLines', () => {
    const table = { width: 559, height: 260 };
    const scale = getTableScale(table, 2);
    // Heads-up top-centre opponent seat on a phone-sized table, where only the label alone clears the board.
    const seat = { top: 12.7, left: 50, cardPlacement: 'right' as const };

    it('fits the hand label alone when no bet or status line is shown', () => {
        expect(seatHandRankFits(seat, table, scale, 'standard', 0)).toBe(true);
    });

    it('still reserves room for two extra lines by default', () => {
        expect(seatHandRankFits(seat, table, scale, 'standard')).toBe(false);
    });
});
