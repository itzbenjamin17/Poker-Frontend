import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GameView from '../GameView';
import { GameSession } from '../domain/GameSession';
import { InMemoryTransportAdapter } from '../services/transport';
import { TestClock } from '../domain/clock';
import { pokerApi } from '../services/api';
import type { AuthResponse, GameState } from '../types';

vi.mock('../services/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/api')>();
    return {
        ...actual,
        pokerApi: {
            getRoomInfo: vi.fn().mockResolvedValue(null),
            getGameState: vi.fn().mockResolvedValue(null),
            getPrivateState: vi.fn().mockResolvedValue(null),
            startGame: vi.fn(),
            claimWin: vi.fn(),
            leaveGame: vi.fn(),
            leaveRoom: vi.fn(),
        },
    };
});

describe('Disconnect & Leave Edge Cases', () => {
    const mockAuth: AuthResponse = {
        token: 'test-token',
        roomId: 'ROOM123',
        playerName: 'P1',
        message: 'Success',
    };

    const initialGameState: GameState = {
        gameId: 'ROOM123',
        phase: 'TURN',
        pot: 100,
        currentBet: 0,
        communityCards: ['3c', '5s', '4s', '8d'],
        maxPlayers: 6,
        currentPlayerName: 'P1',
        currentPlayerId: 'p-1',
        players: [
            { id: 'p-1', name: 'P1', chips: 950, currentBet: 0, hasFolded: false, status: 'DISCONNECTED' },
            { id: 'p-2', name: 'P2', chips: 950, currentBet: 0, hasFolded: false, status: 'ACTIVE' },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        window.innerWidth = 1280;
        window.innerHeight = 800;
        vi.mocked(pokerApi.getRoomInfo).mockResolvedValue({
            roomId: 'ROOM123',
            roomName: 'Test',
            players: [
                { name: 'P1', isHost: true, joinedAt: '2026-10-12T00:00:00Z' },
                { name: 'P2', isHost: false, joinedAt: '2026-10-12T00:00:00Z' },
            ],
            maxPlayers: 6,
            buyIn: 1000,
            smallBlind: 10,
            bigBlind: 20,
            canStartGame: true,
            gameStarted: true,
            createdAt: '2026-10-12T00:00:00Z',
            hostName: 'P1',
            currentPlayers: 2,
        });
        vi.mocked(pokerApi.getGameState).mockResolvedValue(initialGameState);
        vi.mocked(pokerApi.getPrivateState).mockResolvedValue({ playerId: 'p-2', holeCards: ['2c', '4h'] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not flicker GameReviewView when LEAVE_GAME triggers a server GAME_END broadcast before leaveRoom finishes', async () => {
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const onLeave = vi.fn();

        const session = new GameSession({
            auth: { ...mockAuth, playerName: 'P2' },
            transport,
            clock,
            onLeave,
            initialRoomState: {
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [
                    { name: 'P1', isHost: true },
                    { name: 'P2', isHost: false },
                ],
                gameStarted: true,
            },
            initialGameState,
        });

        // When P2 calls leaveGame, the server immediately broadcasts GAME_END to /game/ROOM123
        // before leaveRoom finishes resolving.
        let resolveLeaveRoom!: () => void;
        vi.mocked(pokerApi.leaveGame).mockImplementation(async () => {
            transport.simulateMessage('/game/ROOM123', {
                type: 'GAME_END',
                gameId: 'ROOM123',
                winner: 'P1',
                winnerChips: 1050,
                isForfeit: true,
                message: 'P1 wins by forfeit!',
                finalState: initialGameState,
            });
        });
        vi.mocked(pokerApi.leaveRoom).mockImplementation(
            () => new Promise<void>((resolve) => { resolveLeaveRoom = resolve; })
        );

        render(<GameView auth={{ ...mockAuth, playerName: 'P2' }} onLeave={onLeave} session={session} />);

        const leaveBtn = await screen.findByRole('button', { name: /leave table/i });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        await act(async () => {
            leaveBtn.click();
        });

        // While leaveRoom is still in flight, P2 must NOT see the GAME OVER review screen!
        expect(session.getSnapshot().isGameOver).toBe(false);
        expect(screen.queryByText(/GAME OVER/i)).not.toBeInTheDocument();

        await act(async () => {
            resolveLeaveRoom();
        });
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('schedules redirect to lobby when ACTION_ERROR reports "Game not found"', () => {
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const onLeave = vi.fn();

        const session = new GameSession({
            auth: mockAuth,
            transport,
            clock,
            onLeave,
        });
        session.connect();
        transport.simulateStatus('connected');

        transport.simulateMessage('/user/queue/private', {
            type: 'ACTION_ERROR',
            code: 'GAME_NOT_FOUND',
            action: 'CHECK',
            message: 'Game unavailable',
        });

        // Should schedule redirect to lobby so the player is not stuck in a non-existent game
        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('redirects to lobby when getRoomInfo says gameStarted=true but getGameState returns 404', async () => {
        vi.useFakeTimers();
        try {
            const transport = new InMemoryTransportAdapter();
            const clock = new TestClock(1000);
            const onLeave = vi.fn();
            const session = new GameSession({ auth: mockAuth, transport, clock, onLeave });
            const notFoundErr = Object.assign(new Error('Game not found'), { status: 404 });
            vi.mocked(pokerApi.getGameState).mockRejectedValue(notFoundErr);

            render(<GameView auth={mockAuth} onLeave={onLeave} session={session} />);

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });

            await act(async () => {
                vi.advanceTimersByTime(3000);
            });

            expect(onLeave).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not trap NotificationBanner inside an isolated stacking context below RoomHeader', async () => {
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const session = new GameSession({
            auth: mockAuth,
            transport,
            clock,
            initialRoomState: {
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [
                    { name: 'P1', isHost: true },
                    { name: 'P2', isHost: false },
                ],
                gameStarted: true,
            },
            initialGameState,
        });

        render(<GameView auth={mockAuth} session={session} />);

        const tableMain = await screen.findByTestId('game-table-view');
        act(() => {
            session.setNotification('Game not found:');
        });

        const alertBanner = screen.getByRole('alert');
        expect(alertBanner).toHaveTextContent('Game not found:');
        // GameTableView <main> must not use `isolate` without a z-index above RoomHeader (z-40),
        // and NotificationBanner must sit below the header height (not top-6 where RoomHeader covers it).
        expect(tableMain.className).not.toMatch(/\bisolate\b/);
        expect(alertBanner.className).not.toMatch(/\btop-6\b/);
    });
});
