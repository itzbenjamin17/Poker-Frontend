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
            const { dispatch } = useGameDispatcher({
                publish: () => {},
                isConnected: () => true,
            });
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
});
