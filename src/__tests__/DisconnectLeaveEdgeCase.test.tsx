import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import GameView from '../GameView';
import { GameSession } from '../domain/GameSession';
import { InMemoryTransportAdapter } from '../services/transport';
import { TestClock } from '../domain/clock';
import { confirmLeave } from '../test/confirmDialog';
import { pokerApi } from '../services/api';
import { createMockJwt, createValidGameState, createValidRoomData } from '../test/fixtures';
import type { AuthResponse, GameState } from '../types';

describe('Disconnect & Leave Edge Cases', () => {
    const defaultToken = createMockJwt({ sub: 'P1' });
    const mockAuth: AuthResponse = {
        token: defaultToken,
        roomId: 'ROOM123',
        playerName: 'P1',
    };

    const initialGameState: GameState = createValidGameState({
        gameId: 'ROOM123',
        handNumber: 0,
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
    });

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        window.innerWidth = 1280;
        window.innerHeight = 800;
        server.use(
            http.get('*/api/room/ROOM123', () =>
                HttpResponse.json(
                    createValidRoomData({
                        roomId: 'ROOM123',
                        roomName: 'Test',
                        players: [
                            { name: 'P1', isHost: true },
                            { name: 'P2', isHost: false },
                        ],
                        maxPlayers: 6,
                        buyIn: 1000,
                        smallBlind: 10,
                        bigBlind: 20,
                        canStartGame: true,
                        gameStarted: true,
                    })
                )
            ),
            http.get('*/api/game/ROOM123/state', () => HttpResponse.json(initialGameState)),
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ playerId: 'p-1', handNumber: 0, holeCards: ['2c', '4h'] })
            )
        );
    });

    it('defers a server GAME_END review during leave and keeps it when departure fails', async () => {
        const user = userEvent.setup();
        server.use(
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ playerId: 'p-2', handNumber: 0, holeCards: ['2c', '4h'] })
            )
        );
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const onLeave = vi.fn();

        const session = new GameSession({
            auth: { ...mockAuth, playerName: 'P2' },
            transport,
            clock,
            onLeave,
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [
                    { name: 'P1', isHost: true },
                    { name: 'P2', isHost: false },
                ],
                gameStarted: true,
            }),
            initialGameState,
        });

        // When P2 calls the shared room departure endpoint, the server may broadcast GAME_END to /game/ROOM123
        // before leaveRoom finishes resolving.
        const leaveResolvers: Array<(success: boolean) => void> = [];
        const requestLeave = vi.fn(() => new Promise<boolean>((resolve) => { leaveResolvers.push(resolve); }));

        render(<GameView auth={{ ...mockAuth, playerName: 'P2' }} onLeave={onLeave} onRequestLeave={requestLeave}
            leaveError="Network failure. Try again." session={session} />);

        const leaveBtn = await screen.findByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);
        await confirmLeave(user);

        act(() => {
            transport.simulateMessage('/game/ROOM123', {
                ...initialGameState,
                phase: 'SHOWDOWN',
                pot: 0,
                currentPlayerName: null,
                currentPlayerId: null,
                winners: ['P1'],
                handSettled: true,
                gameEnd: { winner: 'P1', winnerChips: 1050, isForfeit: true, message: 'P1 wins by forfeit!' },
            });
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

        await user.click(screen.getByRole('button', { name: /retry leave/i }));
        expect(requestLeave).toHaveBeenCalledTimes(2);
        await act(async () => {
            leaveResolvers[1](true);
        });
        await waitFor(() => {
            expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
        });
    });

    it('clears a GAME_END review after a successful standalone fallback leave and provider effects', async () => {
        const user = userEvent.setup();
        let resolveLeave!: () => void;
        let leaveCalls = 0;
        server.use(
            http.get('*/api/game/ROOM123/private-state', () =>
                HttpResponse.json({ playerId: 'p-2', handNumber: 0, holeCards: ['2c', '4h'] })
            ),
            http.post('*/api/room/ROOM123/leave', () => {
                leaveCalls += 1;
                return new Promise<Response>((resolve) => {
                    resolveLeave = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            })
        );
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth: { ...mockAuth, playerName: 'P2' },
            transport,
            clock: new TestClock(1000),
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123', roomName: 'Test',
                players: [{ name: 'P1', isHost: true }, { name: 'P2', isHost: false }],
                gameStarted: true,
            }),
            initialGameState,
        });
        render(<GameView auth={{ ...mockAuth, playerName: 'P2' }} session={session} />);
        const leaveButton = await screen.findByRole('button', { name: /leave table/i });

        await user.click(leaveButton);
        await confirmLeave(user);
        await waitFor(() => expect(leaveCalls).toBe(1));

        act(() => {
            transport.simulateMessage('/game/ROOM123', {
                ...initialGameState,
                phase: 'SHOWDOWN',
                pot: 0,
                currentPlayerName: null,
                currentPlayerId: null,
                winners: ['P1'],
                handSettled: true,
                gameEnd: { winner: 'P1', winnerChips: 1050, isForfeit: true, message: 'P1 wins by forfeit!' },
            });
        });
        expect(session.getSnapshot().gameEndResult).not.toBeNull();

        resolveLeave();
        await waitFor(() => {
            expect(sessionStorage.getItem('poker-game-end:ROOM123')).toBeNull();
        });
        expect(leaveCalls).toBe(1);
    });

    it('shows a failed leave and keeps retry available while a started game is still hydrating', async () => {
        const user = userEvent.setup();
        server.use(
            http.get('*/api/game/ROOM123/state', ({ request }) =>
                new Promise<Response>((resolve) => {
                    request.signal.addEventListener('abort', () => {
                        resolve(HttpResponse.error());
                    }, { once: true });
                })
            )
        );
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth: mockAuth,
            transport,
            clock: new TestClock(1000),
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [{ name: 'P1', isHost: true }],
                gameStarted: true,
            }),
        });
        session.setHydrated(true);
        const requestLeave = vi.fn().mockResolvedValue(false);
        render(<GameView auth={mockAuth} session={session} onRequestLeave={requestLeave} leaveError="Could not leave the room. Try again." />);

        expect(await screen.findByText('Could not leave the room. Try again.')).toBeInTheDocument();
        // The hydrating header leaves without confirmation (confirmLeave={false}).
        await user.click(screen.getByRole('button', { name: /leave table/i }));
        expect(requestLeave).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Could not leave the room. Try again.')).toBeInTheDocument();
    });

    it('redirects to lobby when getRoomInfo says gameStarted=true but getGameState returns 404', async () => {
        server.use(
            http.get('*/api/game/ROOM123/state', () =>
                HttpResponse.json({ detail: 'Game not found' }, { status: 404 })
            )
        );
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const onLeave = vi.fn();
        const session = new GameSession({ auth: mockAuth, transport, clock, onLeave });

        render(<GameView auth={mockAuth} onLeave={onLeave} session={session} />);

        await waitFor(() => expect(session.isRedirectingActive()).toBe(true));

        act(() => {
            clock.tick(3000);
        });

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('does not trap NotificationBanner inside an isolated stacking context below RoomHeader', async () => {
        const transport = new InMemoryTransportAdapter();
        const clock = new TestClock(1000);
        const session = new GameSession({
            auth: mockAuth,
            transport,
            clock,
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [
                    { name: 'P1', isHost: true },
                    { name: 'P2', isHost: false },
                ],
                gameStarted: true,
            }),
            initialGameState,
        });

        render(<GameView auth={mockAuth} session={session} />);

        const tableMain = await screen.findByRole('main', { name: /live poker table/i });
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

    it('propagates originating token to onLeave and does not wipe out active replacement auth token', async () => {
        const user = userEvent.setup();
        const tokenA = createMockJwt({ sub: 'token-A' });
        const tokenB = createMockJwt({ sub: 'token-B' });
        let activeAuthToken = tokenA;
        const clearAuth = vi.fn((expectedToken?: string) => {
            if (expectedToken !== undefined && activeAuthToken !== expectedToken) return;
            activeAuthToken = '';
        });
        const onLeave = vi.fn((originatingToken?: string) => {
            const tokenToClear = originatingToken ?? tokenA;
            clearAuth(tokenToClear);
        });

        let capturedAuthHeader: string | null = null;
        let resolveLeave!: () => void;
        server.use(
            http.post('*/api/room/ROOM123/leave', ({ request }) => {
                capturedAuthHeader = request.headers.get('Authorization');
                return new Promise<Response>((resolve) => {
                    resolveLeave = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            })
        );

        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth: { ...mockAuth, token: tokenA },
            transport,
            clock: new TestClock(1000),
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [{ name: 'P1', isHost: true }],
                gameStarted: true,
            }),
            initialGameState,
        });

        render(<GameView auth={{ ...mockAuth, token: tokenA }} onLeave={onLeave} session={session} />);

        const leaveButton = await screen.findByRole('button', { name: /leave table/i });
        await user.click(leaveButton);
        await confirmLeave(user);

        await waitFor(() => expect(capturedAuthHeader).toBe(`Bearer ${tokenA}`));

        // Replacement session installed while leaveRoom was in flight
        activeAuthToken = tokenB;

        resolveLeave();

        await waitFor(() => expect(onLeave).toHaveBeenCalledWith(tokenA));
        expect(clearAuth).toHaveBeenCalledWith(tokenA);
        // Token B must NOT be wiped out
        expect(activeAuthToken).toBe(tokenB);
    });

    it('propagates originating token to onRequestLeave and preserves active replacement auth token', async () => {
        const user = userEvent.setup();
        const tokenA = createMockJwt({ sub: 'token-A' });
        const tokenB = createMockJwt({ sub: 'token-B' });
        let activeAuthToken = tokenA;
        const clearAuth = vi.fn((expectedToken?: string) => {
            if (expectedToken !== undefined && activeAuthToken !== expectedToken) return;
            activeAuthToken = '';
        });

        let resolveLeave!: () => void;
        let leaveStarted = false;
        server.use(
            http.post('*/api/room/ROOM123/leave', () => {
                leaveStarted = true;
                return new Promise<Response>((resolve) => {
                    resolveLeave = () => resolve(new HttpResponse(null, { status: 204 }));
                });
            })
        );

        const requestLeave = vi.fn(async (originatingToken?: string) => {
            await pokerApi.leaveRoom('ROOM123', originatingToken ?? tokenA);
            // Check active session matches originating token before clearing
            if (activeAuthToken === (originatingToken ?? tokenA)) {
                clearAuth(originatingToken);
                return true;
            }
            return false;
        });

        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth: { ...mockAuth, token: tokenA },
            transport,
            clock: new TestClock(1000),
            initialRoomState: createValidRoomData({
                roomId: 'ROOM123',
                roomName: 'Test',
                players: [{ name: 'P1', isHost: true }],
                gameStarted: true,
            }),
            initialGameState,
        });

        render(<GameView auth={{ ...mockAuth, token: tokenA }} onRequestLeave={requestLeave} session={session} />);

        const leaveButton = await screen.findByRole('button', { name: /leave table/i });
        await user.click(leaveButton);
        await confirmLeave(user);

        await waitFor(() => expect(leaveStarted).toBe(true));
        expect(requestLeave).toHaveBeenCalledWith(tokenA);

        // Replacement session takes over
        activeAuthToken = tokenB;

        resolveLeave();

        await waitFor(() => expect(clearAuth).not.toHaveBeenCalled());
        expect(activeAuthToken).toBe(tokenB);
    });
});
