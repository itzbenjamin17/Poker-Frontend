import type { GameState } from '../types';

/**
 * Extracts the breakdown of pot amounts (including main and side pots)
 * with a fallback to the total pot array if side pots are not present.
 */
export function getPotBreakdown(gameState: Pick<GameState, 'pot' | 'pots'>): number[] {
    return gameState.pots && gameState.pots.length > 0 ? gameState.pots : [gameState.pot];
}
