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
        sessionStorage.clear();
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

    it('defers a server GAME_END review during leave and keeps it when departure fails', async () => {
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

        // When P2 calls the shared room departure endpoint, the server may broadcast GAME_END to /game/ROOM123
        // before leaveRoom finishes resolving.
        const leaveResolvers: Array<(success: boolean) => void> = [];
        const requestLeave = vi.fn(() => new Promise<boolean>((resolve) => { leaveResolvers.push(resolve); }));

        render(<GameView auth={{ ...mockAuth, playerName: 'P2' }} onLeave={onLeave} onRequestLeave={requestLeave}
            leaveError="Network failure. Try again." session={session} />);

        const leaveBtn = await screen.findByRole('button', { name: /leave table/i });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        await act(async () => {
            leaveBtn.click();
        });

        transport.simulateMessage('/game/ROOM123', {
            type: 'GAME_END', gameId: 'ROOM123', winner: 'P1', winnerChips: 1050,
            isForfeit: true, message: 'P1 wins by forfeit!', finalState: initialGameState,
        });

        // Keep the table visible while the explicit departure is still pending.
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(screen.queryByText(/GAME OVER/i)).not.toBeInTheDocument();

        await act(async () => {
            leaveResolvers[0](false);
        });
        expect(await screen.findByRole('region', { name: /game review/i })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(/network failure/i);
        expect(sessionStorage.getItem('poker-game-end:ROOM123')).not.toBeNull();
        expect(onLeave).not.toHaveBeenCalled();

        await act(async () => {
            screen.getByRole('button', { name: /retry leave/i }).click();
            expect(requestLeave).toHaveBeenCalledTimes(2);
            leaveResolvers[1](true);
        });
        expect(requestLeave).toHaveBeenCalledTimes(2);
        await act(async () => { await Promise.resolve(); });
        expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
    });

    it('clears a GAME_END review after a successful standalone fallback leave and provider effects', async () => {
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth: { ...mockAuth, playerName: 'P2' },
            transport,
            clock: new TestClock(1000),
            initialRoomState: {
                roomId: 'ROOM123', roomName: 'Test',
                players: [{ name: 'P1', isHost: true }, { name: 'P2', isHost: false }],
                gameStarted: true,
            },
            initialGameState,
        });
        let resolveLeave!: () => void;
        vi.mocked(pokerApi.leaveRoom).mockReturnValueOnce(new Promise<void>((resolve) => { resolveLeave = resolve; }));
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<GameView auth={{ ...mockAuth, playerName: 'P2' }} session={session} />);
        const leaveButton = await screen.findByRole('button', { name: /leave table/i });

        await act(async () => {
            leaveButton.click();
        });
        await act(async () => {
            transport.simulateMessage('/game/ROOM123', {
                type: 'GAME_END', gameId: 'ROOM123', winner: 'P1', winnerChips: 1050,
                isForfeit: true, message: 'P1 wins by forfeit!', finalState: initialGameState,
            });
            resolveLeave();
            await Promise.resolve();
        });
        expect(session.getSnapshot().gameEndResult).not.toBeNull();
        await act(async () => { await Promise.resolve(); });

        expect(pokerApi.leaveRoom).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
    });

    it('shows a failed leave and keeps retry available while a started game is still hydrating', async () => {
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({ auth: mockAuth, transport, clock: new TestClock(1000), initialRoomState: {
            roomId: 'ROOM123', roomName: 'Test', players: [{ name: 'P1', isHost: true }], gameStarted: true,
        } });
        session.setHydrated(true);
        vi.mocked(pokerApi.getGameState).mockImplementation(() => new Promise(() => {}));
        const requestLeave = vi.fn().mockResolvedValue(false);
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<GameView auth={mockAuth} session={session} onRequestLeave={requestLeave} leaveError="Could not leave the room. Try again." />);

        expect(await screen.findByText('Could not leave the room. Try again.')).toBeInTheDocument();
        await act(async () => screen.getByRole('button', { name: /leave table/i }).click());
        expect(requestLeave).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Could not leave the room. Try again.')).toBeInTheDocument();
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
