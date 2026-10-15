import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GameProvider } from '../GameProvider';
import { useGameContext } from '../GameContext';
import type { IncomingGameStatePayload, RoomState, WsStatus } from '../../types';
import '@testing-library/jest-dom';

function TestConsumer() {
    const ctx = useGameContext();

    return (
        <div>
            <span data-testid="room-name">{ctx.roomState?.roomName || 'none'}</span>
            <span data-testid="game-phase">{ctx.gameState?.phase ?? 'none'}</span>
            <span data-testid="pot-amount">{ctx.gameState?.pot ?? 0}</span>
            <span data-testid="notification">{ctx.notification ?? 'none'}</span>
            <span data-testid="ws-status">{ctx.wsStatus}</span>
            <span data-testid="is-game-over">{ctx.isGameOver ? 'yes' : 'no'}</span>

            <button
                type="button"
                onClick={() =>
                    ctx.dispatch({
                        type: 'SET_ROOM',
                        payload: {
                            roomId: 'test-room',
                            roomName: 'High Roller Suite',
                            host: 'Host1',
                            players: [{ name: 'Player1', isHost: true }],
                            gameStarted: false,
                        } as RoomState,
                    })
                }
            >
                Set Room
            </button>

            <button
                type="button"
                onClick={() =>
                    ctx.applyIncomingGameState({
                        gameId: 'test-room',
                        phase: 'FLOP',
                        pot: 1200,
                        communityCards: ['Ah', 'Kh', 'Qh'],
                        players: [],
                        maxPlayers: 6,
                        currentBet: 0,
                        currentPlayerName: 'Player1',
                        currentPlayerId: 'p-1',
                    } as IncomingGameStatePayload)
                }
            >
                Apply Game
            </button>

            <button
                type="button"
                onClick={() =>
                    ctx.dispatch({
                        type: 'SET_NOTIFICATION',
                        payload: 'Welcome to the table',
                    })
                }
            >
                Set Notification
            </button>

            <button
                type="button"
                onClick={() =>
                    ctx.dispatch({
                        type: 'SET_NOTIFICATION',
                        payload: null,
                    })
                }
            >
                Clear Notification
            </button>

            <button
                type="button"
                onClick={() =>
                    ctx.dispatch({
                        type: 'SET_WS_STATUS',
                        payload: 'connected' as WsStatus,
                    })
                }
            >
                Set Connected
            </button>

            <button
                type="button"
                onClick={() =>
                    ctx.dispatch({
                        type: 'CLEAR_GAME_STATE',
                    })
                }
            >
                Clear Game State
            </button>
        </div>
    );
}

