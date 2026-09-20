import type { GameState } from '../types';

/**
 * Extracts the breakdown of pot amounts (including main and side pots)
 * with a fallback to the total pot array if side pots are not present.
 */
export function getPotBreakdown(gameState: Pick<GameState, 'pot' | 'pots'>): number[] {
    return gameState.pots && gameState.pots.length > 0 ? gameState.pots : [gameState.pot];
}

export function formatHandRank(handRank?: string): string | null {
    if (!handRank || handRank.toUpperCase() === 'NO_HAND') return null;
    return handRank.replace(/_/g, ' ');
}

/** Returns null for backend sentinel values (e.g. 'NO_HAND') that should not be displayed. */
export function formatEndMessage(message?: string): string | null {
    if (!message || message.toUpperCase() === 'NO_HAND') return null;
    return message;
}
