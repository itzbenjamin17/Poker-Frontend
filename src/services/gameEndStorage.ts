import type { GameEndResult } from '../types';

const GAME_END_STORAGE_PREFIX = 'poker-game-end:';

/**
 * Reads a previously frozen final-game snapshot from sessionStorage so a page
 * refresh during the post-game review can restore the review screen instead
 * of falling through to REST hydration (which 404s once the server has
 * cleaned up the room, kicking the player back to the lobby).
 */
export function loadPersistedGameEnd(roomId: string): GameEndResult | null {
    try {
        const key = GAME_END_STORAGE_PREFIX + roomId;
        let raw = sessionStorage.getItem(key);
        if (!raw) {
            // One-time migration for this tab from the previous shared store.
            raw = localStorage.getItem(key);
            if (raw) sessionStorage.setItem(key, raw);
            localStorage.removeItem(key);
        }
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
            sessionStorage.setItem(GAME_END_STORAGE_PREFIX + roomId, JSON.stringify(result));
        } else {
            sessionStorage.removeItem(GAME_END_STORAGE_PREFIX + roomId);
        }
    } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
}
