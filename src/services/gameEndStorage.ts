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

function getStorageKey(roomId: string): string {
    return GAME_END_STORAGE_PREFIX + roomId;
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

function removeSessionEntry(key: string): void {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Storage access denied
    }
}

function readRawSessionEntry(key: string): { ok: true; raw: string | null } | { ok: false } {
    try {
        return { ok: true, raw: sessionStorage.getItem(key) };
    } catch {
        // Storage access denied (SecurityError)
        return { ok: false };
    }
}

function decodeAndValidateRoomResult(
    rawResult: unknown,
    roomId: string,
    key: string
): GameEndResult | null {
    const decodedResult = decodeGameEndResult(rawResult, roomId);
    if (!decodedResult || decodedResult.gameId !== roomId) {
        removeSessionEntry(key);
        return null;
    }
    return decodedResult;
}

function doesEnvelopeMatchCaller(
    envelope: PersistedGameEndEnvelope,
    roomId: string,
    token?: string,
    playerName?: string,
    requireFullAuth = false
): boolean {
    if (envelope.roomId !== roomId) {
        return false;
    }
    if (requireFullAuth) {
        return envelope.token === token && envelope.playerName === playerName;
    }
    const tokenMatches = !token || envelope.token === token;
    const playerMatches = !playerName || envelope.playerName === playerName;
    return Boolean(token || playerName) && tokenMatches && playerMatches;
}

function readPersistedGameEndInternal(
    roomId: string,
    token?: string,
    playerName?: string,
    requireFullAuth = false
): GameEndResult | null {
    const key = getStorageKey(roomId);
    purgeLegacyLocalStorage(key);

    const entry = readRawSessionEntry(key);
    if (!entry.ok || entry.raw === null) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(entry.raw);
    } catch {
        removeSessionEntry(key);
        return null;
    }

    if (isValidEnvelope(parsed)) {
        if (requireFullAuth) {
            if (!doesEnvelopeMatchCaller(parsed, roomId, token, playerName, true)) {
                return null;
            }
        } else {
            if (parsed.roomId !== roomId) {
                return null;
            }
            if (token && parsed.token !== token) {
                return null;
            }
            if (playerName && parsed.playerName !== playerName) {
                return null;
            }
        }
        return decodeAndValidateRoomResult(parsed.result, roomId, key);
    }

    if (requireFullAuth || token || playerName) {
        removeSessionEntry(key);
        return null;
    }

    // Fallback: unversioned legacy payload when no identity constraints were requested
    return decodeAndValidateRoomResult(parsed, roomId, key);
}

function writePersistedGameEndInternal(
    roomId: string,
    result: GameEndResult | null,
    token?: string,
    playerName?: string,
    storedAt?: number,
    requireFullAuth = false
): void {
    const key = getStorageKey(roomId);
    const entry = readRawSessionEntry(key);
    if (!entry.ok) {
        return;
    }

    try {
        if (entry.raw !== null) {
            try {
                const parsed = JSON.parse(entry.raw);
                if (
                    isValidEnvelope(parsed) &&
                    !doesEnvelopeMatchCaller(parsed, roomId, token, playerName, requireFullAuth)
                ) {
                    // Do not overwrite or delete an envelope owned by another session/player
                    return;
                }
            } catch {
                // Malformed JSON - can be overwritten or cleaned below
            }
        }

        if (result) {
            if (!roomId.trim() || !token?.trim() || !playerName?.trim()) {
                return;
            }
            const envelope: PersistedGameEndEnvelope = {
                version: 1,
                roomId,
                playerName,
                token,
                result,
                storedAt: typeof storedAt === 'number' ? storedAt : Date.now(),
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
    return readPersistedGameEndInternal(
        authOrRoomId.roomId,
        authOrRoomId.token,
        authOrRoomId.playerName,
        true
    );
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
    return readPersistedGameEndInternal(
        roomId,
        currentToken,
        currentUsername,
        Boolean(currentToken && currentUsername)
    );
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

    const time = typeof tokenOrStoredAt === 'number' ? tokenOrStoredAt : storedAt;
    writePersistedGameEndInternal(
        authOrRoomId.roomId,
        result,
        authOrRoomId.token,
        authOrRoomId.playerName,
        time,
        true
    );
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
    writePersistedGameEndInternal(
        roomId,
        result,
        token,
        playerName,
        storedAt,
        Boolean(token && playerName)
    );
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
    const key = getStorageKey(auth.roomId);
    purgeLegacyLocalStorage(key);

    const entry = readRawSessionEntry(key);
    if (!entry.ok || entry.raw === null) {
        return;
    }

    try {
        const parsed = JSON.parse(entry.raw);
        if (
            isValidEnvelope(parsed) &&
            doesEnvelopeMatchCaller(parsed, auth.roomId, auth.token, auth.playerName, true)
        ) {
            return;
        }
    } catch {
        // Malformed JSON
    }
    removeSessionEntry(key);
}
