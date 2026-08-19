import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GameView from '../GameView';
import { MockStompClient, activeSubscriptions } from '../test/mocks/stomp';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { mockAuth } from '../test/fixtures';

describe('GameView - Actions & Flows Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
    });

    it('submits Fold action and publishes STOMP frame', async () => {
        const user = userEvent.setup();
        const publishSpy = vi.spyOn(MockStompClient.prototype, 'publish');

        server.use(
            http.get('/api/room/ROOM123', () => HttpResponse.json({
                roomId: 'ROOM123',
                roomName: 'Poker Table',
                players: [
                    { name: 'TestPlayer', isHost: true },
                    { name: 'Opponent', isHost: false },
                ],
                gameStarted: true,
            })),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerId: 'p-1', // My turn
                currentPlayerName: 'TestPlayer',
                legalActions: ['FOLD'],
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
                    { id: 'p-2', name: 'Opponent', chips: 990, currentBet: 20, status: 'ACTIVE', isSmallBlind: true },
                ],
            })),
            http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
                playerId: 'p-1',
                holeCards: ['AS', 'KS'],
            }))
        );

        render(<GameView auth={mockAuth} />);

        // Wait for initial REST hydration to settle and game table to render
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        await MockStompClient.waitForSubscription('/user/queue/private');

        // Simulate private state update via STOMP using await act(async () => ...)
        await act(async () => {
            MockStompClient.simulateMessage('/user/queue/private', {
                holeCards: ['AS', 'KS'],
            });
        });

        // Check & Click Fold action
        const foldBtn = await screen.findByRole('button', { name: /fold/i });
        expect(foldBtn).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
        await user.click(foldBtn);

        expect(publishSpy).toHaveBeenCalledWith({
            destination: '/app/ROOM123/action',
            body: JSON.stringify({ action: 'FOLD', amount: 0 }),
        });
    });

    it('submits Check action and publishes STOMP frame', async () => {
        const user = userEvent.setup();
        const publishSpy = vi.spyOn(MockStompClient.prototype, 'publish');

        server.use(
            http.get('/api/room/ROOM123', () => HttpResponse.json({
                roomId: 'ROOM123',
                roomName: 'Poker Table',
                players: [
                    { name: 'TestPlayer', isHost: true },
                    { name: 'Opponent', isHost: false },
                ],
                gameStarted: true,
            })),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerId: 'p-1', // My turn
                currentPlayerName: 'TestPlayer',
                legalActions: ['CHECK'],
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE', isBigBlind: true },
                    { id: 'p-2', name: 'Opponent', chips: 990, currentBet: 20, status: 'ACTIVE', isSmallBlind: true },
                ],
            })),
            http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
                playerId: 'p-1',
                holeCards: ['AS', 'KS'],
            }))
        );

        render(<GameView auth={mockAuth} />);

        // Wait for initial REST hydration to settle and game table to render
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        await MockStompClient.waitForSubscription('/user/queue/private');

        // Simulate private state update via STOMP using await act(async () => ...)
        await act(async () => {
            MockStompClient.simulateMessage('/user/queue/private', {
                holeCards: ['AS', 'KS'],
            });
        });

        // Click Check action
        const checkBtn = await screen.findByRole('button', { name: /check/i });
        expect(checkBtn).toBeInTheDocument();
        await user.click(checkBtn);

        expect(publishSpy).toHaveBeenCalledWith({
            destination: '/app/ROOM123/action',
            body: JSON.stringify({ action: 'CHECK', amount: 0 }),
        });
    });

    it('handles the Showdown flow and displays the round summary', async () => {
        server.use(
            http.get('/api/room/ROOM123', () => HttpResponse.json({
                roomId: 'ROOM123',
                roomName: 'Poker Table',
                players: [
                    { name: 'TestPlayer', isHost: true },
                    { name: 'Opponent', isHost: false },
                ],
                gameStarted: true,
            })),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                communityCards: [],
                currentPlayerId: 'p-2',
                currentPlayerName: 'Opponent',
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE' },
                    { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 20, status: 'ACTIVE' },
                ],
            })),
            http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
                playerId: 'p-1',
                holeCards: ['AS', 'KS'],
            }))
        );

        render(<GameView auth={mockAuth} />);

        // Wait for initial REST hydration to settle and game table to render
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        await MockStompClient.waitForSubscription(`/game/ROOM123`);

        // Simulate transitioning to Showdown state with winners using await act(async () => ...)
        await act(async () => {
            MockStompClient.simulateMessage(`/game/ROOM123`, {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1000,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer'],
                winningsPerPlayer: 1000,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1980, currentBet: 0, status: 'ACTIVE', holeCards: ['AS', 'KS'] },
                    { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE', holeCards: ['2H', '3H'] },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(summary).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /round result/i })).not.toBeInTheDocument();
        expect(screen.getByText(/testplayer won/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /show result details/i })).toBeInTheDocument();
    });

    it('redirects to lobby (calls onLeave) on hydration 403 error', async () => {
        const onLeaveSpy = vi.fn();

        server.use(
            http.get('/api/room/ROOM123', () => new HttpResponse(
                JSON.stringify({ message: 'Seat has expired' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            ))
        );

        render(<GameView auth={mockAuth} onLeave={onLeaveSpy} />);

        // Should trigger redirect
        await waitFor(() => {
            expect(onLeaveSpy).toHaveBeenCalledTimes(1);
        }, { timeout: 4000 });
    });

    it('prompts confirmation when leaving the table', async () => {
        const user = userEvent.setup();
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);

        server.use(
            http.get('/api/room/ROOM123', () => HttpResponse.json({
                roomId: 'ROOM123',
                roomName: 'Poker Table',
                players: [{ name: 'TestPlayer', isHost: true }],
                gameStarted: true,
            })),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 0,
                currentBet: 0,
                communityCards: [],
                currentPlayerId: 'p-1',
                currentPlayerName: 'TestPlayer',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
            }))
        );

        render(<GameView auth={mockAuth} />);
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        const leaveBtn = await screen.findByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('leave the table'));
    });

    it('displays Connection Lost overlay when WebSocket is disconnected', async () => {
        server.use(
            http.get('/api/room/ROOM123', () => HttpResponse.json({
                roomId: 'ROOM123',
                roomName: 'Poker Table',
                players: [{ name: 'TestPlayer', isHost: true }],
                gameStarted: true,
            })),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 0,
                currentBet: 0,
                communityCards: [],
                currentPlayerId: 'p-1',
                currentPlayerName: 'TestPlayer',
                players: [{ id: 'p-1', name: 'TestPlayer', chips: 1000, currentBet: 0, status: 'ACTIVE' }],
            }))
        );

        render(<GameView auth={mockAuth} />);
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        // Initially connected, no overlay (wait for connection to complete)
        await waitFor(() => {
            expect(screen.queryByText(/Connection lost/i)).not.toBeInTheDocument();
        });

        // Simulate WS disconnect event
        await act(async () => {
            MockStompClient.simulateDisconnect();
        });

        // Overlay should appear
        expect(await screen.findByRole('alert')).toHaveTextContent(/Connection lost/i);
    });

    it('renders dedicated Game Over screen upon GAME_END event', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();

        let roomInfoCalls = 0;
        server.use(
            http.get('/api/room/ROOM123', () => {
                roomInfoCalls++;
                if (roomInfoCalls === 1) {
                    return HttpResponse.json({
                        roomId: 'ROOM123',
                        roomName: 'Poker Table',
                        players: [
                            { name: 'TestPlayer', isHost: true },
                            { name: 'Opponent', isHost: false },
                        ],
                        gameStarted: true,
                    });
                }
                return new HttpResponse(null, { status: 404 });
            }),
            http.get('/api/game/ROOM123/state', () => HttpResponse.json({
                gameId: 'ROOM123',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                currentPlayerId: 'p-1',
                currentPlayerName: 'TestPlayer',
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 20, status: 'ACTIVE' },
                    { id: 'p-2', name: 'Opponent', chips: 990, currentBet: 20, status: 'ACTIVE' },
                ],
            })),
            http.post('/api/game/ROOM123/leave', () => new HttpResponse(null, { status: 200 })),
            http.post('/api/room/ROOM123/leave', () => new HttpResponse(null, { status: 200 }))
        );

        render(<GameView auth={mockAuth} onLeave={onLeaveSpy} />);
        expect(await screen.findByLabelText('Total Pot')).toBeInTheDocument();

        await MockStompClient.waitForSubscription('/game/ROOM123');

        // Simulate Game Over WebSocket event
        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                type: 'GAME_END',
                message: 'TestPlayer won the game!',
                winner: 'TestPlayer',
                winnerChips: 2000,
                isForfeit: false,
                finalState: {
                    phase: 'SHOWDOWN',
                    pot: 30,
                    players: [
                        { id: 'p-1', name: 'TestPlayer', chips: 2000, currentBet: 0, status: 'ACTIVE', isWinner: true },
                        { id: 'p-2', name: 'Opponent', chips: 0, currentBet: 0, status: 'ACTIVE' },
                    ],
                    communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                }
            });
        });

        // Dedicated Game Over screen should render
        const gameOverTitle = await screen.findByRole('heading', { name: /game over/i });
        expect(gameOverTitle).toBeInTheDocument();
        expect(screen.getByText(/TestPlayer wins!/i)).toBeInTheDocument();
        expect(screen.getByText(/Collected 2000 chips/i)).toBeInTheDocument();

        // Check if player standings are rendered (GameReviewView feature)
        expect(screen.getByText('Opponent')).toBeInTheDocument();

        // Leave button should exit to main menu
        const leaveBtn = screen.getByRole('button', { name: /LEAVE/i });
        await user.click(leaveBtn);

        // Verification of redirect trigger
        await waitFor(() => {
            expect(onLeaveSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('restores the review screen after a page refresh, even when the room is already gone', async () => {
        const onLeaveSpy = vi.fn();

        // Simulate a previous session having already recorded a game end - this
        // is what GameProvider persists to localStorage when GAME_END arrives.
        localStorage.setItem('poker-game-end:ROOM123', JSON.stringify({
            winnerName: 'TestPlayer',
            winnerChips: 2000,
            isForfeit: false,
            message: 'TestPlayer won the game!',
            finalState: {
                phase: 'SHOWDOWN',
                pot: 30,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 2000, currentBet: 0, status: 'ACTIVE', isWinner: true },
                    { id: 'p-2', name: 'Opponent', chips: 0, currentBet: 0, status: 'ACTIVE' },
                ],
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
            },
        }));

        // The room/game no longer exist server-side (already cleaned up) - if
        // hydration were attempted it would 404 and redirect to the lobby.
        server.use(
            http.get('/api/room/ROOM123', () => new HttpResponse(null, { status: 404 })),
            http.get('/api/game/ROOM123/state', () => new HttpResponse(null, { status: 404 })),
        );

        render(<GameView auth={mockAuth} onLeave={onLeaveSpy} />);

        const gameOverTitle = await screen.findByRole('heading', { name: /game over/i });
        expect(gameOverTitle).toBeInTheDocument();
        expect(screen.getByText(/TestPlayer wins!/i)).toBeInTheDocument();

        // Give any (incorrectly) in-flight hydration/redirect logic a chance to
        // fire, then confirm the player was never kicked back to the lobby.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(onLeaveSpy).not.toHaveBeenCalled();

        localStorage.removeItem('poker-game-end:ROOM123');
    });
});

