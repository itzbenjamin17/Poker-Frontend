import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    loadPersistedGameEnd,
    savePersistedGameEnd,
    clearPersistedGameEnd,
    retireDifferentlyOwnedGameEnd,
    type AuthIdentity,
    type PersistedGameEndEnvelope,
} from '../gameEndStorage';
import type { GameEndResult } from '../../types';

describe('gameEndStorage', () => {
    const authA: AuthIdentity = {
        roomId: 'room-123',
        playerName: 'Alice',
        token: 'token-alice-secret',
    };

    const authB: AuthIdentity = {
        roomId: 'room-123',
        playerName: 'Bob',
        token: 'token-bob-secret',
    };

    const validResult: GameEndResult = {
        gameId: 'room-123',
        winnerName: 'Alice',
        winnerChips: 500,
        isForfeit: false,
        message: 'Alice won the tournament!',
    };

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('returns null when no game end result is stored', () => {
        expect(loadPersistedGameEnd(authA)).toBeNull();
    });

    it('saves a versioned tab-local envelope to sessionStorage and loads it for matching auth', () => {
        savePersistedGameEnd(authA, validResult);

        const raw = sessionStorage.getItem('poker-game-end:room-123');
        expect(raw).not.toBeNull();
        const envelope = JSON.parse(raw!) as PersistedGameEndEnvelope;
        expect(envelope).toEqual({
            version: 1,
            roomId: authA.roomId,
            playerName: authA.playerName,
            token: authA.token,
            result: validResult,
        });

        const loaded = loadPersistedGameEnd(authA);
        expect(loaded).toEqual(validResult);
    });

    it('rejects loading when playerName does not match auth, preserving the envelope in storage', () => {
        savePersistedGameEnd(authA, validResult);

        const mismatchedPlayer: AuthIdentity = {
            roomId: authA.roomId,
            playerName: 'Charlie',
            token: authA.token,
        };

        expect(loadPersistedGameEnd(mismatchedPlayer)).toBeNull();
        // Envelope belonging to Alice must remain intact
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();
    });

    it('rejects loading when token does not match auth, preserving the envelope in storage', () => {
        savePersistedGameEnd(authA, validResult);

        const mismatchedToken: AuthIdentity = {
            roomId: authA.roomId,
            playerName: authA.playerName,
            token: 'token-replacement-fresh',
        };

        expect(loadPersistedGameEnd(mismatchedToken)).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();
    });

    it('rejects loading when result.gameId does not match auth.roomId and purges invalid envelope', () => {
        const corruptedResultEnvelope: PersistedGameEndEnvelope = {
            version: 1,
            roomId: authA.roomId,
            playerName: authA.playerName,
            token: authA.token,
            result: {
                ...validResult,
                gameId: 'different-room-999',
            },
        };
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify(corruptedResultEnvelope));

        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('rejects and purges unversioned raw-result entries from sessionStorage without throwing', () => {
        // Raw unversioned GameEndResult in sessionStorage
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify(validResult));

        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('rejects and purges legacy localStorage entries without migrating them to sessionStorage', () => {
        localStorage.setItem('poker-game-end:room-123', JSON.stringify(validResult));

        expect(loadPersistedGameEnd(authA)).toBeNull();
        // Purged from localStorage
        expect(localStorage.getItem('poker-game-end:room-123')).toBeNull();
        // Never migrated to sessionStorage
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('purges corrupted/invalid JSON entries from sessionStorage', () => {
        sessionStorage.setItem('poker-game-end:room-123', '{invalid json');
        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();

        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify({ version: 1, bad: 'shape' }));
        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('protects User B from a stale write by User A for the same room', () => {
        // User B has a saved review in room-123
        const resultB: GameEndResult = {
            gameId: 'room-123',
            winnerName: 'Bob',
            winnerChips: 1000,
            isForfeit: true,
            message: 'Bob won by forfeit!',
        };
        savePersistedGameEnd(authB, resultB);

        // Stale User A attempts to write to room-123
        savePersistedGameEnd(authA, validResult);

        // Storage still contains User B's envelope
        const raw = sessionStorage.getItem('poker-game-end:room-123');
        const envelope = JSON.parse(raw!) as PersistedGameEndEnvelope;
        expect(envelope.playerName).toBe('Bob');
        expect(envelope.token).toBe('token-bob-secret');
        expect(envelope.result.winnerName).toBe('Bob');
    });

    it('protects User B from a stale clear/save(null) by User A for the same room', () => {
        savePersistedGameEnd(authB, validResult);

        // Stale User A attempts to clear room-123
        savePersistedGameEnd(authA, null);
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();

        clearPersistedGameEnd(authA);
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();

        // Valid User B can clear their own envelope
        clearPersistedGameEnd(authB);
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('retireDifferentlyOwnedGameEnd removes conflicting/unowned/legacy cache but preserves same-auth cache', () => {
        // 1. Differently owned cache (User B) is retired when User A arrives
        savePersistedGameEnd(authB, validResult);
        localStorage.setItem('poker-game-end:room-123', 'legacy');
        retireDifferentlyOwnedGameEnd(authA);
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
        expect(localStorage.getItem('poker-game-end:room-123')).toBeNull();

        // 2. Unversioned/corrupt cache is retired
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify({ raw: 'unversioned' }));
        retireDifferentlyOwnedGameEnd(authA);
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();

        // 3. Same-auth cache is preserved
        savePersistedGameEnd(authA, validResult);
        retireDifferentlyOwnedGameEnd(authA);
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();
        expect(loadPersistedGameEnd(authA)).toEqual(validResult);
    });

    it('handles storage exceptions gracefully during load, save, clear, and retire', () => {
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('Denied', 'SecurityError');
        });
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceeded', 'QuotaExceededError');
        });
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Denied', 'SecurityError');
        });

        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(() => savePersistedGameEnd(authA, validResult)).not.toThrow();
        expect(() => clearPersistedGameEnd(authA)).not.toThrow();
        expect(() => retireDifferentlyOwnedGameEnd(authA)).not.toThrow();

        getItemSpy.mockRestore();
        setItemSpy.mockRestore();
        removeItemSpy.mockRestore();
    });
});
