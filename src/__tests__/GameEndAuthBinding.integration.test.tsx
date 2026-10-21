import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import GameView from '../GameView';
import { server } from '../test/mocks/server';
import { MockStompClient, activeSubscriptions } from '../test/mocks/stomp';
import { createValidGameState, createValidRoomData, createMockJwt, mockAuth } from '../test/fixtures';
import {
    savePersistedGameEnd,
    loadPersistedGameEnd,
    retireDifferentlyOwnedGameEnd,
    clearPersistedGameEnd,
} from '../services/gameEndStorage';
import type { AuthResponse, GameEndResult } from '../types';

describe('GameEnd Auth Binding & Offline Review Integration', () => {
    let authA: AuthResponse;
    let authB: AuthResponse;
    let terminalResultA: GameEndResult;

    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
        sessionStorage.clear();
        localStorage.clear();

        authA = {
            ...mockAuth,
            roomId: 'ROOM-100',
            playerName: 'Alice',
            token: createMockJwt(),
        };

        authB = {
            ...mockAuth,
            roomId: 'ROOM-100',
            playerName: 'Bob',
            token: createMockJwt(),
        };

        terminalResultA = {
            gameId: 'ROOM-100',
            winnerName: 'Alice',
            winnerChips: 5000,
            isForfeit: false,
            message: 'Alice won the game!',
            finalState: createValidGameState({
                gameId: 'ROOM-100',
                phase: 'SHOWDOWN',
                pot: 1000,
                communityCards: ['AH', 'KH', 'QH', 'JH', '10H'],
                players: [
                    { id: 'p-1', name: 'Alice', chips: 5000, currentBet: 0, status: 'ACTIVE', hasFolded: false, isWinner: true },
                    { id: 'p-2', name: 'Bob', chips: 0, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                ],
            }),
        };

        // Standard active table handlers for fallback hydration
        server.use(
            http.get('/api/room/ROOM-100', () => HttpResponse.json(createValidRoomData({
                roomId: 'ROOM-100',
                roomName: 'Poker Table',
                players: [
                    { name: 'Alice', isHost: true, joinedAt: '2026-01-01T00:00:00.000Z' },
                    { name: 'Bob', isHost: false, joinedAt: '2026-01-01T00:00:00.000Z' },
                ],
                gameStarted: true,
            }))),
            http.get('/api/game/ROOM-100/state', () => HttpResponse.json(createValidGameState({
                gameId: 'ROOM-100',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerId: 'p-1',
                currentPlayerName: 'Alice',
                legalActions: ['FOLD'],
                players: [
                    { id: 'p-1', name: 'Alice', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
                    { id: 'p-2', name: 'Bob', chips: 990, currentBet: 20, status: 'ACTIVE', isSmallBlind: true },
                ],
            }))),
            http.get('/api/game/ROOM-100/private-state', () => HttpResponse.json({
                playerId: 'p-1',
                handNumber: 0,
                holeCards: ['KH', 'KD'],
            }))
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("saves A's terminal result, refreshes A after server room/review cleanup, and asserts winner, chips, cards, and final standings without live socket setup", async () => {
        const activateSpy = vi.spyOn(MockStompClient.prototype, 'activate');
        const onLeaveSpy = vi.fn();

        // 1. Save A's terminal snapshot in storage
        savePersistedGameEnd(authA, terminalResultA);

        // 2. Server cleanup has occurred: REST endpoints return 404
        server.use(
            http.get('/api/room/ROOM-100', () => new HttpResponse(null, { status: 404 })),
            http.get('/api/game/ROOM-100/state', () => new HttpResponse(null, { status: 404 })),
            http.get('/api/game/ROOM-100/review', () => new HttpResponse(null, { status: 404 }))
        );

        // 3. Render GameView for Alice (simulating post-cleanup page refresh)
        render(<GameView auth={authA} onLeave={onLeaveSpy} />);

        // 4. Assert GameReviewView renders terminal standings immediately from valid auth-bound cache
        const gameOverHeading = await screen.findByRole('heading', { name: /game over/i });
        expect(gameOverHeading).toBeInTheDocument();
        expect(screen.getByText(/Alice won the game!/i)).toBeInTheDocument();
        expect(screen.getByText(/Collected 5000 chips/i)).toBeInTheDocument();

        // Check community cards from finalState
        expect(screen.getByTestId('board-card-0')).toBeInTheDocument();
        expect(screen.getByTestId('board-card-1')).toBeInTheDocument();
        expect(screen.getByTestId('board-card-2')).toBeInTheDocument();
        expect(screen.getByTestId('board-card-3')).toBeInTheDocument();
        expect(screen.getByTestId('board-card-4')).toBeInTheDocument();

        // 5. Assert live socket setup was completely skipped for offline review
        expect(activateSpy).not.toHaveBeenCalled();

        // Ensure no redirect/onLeave kicked the player back to lobby
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(onLeaveSpy).not.toHaveBeenCalled();
    });

    it('rejects terminal review when same room has fresh token B and hydrates normally', async () => {
        // Stored cache belongs to Alice (authA), but Bob arrives
        savePersistedGameEnd(authA, terminalResultA);

        server.use(
            http.get('/api/game/ROOM-100/private-state', () => HttpResponse.json({
                playerId: 'p-2',
                handNumber: 0,
                holeCards: ['AS', 'KS'],
            }))
        );

        render(<GameView auth={authB} />);
        expect(screen.queryByRole('heading', { name: /game over/i })).toBeNull();
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();
    });

    it('rejects terminal review when same player has a fresh replacement token and hydrates normally', async () => {
        savePersistedGameEnd(authA, terminalResultA);

        const authAFreshToken: AuthResponse = {
            ...authA,
            token: createMockJwt(Math.floor(Date.now() / 1000) + 7200),
        };

        render(<GameView auth={authAFreshToken} />);
        expect(screen.queryByRole('heading', { name: /game over/i })).toBeNull();
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();
    });

    it('rejects terminal review when storage contains malformed envelope, purges it, and hydrates normally', async () => {
        sessionStorage.setItem('poker-game-end:ROOM-100', '{corrupted json content');

        render(<GameView auth={authA} />);
        expect(screen.queryByRole('heading', { name: /game over/i })).toBeNull();
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();
        expect(sessionStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
    });

    it('rejects terminal review when envelope has mismatched result ID, purges it, and hydrates normally', async () => {
        sessionStorage.setItem('poker-game-end:ROOM-100', JSON.stringify({
            version: 1,
            roomId: 'ROOM-100',
            playerName: 'Alice',
            token: authA.token,
            result: {
                ...terminalResultA,
                gameId: 'DIFFERENT-ROOM-404',
            },
        }));

        render(<GameView auth={authA} />);
        expect(screen.queryByRole('heading', { name: /game over/i })).toBeNull();
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();
        expect(sessionStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
    });

    it('rejects terminal review when storage has unbound legacy entry, purges it, and hydrates normally', async () => {
        sessionStorage.clear();
        localStorage.setItem('poker-game-end:ROOM-100', JSON.stringify(terminalResultA));

        render(<GameView auth={authA} />);
        expect(screen.queryByRole('heading', { name: /game over/i })).toBeNull();
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();
        expect(localStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
    });

    it("preserves B's envelope when stale A resolves deferred leave or cache write", () => {
        // Bob has an active cached review in ROOM-100
        const terminalResultB: GameEndResult = {
            gameId: 'ROOM-100',
            winnerName: 'Bob',
            winnerChips: 3000,
            isForfeit: true,
            message: 'Bob won by forfeit!',
        };
        savePersistedGameEnd(authB, terminalResultB);

        // Stale A attempts to write a new terminal result or clear
        savePersistedGameEnd(authA, terminalResultA);
        savePersistedGameEnd(authA, null);
        clearPersistedGameEnd(authA);

        // Bob's envelope is completely untouched
        const loadedB = loadPersistedGameEnd(authB);
        expect(loadedB).toEqual(terminalResultB);
    });

    it('retires destination cache when a differently owned session is installed via retireDifferentlyOwnedGameEnd', () => {
        // Alice has an old review cached for ROOM-100
        savePersistedGameEnd(authA, terminalResultA);
        localStorage.setItem('poker-game-end:ROOM-100', 'legacy-unbound');

        // Bob logs into ROOM-100
        retireDifferentlyOwnedGameEnd(authB);

        // Cache for ROOM-100 is retired so Bob starts clean
        expect(sessionStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
        expect(localStorage.getItem('poker-game-end:ROOM-100')).toBeNull();
        expect(loadPersistedGameEnd(authB)).toBeNull();
    });

    it('handles quota-denied and security-blocked storage gracefully without crashing', () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('Access denied.', 'SecurityError');
        });

        expect(() => savePersistedGameEnd(authA, terminalResultA)).not.toThrow();
        expect(() => loadPersistedGameEnd(authA)).not.toThrow();
        expect(loadPersistedGameEnd(authA)).toBeNull();
        expect(() => clearPersistedGameEnd(authA)).not.toThrow();
        expect(() => retireDifferentlyOwnedGameEnd(authA)).not.toThrow();

        setItemSpy.mockRestore();
        getItemSpy.mockRestore();
    });
});
