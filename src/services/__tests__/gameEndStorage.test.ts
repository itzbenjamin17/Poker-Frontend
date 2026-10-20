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
            gameId: 'room-legacy',
            winnerName: 'Alice',
            winnerChips: 500,
            isForfeit: false,
            message: 'Alice won the game!',
        };
        // Stored without gameId on legacy store
        localStorage.setItem('poker-game-end:room-legacy', JSON.stringify({
            winnerName: 'Alice',
            winnerChips: 500,
            isForfeit: false,
            message: 'Alice won the game!',
        }));

        // First tab load: migrates to sessionStorage and removes from localStorage
        const loaded = loadPersistedGameEnd('room-legacy');
        expect(loaded).toEqual(gameEnd);
        expect(localStorage.getItem('poker-game-end:room-legacy')).toBeNull();
        expect(JSON.parse(sessionStorage.getItem('poker-game-end:room-legacy')!)).toEqual(gameEnd);

        // A second tab with empty sessionStorage will not find it in localStorage
        sessionStorage.clear();
        expect(loadPersistedGameEnd('room-legacy')).toBeNull();
    });

    it('returns null and removes invalid cache entries from sessionStorage', () => {
        // Invalid json
        sessionStorage.setItem('poker-game-end:room-bad', '{invalid json');
        expect(loadPersistedGameEnd('room-bad')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad')).toBeNull();

        // Wrong fields / missing required
        sessionStorage.setItem('poker-game-end:room-bad2', JSON.stringify({ wrong: 'fields' }));
        expect(loadPersistedGameEnd('room-bad2')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad2')).toBeNull();

        // Invalid negative winnerChips
        sessionStorage.setItem('poker-game-end:room-bad3', JSON.stringify({
            gameId: 'room-bad3',
            winnerName: 'Alice',
            winnerChips: -10,
            isForfeit: false,
            message: 'Alice won',
        }));
        expect(loadPersistedGameEnd('room-bad3')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad3')).toBeNull();

        // Invalid empty message
        sessionStorage.setItem('poker-game-end:room-bad4', JSON.stringify({
            gameId: 'room-bad4',
            winnerName: 'Alice',
            isForfeit: false,
            message: '   ',
        }));
        expect(loadPersistedGameEnd('room-bad4')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad4')).toBeNull();

        // Invalid non-boolean isForfeit
        sessionStorage.setItem('poker-game-end:room-bad5', JSON.stringify({
            gameId: 'room-bad5',
            winnerName: 'Alice',
            isForfeit: 'not-bool',
            message: 'Alice won',
        }));
        expect(loadPersistedGameEnd('room-bad5')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad5')).toBeNull();

        // Corrupted finalState
        sessionStorage.setItem('poker-game-end:room-bad6', JSON.stringify({
            gameId: 'room-bad6',
            winnerName: 'Alice',
            isForfeit: false,
            message: 'Alice won',
            finalState: { pot: -99 },
        }));
        expect(loadPersistedGameEnd('room-bad6')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad6')).toBeNull();

        // Mismatched finalState gameId
        sessionStorage.setItem('poker-game-end:room-bad7', JSON.stringify({
            gameId: 'room-bad7',
            winnerName: 'Alice',
            isForfeit: false,
            message: 'Alice won',
            finalState: {
                gameId: 'different-room',
                maxPlayers: 6,
                pot: 100,
                phase: 'SHOWDOWN',
                currentBet: 0,
                communityCards: [],
                players: [],
                currentPlayerName: '',
                currentPlayerId: '',
            },
        }));
        expect(loadPersistedGameEnd('room-bad7')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-bad7')).toBeNull();
    });

    it('purges corrupted legacy entries from localStorage without migrating them', () => {
        localStorage.setItem('poker-game-end:room-legacy-corrupted', JSON.stringify({
            winnerName: 'Alice',
            winnerChips: -50,
            isForfeit: false,
            message: 'Bad chips',
        }));

        expect(loadPersistedGameEnd('room-legacy-corrupted')).toBeNull();
        expect(localStorage.getItem('poker-game-end:room-legacy-corrupted')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-legacy-corrupted')).toBeNull();
    });

    it('saves to and removes from sessionStorage', () => {
        const gameEnd: GameEndResult = {
            gameId: 'room-save',
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
        expect(() => savePersistedGameEnd('room-error', { gameId: 'room-error', winnerName: 'C', isForfeit: false, message: 'm' })).not.toThrow();
        expect(() => savePersistedGameEnd('room-error', null)).not.toThrow();

        getItemSpy.mockRestore();
        setItemSpy.mockRestore();
        removeItemSpy.mockRestore();
    });
});
