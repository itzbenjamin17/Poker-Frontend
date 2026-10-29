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
    storedAt?: number;
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
        (candidate.storedAt === undefined || typeof candidate.storedAt === 'number') &&
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
export function loadPersistedGameEnd(auth: AuthIdentity): GameEndResult | null;
export function loadPersistedGameEnd(
    roomId: string,
    currentToken?: string,
    currentUsername?: string
): GameEndResult | null;
export function loadPersistedGameEnd(
    authOrRoomId: AuthIdentity | string,
    currentToken?: string,
    currentUsername?: string
): GameEndResult | null {
    if (typeof authOrRoomId === 'string') {
        return loadGameEndResult(authOrRoomId, currentToken, currentUsername);
    }
    const auth = authOrRoomId;
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
 * Loads a persisted game end result for a roomId, validating identity ownership if token
 * and/or playerName are provided. Rejects and invalidates stale entries from different users
 * or expired/corrupted entries. Preserves backward compatibility if an old unadorned payload
 * is encountered and no identity constraints are specified.
 */
export function loadGameEndResult(
    roomId: string,
    currentToken?: string,
    currentUsername?: string
): GameEndResult | null {
    if (currentToken && currentUsername) {
        return loadPersistedGameEnd({
            roomId,
            token: currentToken,
            playerName: currentUsername,
        });
    }

    const key = GAME_END_STORAGE_PREFIX + roomId;
    purgeLegacyLocalStorage(key);

    let rawSession: string | null = null;
    try {
        rawSession = sessionStorage.getItem(key);
    } catch {
        return null;
    }

    if (rawSession === null) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawSession);
    } catch {
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    if (isValidEnvelope(parsed)) {
        if (currentToken && parsed.token !== currentToken) {
            return null;
        }
        if (currentUsername && parsed.playerName !== currentUsername) {
            return null;
        }
        const decodedResult = decodeGameEndResult(parsed.result, roomId);
        if (!decodedResult || decodedResult.gameId !== roomId) {
            try {
                sessionStorage.removeItem(key);
            } catch {
                // Storage access denied
            }
            return null;
        }
        return decodedResult;
    }

    // If identity credentials were provided but the stored entry has no ownership envelope,
    // reject the unauthenticated entry to prevent stale review traps.
    if (currentToken || currentUsername) {
        try {
            sessionStorage.removeItem(key);
        } catch {
            // Storage access denied
        }
        return null;
    }

    // Fallback: unversioned legacy payload when no identity constraints were requested
    const decodedResult = decodeGameEndResult(parsed, roomId);
    if (!decodedResult || decodedResult.gameId !== roomId) {
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
export function savePersistedGameEnd(
    auth: AuthIdentity,
    result: GameEndResult | null,
    storedAt?: number
): void;
export function savePersistedGameEnd(
    roomId: string,
    result: GameEndResult | null,
    token?: string,
    playerName?: string,
    storedAt?: number
): void;
export function savePersistedGameEnd(
    authOrRoomId: AuthIdentity | string,
    result: GameEndResult | null,
    tokenOrStoredAt?: string | number,
    playerName?: string,
    storedAt?: number
): void {
    if (typeof authOrRoomId === 'string') {
        const token = typeof tokenOrStoredAt === 'string' ? tokenOrStoredAt : undefined;
        const time = typeof tokenOrStoredAt === 'number' ? tokenOrStoredAt : storedAt;
        saveGameEndResult(authOrRoomId, result, token, playerName, time);
        return;
    }

    const auth = authOrRoomId;
    const time = typeof tokenOrStoredAt === 'number' ? tokenOrStoredAt : storedAt;
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
                storedAt: typeof time === 'number' ? time : Date.now(),
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
 * Saves or clears a persisted game end result for a roomId, recording token and playerName
 * ownership when available.
 */
export function saveGameEndResult(
    roomId: string,
    result: GameEndResult | null,
    token?: string,
    playerName?: string,
    storedAt?: number
): void {
    if (token && playerName) {
        savePersistedGameEnd({ roomId, token, playerName }, result, storedAt);
        return;
    }

    const key = GAME_END_STORAGE_PREFIX + roomId;
    try {
        let rawSession: string | null = null;
        try {
            rawSession = sessionStorage.getItem(key);
        } catch {
            return;
        }

        if (rawSession !== null) {
            try {
                const parsed = JSON.parse(rawSession);
                if (isValidEnvelope(parsed)) {
                    const tokenMatches = !token || parsed.token === token;
                    const playerMatches = !playerName || parsed.playerName === playerName;
                    if (!tokenMatches || !playerMatches || (!token && !playerName)) {
                        // Do not overwrite or delete an owned envelope without matching identity
                        return;
                    }
                }
            } catch {
                // Malformed JSON can be overwritten or cleaned
            }
        }

        if (result) {
            const envelope: PersistedGameEndEnvelope = {
                version: 1,
                roomId,
                playerName: playerName ?? '',
                token: token ?? '',
                result,
                storedAt: typeof storedAt === 'number' ? storedAt : Date.now(),
            };
            sessionStorage.setItem(key, JSON.stringify(envelope));
        } else {
            sessionStorage.removeItem(key);
            purgeLegacyLocalStorage(key);
        }
    } catch {
        // Storage access denied
    }
}

/**
 * Convenience helper to clear the persisted game end envelope for an auth identity.
 */
export function clearPersistedGameEnd(auth: AuthIdentity): void;
export function clearPersistedGameEnd(
    roomId: string,
    token?: string,
    playerName?: string
): void;
export function clearPersistedGameEnd(
    authOrRoomId: AuthIdentity | string,
    token?: string,
    playerName?: string
): void {
    if (typeof authOrRoomId === 'string') {
        clearGameEndResult(authOrRoomId, token, playerName);
        return;
    }
    savePersistedGameEnd(authOrRoomId, null);
}

/**
 * Clears review state for a roomId with optional ownership validation.
 */
export function clearGameEndResult(
    roomId: string,
    token?: string,
    playerName?: string
): void {
    saveGameEndResult(roomId, null, token, playerName);
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
