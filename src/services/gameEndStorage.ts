import type { GameEndResult } from '../types';
import { decodeGameEndResult } from '../lib/payloads';

const GAME_END_STORAGE_PREFIX = 'poker-game-end:';

function parseAndValidateGameEnd(raw: string, roomId: string): GameEndResult | null {
    try {
        const parsed = JSON.parse(raw);
        return decodeGameEndResult(parsed, roomId);
    } catch {
        return null;
    }
}

/**
 * Reads a previously frozen final-game snapshot from sessionStorage so a page
 * refresh during the post-game review can restore the review screen instead
 * of falling through to REST hydration (which 404s once the server has
 * cleaned up the room, kicking the player back to the lobby).
 */
export function loadPersistedGameEnd(roomId: string): GameEndResult | null {
    const key = GAME_END_STORAGE_PREFIX + roomId;

    let rawSession: string | null = null;
    try {
        rawSession = sessionStorage.getItem(key);
    } catch {
        // Storage access denied (SecurityError)
    }

    if (rawSession !== null) {
        const validated = parseAndValidateGameEnd(rawSession, roomId);
        if (validated) {
            return validated;
        }
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    // Check legacy localStorage for one-time tab migration
    let rawLocal: string | null = null;
    try {
        rawLocal = localStorage.getItem(key);
    } catch {
        // Storage access denied
    }

    if (rawLocal !== null) {
        const validated = parseAndValidateGameEnd(rawLocal, roomId);
        if (validated) {
            try {
                sessionStorage.setItem(key, JSON.stringify(validated));
            } catch {
                // Storage denied / quota exceeded
            }
            try {
                localStorage.removeItem(key);
            } catch {
                // Storage access denied
            }
            return validated;
        } else {
            // Purge invalid legacy entry
            try {
                localStorage.removeItem(key);
            } catch {
                // Storage access denied
            }
            return null;
        }
    }

    return null;
}

export function savePersistedGameEnd(roomId: string, result: GameEndResult | null): void {
    const key = GAME_END_STORAGE_PREFIX + roomId;
    try {
        if (result) {
            sessionStorage.setItem(key, JSON.stringify(result));
        } else {
            sessionStorage.removeItem(key);
        }
    } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
}
