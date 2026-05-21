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

    it('handles the Showdown flow and displays the ShowdownModal', async () => {
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
                winners: ['TestPlayer'],
                winningsPerPlayer: 1000,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1980, currentBet: 0, status: 'ACTIVE', holeCards: ['AS', 'KS'] },
                    { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE', holeCards: ['2H', '3H'] },
                ],
            });
        });

        // Verify Showdown modal is shown
        expect(await screen.findByRole('dialog', { name: /round result/i })).toBeInTheDocument();
        expect(screen.getByText(/testplayer won/i)).toBeInTheDocument();
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
});

