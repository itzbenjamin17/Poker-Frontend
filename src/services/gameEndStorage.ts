import type { GameEndResult } from '../types';
import { decodeGameEndResult } from '../lib/payloads';

const GAME_END_STORAGE_PREFIX = 'poker-game-end:';

export interface AuthIdentity {
    roomId: string;
    playerName: string;
    token: string;
}

export interface PersistedGameEndEnvelope {
    version: 1;
    roomId: string;
    playerName: string;
    token: string;
    result: GameEndResult;
}

function isValidEnvelope(value: unknown): value is PersistedGameEndEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        candidate.version === 1 &&
        typeof candidate.roomId === 'string' &&
        candidate.roomId.trim().length > 0 &&
        typeof candidate.playerName === 'string' &&
        candidate.playerName.trim().length > 0 &&
        typeof candidate.token === 'string' &&
        candidate.token.trim().length > 0 &&
        candidate.result !== null &&
        typeof candidate.result === 'object'
    );
}

function purgeLegacyLocalStorage(key: string): void {
    try {
        if (localStorage.getItem(key) !== null) {
            localStorage.removeItem(key);
        }
    } catch {
        // Storage access denied
    }
}

/**
 * Reads a previously frozen final-game snapshot from sessionStorage so a page
 * refresh during the post-game review can restore the review screen instead
 * of falling through to REST hydration (which 404s once the server has
 * cleaned up the room, kicking the player back to the lobby).
 *
 * Auth binding: Only loads when roomId, playerName, and token all match the
 * originating session and the inner result belongs to that room.
 */
export function loadPersistedGameEnd(auth: AuthIdentity): GameEndResult | null {
    const key = GAME_END_STORAGE_PREFIX + auth.roomId;

    // Reject and purge any legacy unversioned localStorage entry without importing
    purgeLegacyLocalStorage(key);

    let rawSession: string | null = null;
    try {
        rawSession = sessionStorage.getItem(key);
    } catch {
        // Storage access denied (SecurityError)
        return null;
    }

    if (rawSession === null) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawSession);
    } catch {
        // Corrupted JSON - purge invalid entry
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    if (!isValidEnvelope(parsed)) {
        // Unversioned raw result or malformed envelope - reject and purge
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    // Verify all three identity fields match
    if (
        parsed.roomId !== auth.roomId ||
        parsed.playerName !== auth.playerName ||
        parsed.token !== auth.token
    ) {
        // Belongs to another player/session in this room; preserve User B's envelope
        return null;
    }

    // Validate inner result and confirm room identity
    const decodedResult = decodeGameEndResult(parsed.result, auth.roomId);
    if (!decodedResult || decodedResult.gameId !== auth.roomId) {
        // Result is corrupted or points to a different room - purge
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    return decodedResult;
}

/**
 * Saves a versioned final-game snapshot to sessionStorage bound to auth identity,
 * or clears it if result is null.
 *
 * Stale protection: Checks existing envelope owner so User A never overwrites or
 * clears an envelope belonging to User B.
 */
export function savePersistedGameEnd(auth: AuthIdentity, result: GameEndResult | null): void {
    const key = GAME_END_STORAGE_PREFIX + auth.roomId;

    try {
        let rawSession: string | null = null;
        try {
            rawSession = sessionStorage.getItem(key);
        } catch {
            // Storage access denied
            return;
        }

        if (rawSession !== null) {
            try {
                const parsed = JSON.parse(rawSession);
                if (isValidEnvelope(parsed)) {
                    const isOwner =
                        parsed.roomId === auth.roomId &&
                        parsed.playerName === auth.playerName &&
                        parsed.token === auth.token;
                    if (!isOwner) {
                        // Different owner in same room - do NOT overwrite or delete
                        return;
                    }
                }
            } catch {
                // Malformed JSON - can be overwritten or cleaned below
            }
        }

        if (result) {
            const envelope: PersistedGameEndEnvelope = {
                version: 1,
                roomId: auth.roomId,
                playerName: auth.playerName,
                token: auth.token,
                result,
            };
            sessionStorage.setItem(key, JSON.stringify(envelope));
        } else {
            sessionStorage.removeItem(key);
            purgeLegacyLocalStorage(key);
        }
    } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
}

/**
 * Convenience helper to clear the persisted game end envelope for an auth identity.
 */
export function clearPersistedGameEnd(auth: AuthIdentity): void {
    savePersistedGameEnd(auth, null);
}

/**
 * Explicitly retires any cache for the destination room that is not owned by the newly
 * accepted auth (e.g. differently owned, unversioned, or corrupted entries) before
 * constructing a new session.
 */
export function retireDifferentlyOwnedGameEnd(auth: AuthIdentity): void {
    const key = GAME_END_STORAGE_PREFIX + auth.roomId;
    purgeLegacyLocalStorage(key);

    try {
        const rawSession = sessionStorage.getItem(key);
        if (rawSession !== null) {
            try {
                const parsed = JSON.parse(rawSession);
                if (isValidEnvelope(parsed)) {
                    const isOwner =
                        parsed.roomId === auth.roomId &&
                        parsed.playerName === auth.playerName &&
                        parsed.token === auth.token;
                    if (isOwner) {
                        return;
                    }
                }
            } catch {
                // Malformed JSON
            }
            sessionStorage.removeItem(key);
        }
    } catch {
        // Ignore storage errors
    }
}
