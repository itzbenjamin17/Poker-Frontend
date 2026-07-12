import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import GameView from '../GameView';
import { server } from '../test/mocks/server';
import { mockAuth } from '../test/fixtures';
import { MockStompClient, activeSubscriptions } from '../test/mocks/stomp';

function mockStartedTable() {
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
            phase: 'RIVER',
            pot: 120,
            currentBet: 0,
            communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
            currentPlayerId: 'p-2',
            currentPlayerName: 'Opponent',
            players: [
                { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE', hasFolded: false },
            ],
        })),
        http.get('/api/game/ROOM123/private-state', () => HttpResponse.json({
            playerId: 'p-1',
            holeCards: ['AS', 'KS'],
        })),
    );
}

async function renderStartedTable() {
    render(<GameView auth={mockAuth} />);
    expect(await screen.findByRole('region', { name: /poker table/i })).toBeInTheDocument();
    await MockStompClient.waitForSubscription('/game/ROOM123');
}

describe('GameView - Collapsed Round Summary Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptions.clear();
        mockStartedTable();
    });

    it('shows a collapsed winner summary with payout, hand strength, and explicit details control', async () => {
        const user = userEvent.setup();
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1000,
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer'],
                winningsPerPlayer: 1000,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1980, currentBet: 0, status: 'ACTIVE', hasFolded: false, handRank: 'TWO_PAIR', isWinner: true },
                    { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE', hasFolded: false, handRank: 'PAIR' },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/testplayer won/i)).toBeInTheDocument();
        expect(within(summary).getByText(/\+\$1,000/i)).toBeInTheDocument();
        expect(within(summary).getByText(/won with/i)).toHaveTextContent(/TWO PAIR/i);
        expect(screen.getByRole('region', { name: /board cluster/i })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: /testplayer hero seat/i })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /round result/i })).not.toBeInTheDocument();

        const details = within(summary).getByRole('button', { name: /show result details/i });
        expect(details).toHaveAttribute('aria-expanded', 'false');
        await user.click(details);
        expect(details).toHaveAttribute('aria-expanded', 'true');
        expect(within(summary).getByText(/state/i)).toBeInTheDocument();
    });

    it('walks from collapsed summary to expanded sheet and full result recap without exposing unrevealed cards', async () => {
        const user = userEvent.setup();
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1500,
                pots: [1000, 500],
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer'],
                winningsPerPlayer: 1500,
                players: [
                    {
                        id: 'p-1',
                        name: 'TestPlayer',
                        chips: 2480,
                        currentBet: 0,
                        status: 'ACTIVE',
                        hasFolded: false,
                        handRank: 'TWO_PAIR',
                        holeCards: ['AS', 'KS'],
                        isWinner: true,
                        chipsWon: 1500,
                    },
                    {
                        id: 'p-2',
                        name: 'Opponent',
                        chips: 480,
                        currentBet: 0,
                        status: 'ACTIVE',
                        hasFolded: false,
                        handRank: 'PAIR',
                    },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByRole('button', { name: /show result details/i })).toHaveAttribute('aria-expanded', 'false');

        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        expect(within(summary).getByRole('button', { name: /hide result details/i })).toHaveAttribute('aria-expanded', 'true');
        expect(within(summary).getByText(/main pot/i)).toBeInTheDocument();
        expect(within(summary).getByText(/\$1,000/i)).toBeInTheDocument();
        expect(within(summary).getByText(/side pot 1/i)).toBeInTheDocument();
        expect(within(summary).getByRole('button', { name: /open full result review/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /board cluster/i })).toBeInTheDocument();

        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));

        const review = await screen.findByRole('dialog', { name: /full result review/i });
        expect(within(review).getByText(/testplayer won/i)).toBeInTheDocument();
        expect(within(review).getByText(/won with/i)).toHaveTextContent(/two pair/i);
        expect(within(review).getByText(/payout/i)).toBeInTheDocument();
        expect(within(review).getByRole('img', { name: /ace of hearts/i })).toBeInTheDocument();
        expect(within(review).getByRole('img', { name: /ace of spades/i })).toBeInTheDocument();
        expect(within(review).getByRole('img', { name: /king of spades/i })).toBeInTheDocument();
        expect(within(review).queryByRole('img', { name: /2 of hearts/i })).not.toBeInTheDocument();
        expect(within(review).getByText(/opponent/i)).toBeInTheDocument();
        expect(within(review).getByText(/in hand - pair/i)).toBeInTheDocument();

        await user.click(within(review).getByRole('button', { name: /close full result review/i }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: /full result review/i })).not.toBeInTheDocument();
        });
        expect(within(summary).getByRole('button', { name: /open full result review/i })).toHaveFocus();
        expect(within(summary).getByText(/side pot 1/i)).toBeInTheDocument();
    });

    it('distinguishes ties and split payouts from single-winner outcomes', async () => {
        const user = userEvent.setup();
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1000,
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer', 'Opponent'],
                winningsPerPlayer: 500,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1480, currentBet: 0, status: 'ACTIVE', hasFolded: false, handRank: 'STRAIGHT', isWinner: true },
                    { id: 'p-2', name: 'Opponent', chips: 1480, currentBet: 0, status: 'ACTIVE', hasFolded: false, handRank: 'STRAIGHT', isWinner: true },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/it's a tie: testplayer, opponent/i)).toBeInTheDocument();
        expect(within(summary).getByText(/pot split equally/i)).toBeInTheDocument();
        expect(within(summary).queryByText(/testplayer won!/i)).not.toBeInTheDocument();

        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        expect(within(summary).getAllByText(/\$500/i).length).toBeGreaterThan(0);

        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));
        const review = await screen.findByRole('dialog', { name: /full result review/i });
        expect(within(review).getByText(/it's a tie: testplayer, opponent/i)).toBeInTheDocument();
        expect(within(review).getAllByText(/winner - straight/i)).toHaveLength(2);
    });

    it('shows forfeit results without fabricating hand strength', async () => {
        const user = userEvent.setup();
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 120,
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer'],
                winningsPerPlayer: 120,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1100, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/testplayer won by forfeit/i)).toBeInTheDocument();
        expect(within(summary).queryByText(/won with/i)).not.toBeInTheDocument();

        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));
        const review = await screen.findByRole('dialog', { name: /full result review/i });
        expect(within(review).getByText(/testplayer won by forfeit/i)).toBeInTheDocument();
        expect(within(review).queryByText(/won with/i)).not.toBeInTheDocument();
    });

    it('shows uncontested multi-player results without fabricating hand strength', async () => {
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 120,
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                winners: ['TestPlayer'],
                winningsPerPlayer: 120,
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 1100, currentBet: 0, status: 'ACTIVE', hasFolded: false, handRank: 'TWO_PAIR' },
                    { id: 'p-2', name: 'Opponent', chips: 880, currentBet: 0, status: 'FOLDED', hasFolded: true, handRank: 'STRAIGHT' },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/testplayer won by forfeit/i)).toBeInTheDocument();
        expect(within(summary).queryByText(/won with/i)).not.toBeInTheDocument();
    });

    it('shows a truthful processing state for progressive result data', async () => {
        const user = userEvent.setup();
        await renderStartedTable();

        await act(async () => {
            MockStompClient.simulateMessage('/game/ROOM123', {
                gameId: 'ROOM123',
                phase: 'SHOWDOWN',
                pot: 1000,
                currentBet: 0,
                communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
                currentPlayerId: '',
                currentPlayerName: '',
                players: [
                    { id: 'p-1', name: 'TestPlayer', chips: 980, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                    { id: 'p-2', name: 'Opponent', chips: 980, currentBet: 0, status: 'ACTIVE', hasFolded: false },
                ],
            });
        });

        const summary = await screen.findByRole('region', { name: /round result/i });
        expect(within(summary).getByText(/processing results/i)).toBeInTheDocument();
        expect(within(summary).getByRole('button', { name: /show result details/i })).toBeInTheDocument();

        await user.click(within(summary).getByRole('button', { name: /show result details/i }));
        await user.click(within(summary).getByRole('button', { name: /open full result review/i }));
        const review = await screen.findByRole('dialog', { name: /full result review/i });
        expect(within(review).getByText(/processing results/i)).toBeInTheDocument();
        expect(within(review).getByText(/no revealed hole cards/i)).toBeInTheDocument();
    });
});
