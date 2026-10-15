import type { GameEndResult } from '../types';

const GAME_END_STORAGE_PREFIX = 'poker-game-end:';

/**
 * Reads a previously frozen final-game snapshot from localStorage so a page
 * refresh during the post-game review can restore the review screen instead
 * of falling through to REST hydration (which 404s once the server has
 * cleaned up the room, kicking the player back to the lobby).
 */
export function loadPersistedGameEnd(roomId: string): GameEndResult | null {
    try {
        const raw = localStorage.getItem(GAME_END_STORAGE_PREFIX + roomId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'isForfeit' in parsed && 'message' in parsed) {
            return parsed as GameEndResult;
        }
        return null;
    } catch {
        return null;
    }
}

export function savePersistedGameEnd(roomId: string, result: GameEndResult | null): void {
    try {
        if (result) {
            localStorage.setItem(GAME_END_STORAGE_PREFIX + roomId, JSON.stringify(result));
        } else {
            localStorage.removeItem(GAME_END_STORAGE_PREFIX + roomId);
        }
    } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
}
