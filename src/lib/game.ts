import type { GameState } from '../types';

/**
 * Extracts the breakdown of pot amounts (including main and side pots)
 * with a fallback to the total pot array if side pots are not present.
 */
export function getPotBreakdown(gameState: Pick<GameState, 'pot' | 'pots'>): number[] {
    return gameState.pots && gameState.pots.length > 0 ? gameState.pots : [gameState.pot];
}

const rankNames: Record<string, string> = {
    '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', 'T': '10', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace'
};
const rankPlurals: Record<string, string> = {
    '2': '2s', '3': '3s', '4': '4s', '5': '5s', '6': '6s', '7': '7s', '8': '8s', '9': '9s', 'T': '10s', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces'
};
const suitNames: Record<string, string> = {
    'H': 'Hearts', 'D': 'Diamonds', 'C': 'Clubs', 'S': 'Spades'
};

export function formatHandRank(handRank?: string, bestHand?: string[]): string | null {
    if (!handRank || handRank.toUpperCase() === 'NO_HAND') return null;
    
    const hr = handRank.toUpperCase();
    
    if (!bestHand || bestHand.length === 0) {
        return hr.replace(/_/g, ' ');
    }

    const ranks = bestHand.map(c => c[0]);
    const suits = bestHand.map(c => c[1]);
    
    const rankCounts: Record<string, number> = {};
    for (const r of ranks) {
        rankCounts[r] = (rankCounts[r] || 0) + 1;
    }
    
    const rankValues = '23456789TJQKA';
    const sortedRanks = Object.keys(rankCounts).sort((a, b) => {
        if (rankCounts[b] !== rankCounts[a]) return rankCounts[b] - rankCounts[a];
        return rankValues.indexOf(b) - rankValues.indexOf(a);
    });

    const isLowStraight = (hr === 'STRAIGHT' || hr === 'STRAIGHT_FLUSH') && ranks.includes('A') && ranks.includes('2');
    const straightHigh = isLowStraight ? '5' : sortedRanks[0];

    if (hr === 'HIGH_CARD') return `${rankNames[sortedRanks[0]]} High`;
    if (hr === 'ONE_PAIR') return `One Pair (${rankPlurals[sortedRanks[0]]})`;
    if (hr === 'TWO_PAIR') return `Two Pair (${rankPlurals[sortedRanks[0]]} & ${rankPlurals[sortedRanks[1]]})`;
    if (hr === 'THREE_OF_A_KIND') return `Three of a Kind (${rankPlurals[sortedRanks[0]]})`;
    if (hr === 'STRAIGHT') return `Straight (${rankNames[straightHigh]} High)`;
    if (hr === 'FLUSH') return `Flush, ${suitNames[suits[0]]}`;
    if (hr === 'FULL_HOUSE') return `Full House (${rankPlurals[sortedRanks[0]]} full of ${rankPlurals[sortedRanks[1]]})`;
    if (hr === 'FOUR_OF_A_KIND') return `Four of a Kind (${rankPlurals[sortedRanks[0]]})`;
    if (hr === 'STRAIGHT_FLUSH') return `Straight Flush (${rankNames[straightHigh]} High, ${suitNames[suits[0]]})`;
    if (hr === 'ROYAL_FLUSH') return `Royal Flush, ${suitNames[suits[0]]}`;

    return hr.replace(/_/g, ' ');
}

/** Returns null for backend sentinel values (e.g. 'NO_HAND') that should not be displayed. */
export function formatEndMessage(message?: string): string | null {
    if (!message || message.toUpperCase() === 'NO_HAND') return null;
    return message;
}
