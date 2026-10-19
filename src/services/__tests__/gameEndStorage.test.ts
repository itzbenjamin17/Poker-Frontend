import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPersistedGameEnd, savePersistedGameEnd } from '../gameEndStorage';
import type { GameEndResult } from '../../types';

describe('gameEndStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('returns null when no game end result is stored', () => {
        expect(loadPersistedGameEnd('room-1')).toBeNull();
    });

    it('migrates legacy localStorage entry into sessionStorage once and deletes it from localStorage', () => {
        const gameEnd: GameEndResult = {
            winnerName: 'Alice',
            winnerChips: 500,
            isForfeit: false,
            message: 'Alice won the game!',
        };
        localStorage.setItem('poker-game-end:room-legacy', JSON.stringify(gameEnd));

        // First tab load: migrates to sessionStorage and removes from localStorage
        const loaded = loadPersistedGameEnd('room-legacy');
        expect(loaded).toEqual(gameEnd);
        expect(localStorage.getItem('poker-game-end:room-legacy')).toBeNull();
        expect(JSON.parse(sessionStorage.getItem('poker-game-end:room-legacy')!)).toEqual(gameEnd);

        // A second tab with empty sessionStorage will not find it in localStorage
        sessionStorage.clear();
        expect(loadPersistedGameEnd('room-legacy')).toBeNull();
    });

    it('returns null when stored payload is malformed', () => {
        sessionStorage.setItem('poker-game-end:room-bad', '{invalid json');
        expect(loadPersistedGameEnd('room-bad')).toBeNull();

        sessionStorage.setItem('poker-game-end:room-bad2', JSON.stringify({ wrong: 'fields' }));
        expect(loadPersistedGameEnd('room-bad2')).toBeNull();
    });

    it('saves to and removes from sessionStorage', () => {
        const gameEnd: GameEndResult = {
            winnerName: 'Bob',
            isForfeit: true,
            message: 'Bob won by forfeit!',
        };
        savePersistedGameEnd('room-save', gameEnd);
        expect(loadPersistedGameEnd('room-save')).toEqual(gameEnd);

        savePersistedGameEnd('room-save', null);
        expect(loadPersistedGameEnd('room-save')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-save')).toBeNull();
    });

    it('handles storage exceptions gracefully during load and save', () => {
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('Denied', 'SecurityError');
        });
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceeded', 'QuotaExceededError');
        });
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Denied', 'SecurityError');
        });

        expect(loadPersistedGameEnd('room-error')).toBeNull();
        expect(() => savePersistedGameEnd('room-error', { winnerName: 'C', isForfeit: false, message: 'm' })).not.toThrow();
        expect(() => savePersistedGameEnd('room-error', null)).not.toThrow();

        getItemSpy.mockRestore();
        setItemSpy.mockRestore();
        removeItemSpy.mockRestore();
    });
});