describe('GameProvider and useGameContext', () => {
    const auth = {
        roomId: 'test-room',
        playerName: 'Player1',
        token: 'token-123',
        message: 'Success',
    };

    it('preserves the GameSession instance when the onLeave callback identity changes', () => {
        const sessions: unknown[] = [];
        function CaptureSession() {
            sessions.push(useGameContext().session);
            return null;
        }
        const firstOnLeave = () => {};
        const secondOnLeave = () => {};
        const { rerender } = render(
            <GameProvider auth={auth} onLeave={firstOnLeave}>
                <CaptureSession />
            </GameProvider>,
        );
        const originalSession = sessions.at(-1);

        rerender(
            <GameProvider auth={auth} onLeave={secondOnLeave}>
                <CaptureSession />
            </GameProvider>,
        );

        expect(sessions.at(-1)).toBe(originalSession);
    });

    it('throws error when useGameContext is used outside GameProvider', () => {
        // Suppress expected console.error from React
        const originalError = console.error;
        console.error = () => {};

        expect(() => render(<TestConsumer />)).toThrow(
            'useGameContext must be used inside <GameProvider>'
        );

        console.error = originalError;
    });

    it('manages state transitions correctly within GameProvider', async () => {
        const user = userEvent.setup();

        render(
            <GameProvider auth={auth}>
                <TestConsumer />
            </GameProvider>
        );

        // Initial default assertions
        expect(screen.getByTestId('room-name')).toHaveTextContent('none');
        expect(screen.getByTestId('game-phase')).toHaveTextContent('none');
        expect(screen.getByTestId('ws-status')).toHaveTextContent('disconnected');
        expect(screen.getByTestId('is-game-over')).toHaveTextContent('no');

        // SET_ROOM action
        await user.click(screen.getByRole('button', { name: 'Set Room' }));
        expect(screen.getByTestId('room-name')).toHaveTextContent('High Roller Suite');

        // applyIncomingGameState
        await user.click(screen.getByRole('button', { name: 'Apply Game' }));
        expect(screen.getByTestId('game-phase')).toHaveTextContent('FLOP');
        expect(screen.getByTestId('pot-amount')).toHaveTextContent('1200');

        // SET_NOTIFICATION
        await user.click(screen.getByRole('button', { name: 'Set Notification' }));
        expect(screen.getByTestId('notification')).toHaveTextContent('Welcome to the table');

        // CLEAR_NOTIFICATION
        await user.click(screen.getByRole('button', { name: 'Clear Notification' }));
        expect(screen.getByTestId('notification')).toHaveTextContent('none');

        // SET_WS_STATUS
        await user.click(screen.getByRole('button', { name: 'Set Connected' }));
        expect(screen.getByTestId('ws-status')).toHaveTextContent('connected');

        // CLEAR_GAME_STATE resets game and phase back to defaults
        await user.click(screen.getByRole('button', { name: 'Clear Game State' }));
        expect(screen.getByTestId('game-phase')).toHaveTextContent('none');
        expect(screen.getByTestId('pot-amount')).toHaveTextContent('0');
        // Room state is retained
        expect(screen.getByTestId('room-name')).toHaveTextContent('High Roller Suite');
    });

    it('clears persisted poker-game-end snapshot when LEAVE_REVIEW is triggered from GameReviewView and unmounts GameProvider', async () => {
        const { useState } = await import('react');
        const { useGameDispatcher } = await import('../../hooks/useGameDispatcher');
        const { GameReviewView } = await import('../../components/GameReviewView');
        const user = userEvent.setup();

        localStorage.setItem(
            `poker-game-end:${auth.roomId}`,
            JSON.stringify({
                winnerName: 'Player1',
                isForfeit: false,
                message: 'Player1 wins!',
            })
        );

        function ReviewConsumer() {
            const ctx = useGameContext();
            const { dispatch } = useGameDispatcher();
            return (
                <GameReviewView
                    gameEndResult={ctx.gameEndResult}
                    gameState={ctx.gameState}
                    onLeave={() => {
                        void dispatch({ type: 'LEAVE_REVIEW' });
                    }}
                />
            );
        }

        function Host() {
            const [mounted, setMounted] = useState(true);
            if (!mounted) return <div data-testid="unmounted">Lobby</div>;
            return (
                <GameProvider auth={auth} onLeave={() => setMounted(false)}>
                    <ReviewConsumer />
                </GameProvider>
            );
        }

        render(<Host />);
        expect(localStorage.getItem(`poker-game-end:${auth.roomId}`)).not.toBeNull();

        await user.click(screen.getByRole('button', { name: /leave/i }));

        expect(screen.getByTestId('unmounted')).toBeInTheDocument();
        expect(localStorage.getItem(`poker-game-end:${auth.roomId}`)).toBeNull();
    });

    it('routes STOMP subscriptions, incoming frames, and outgoing actions through GameSession with zero duplicate subscriptions', async () => {
        const { act } = await import('@testing-library/react');
        const { InMemoryTransportAdapter } = await import('../../services/transport');
        const { useGameWebSocket } = await import('../../hooks/useGameWebSocket');
        const { useGameDispatcher } = await import('../../hooks/useGameDispatcher');
        const user = userEvent.setup();

        const transport = new InMemoryTransportAdapter();

        function UnifiedTableConsumer() {
            const ctx = useGameContext();
            useGameWebSocket();
            const dispatcher = useGameDispatcher();

            return (
                <div>
                    <span data-testid="ws-status">{ctx.wsStatus}</span>
                    <span data-testid="phase">{ctx.gameState?.phase ?? 'none'}</span>
                    <span data-testid="hole-cards">{ctx.privateState?.holeCards.join(',') ?? 'none'}</span>
                    <span data-testid="pending-play">{dispatcher.isPending('PLAY_ACTION') ? 'yes' : 'no'}</span>
                    <span data-testid="session-pending-play">
                        {ctx.session?.getSnapshot().pendingActions.has('PLAY_ACTION') ? 'yes' : 'no'}
                    </span>
                    <span data-testid="dispatch-error">{dispatcher.error?.message ?? 'none'}</span>
                    <button
                        type="button"
                        onClick={() => ctx.dispatch({ type: 'SET_HYDRATED', payload: true })}
                    >
                        Hydrate
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void dispatcher.dispatch({ type: 'PLAY_ACTION', action: 'RAISE', amount: 100 });
                        }}
                    >
                        Raise 100
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void dispatcher.dispatch({ type: 'READY' });
                        }}
                    >
                        Ready
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void dispatcher.dispatch({ type: 'UNREADY' });
                        }}
                    >
                        Unready
                    </button>
                    <button
                        type="button"
                        onClick={() => dispatcher.clearError()}
                    >
                        Clear Error
                    </button>
                </div>
            );
        }

        render(
            <GameProvider auth={auth} transport={transport}>
                <UnifiedTableConsumer />
            </GameProvider>
        );

        await user.click(screen.getByRole('button', { name: 'Hydrate' }));

        expect(screen.getByTestId('ws-status')).toHaveTextContent('connected');

        // Verify exactly 1 subscription per topic on GameSession's transport (zero duplicate subscriptions)
        const subscriptions = transport.getSubscriptions();
        expect(subscriptions.get(`/room/${auth.roomId}`)?.size).toBe(1);
        expect(subscriptions.get(`/game/${auth.roomId}`)?.size).toBe(1);
        expect(subscriptions.get('/user/queue/private')?.size).toBe(1);

        // Incoming game and private frames flow through GameSession
        act(() => {
            transport.simulateMessage(`/game/${auth.roomId}`, {
                gameId: 'game-99',
                phase: 'PRE_FLOP',
                pot: 30,
                currentBet: 20,
                communityCards: [],
                maxPlayers: 6,
                currentPlayerName: 'Player1',
                currentPlayerId: 'p-1',
                players: [{ id: 'p-1', name: 'Player1', chips: 980, currentBet: 20, hasFolded: false, status: 'ACTIVE' }],
            });
            transport.simulateMessage('/user/queue/private', {
                playerId: 'p-1',
                holeCards: ['As', 'Ks'],
            });
        });

        expect(screen.getByTestId('phase')).toHaveTextContent('PRE_FLOP');
        expect(screen.getByTestId('hole-cards')).toHaveTextContent('As,Ks');

        // Outgoing PLAY_ACTION flows through GameSession and acquires GameSession action lock
        await user.click(screen.getByRole('button', { name: 'Raise 100' }));
        expect(screen.getByTestId('pending-play')).toHaveTextContent('yes');
        expect(screen.getByTestId('session-pending-play')).toHaveTextContent('yes');
        expect(transport.getPublishedMessages('/app/game-99/action')).toEqual([
            {
                destination: '/app/game-99/action',
                body: JSON.stringify({ action: 'RAISE', amount: 100 }),
            },
        ]);

        // Incoming private ACTION_ERROR clears GameSession action lock and populates dispatcher.error
        act(() => {
            transport.simulateMessage('/user/queue/private', {
                type: 'ACTION_ERROR',
                code: 'INSUFFICIENT_CHIPS',
                action: 'RAISE',
                message: 'Insufficient chips to raise',
            });
        });

        expect(screen.getByTestId('pending-play')).toHaveTextContent('no');
        expect(screen.getByTestId('session-pending-play')).toHaveTextContent('no');
        expect(screen.getByTestId('dispatch-error')).toHaveTextContent('Insufficient chips to raise');

        // Clearing error via dispatcher clears GameSession error
        await user.click(screen.getByRole('button', { name: 'Clear Error' }));
        expect(screen.getByTestId('dispatch-error')).toHaveTextContent('none');

        // READY and UNREADY also publish through GameSession
        await user.click(screen.getByRole('button', { name: 'Ready' }));
        await user.click(screen.getByRole('button', { name: 'Unready' }));
        expect(transport.getPublishedMessages('/app/game-99/ready')).toHaveLength(1);
        expect(transport.getPublishedMessages('/app/game-99/unready')).toHaveLength(1);
    });
});

