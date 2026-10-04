import { render, screen, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameProvider } from '../GameProvider';
import { useGameContext } from '../GameContext';
import type { IncomingGameStatePayload } from '../../types';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';

function TestConsumer() {
    const ctx = useGameContext();
    return (
        <div>
            <span data-testid="game-phase">{ctx.gameState?.phase ?? 'none'}</span>
            <span data-testid="ready-active">{ctx.gameState?.isReadyCountdownActive ? 'true' : 'false'}</span>
            <span data-testid="showdown-result">{ctx.showdownResult ? 'present' : 'null'}</span>
            <button
                type="button"
                data-testid="apply-game"
                onClick={(e) => {
                    const payload = JSON.parse(e.currentTarget.getAttribute('data-payload') || '{}');
                    ctx.applyIncomingGameState(payload);
                }}
            >
                Apply Game
            </button>
        </div>
    );
}

describe('GameProvider Integration: Showdown to Pre-flop Transition', () => {
    const auth = {
        roomId: 'test-room',
        playerName: 'Player1',
        token: 'token-123',
        message: 'Success',
    };

    it('handles out-of-order showdown packets without resurrecting ready state', async () => {
        const user = userEvent.setup();
        render(
            <GameProvider auth={auth}>
                <TestConsumer />
            </GameProvider>
        );

        const applyGameBtn = screen.getByTestId('apply-game');

        // 1. SHOWDOWN with winners and isReadyCountdownActive: true
        await act(async () => {
            applyGameBtn.setAttribute('data-payload', JSON.stringify({
                maxPlayers: 2,
                currentBet: 0,
                phase: 'SHOWDOWN',
                pot: 100,
                communityCards: [],
                players: [{ id: 'p1', name: 'Player1', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any, { id: 'p2', name: 'Player2', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any],
                currentPlayerName: '',
                currentPlayerId: '',
                winners: ['Player1'],
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: Date.now() + 5000,
            } as IncomingGameStatePayload));
            await user.click(applyGameBtn);
        });
        expect(screen.getByTestId('game-phase')).toHaveTextContent('SHOWDOWN');
        expect(screen.getByTestId('ready-active')).toHaveTextContent('true');
        expect(screen.getByTestId('showdown-result')).toHaveTextContent('present');

        // 2. Intermediate ready update (1/2 ready, winners: null)
        await act(async () => {
            applyGameBtn.setAttribute('data-payload', JSON.stringify({
                maxPlayers: 2,
                currentBet: 0,
                phase: 'SHOWDOWN',
                pot: 100,
                communityCards: [],
                players: [{ id: 'p1', name: 'Player1', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: true } as any, { id: 'p2', name: 'Player2', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any],
                currentPlayerName: '',
                currentPlayerId: '',
                
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: Date.now() + 5000,
            } as IncomingGameStatePayload));
            await user.click(applyGameBtn);
        });

        // 3. Final ready update (2/2 ready)
        await act(async () => {
            applyGameBtn.setAttribute('data-payload', JSON.stringify({
                maxPlayers: 2,
                currentBet: 0,
                phase: 'SHOWDOWN',
                pot: 100,
                communityCards: [],
                players: [
                    { id: 'p1', name: 'Player1', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: true },
                    { id: 'p2', name: 'Player2', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: true }
                ],
                currentPlayerName: '',
                currentPlayerId: '',
                
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: Date.now() + 5000,
            } as IncomingGameStatePayload));
            await user.click(applyGameBtn);
        });

        // 4. PRE_FLOP state
        await act(async () => {
            applyGameBtn.setAttribute('data-payload', JSON.stringify({
                maxPlayers: 2,
                currentBet: 0,
                phase: 'PRE_FLOP',
                pot: 75,
                communityCards: [],
                players: [{ id: 'p1', name: 'Player1', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any, { id: 'p2', name: 'Player2', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any],
                currentPlayerName: 'Player1',
                currentPlayerId: 'p1',
                isReadyCountdownActive: false,
            } as IncomingGameStatePayload));
            await user.click(applyGameBtn);
        });
        expect(screen.getByTestId('game-phase')).toHaveTextContent('PRE_FLOP');
        expect(screen.getByTestId('ready-active')).toHaveTextContent('false');
        expect(screen.getByTestId('showdown-result')).toHaveTextContent('null');

        // 5. Late arriving SHOWDOWN packet (out of order)
        await act(async () => {
            applyGameBtn.setAttribute('data-payload', JSON.stringify({
                maxPlayers: 2,
                currentBet: 0,
                phase: 'SHOWDOWN',
                pot: 100,
                communityCards: [],
                players: [{ id: 'p1', name: 'Player1', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: true } as any, { id: 'p2', name: 'Player2', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false } as any],
                currentPlayerName: '',
                currentPlayerId: '',
                
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: Date.now() - 1000,
            } as IncomingGameStatePayload));
            await user.click(applyGameBtn);
        });
        
        expect(screen.getByTestId('game-phase')).toHaveTextContent('PRE_FLOP');
        expect(screen.getByTestId('ready-active')).toHaveTextContent('false');
        expect(screen.getByTestId('showdown-result')).toHaveTextContent('null');
    });
});
