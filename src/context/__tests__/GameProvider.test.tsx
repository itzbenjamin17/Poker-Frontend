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
});
