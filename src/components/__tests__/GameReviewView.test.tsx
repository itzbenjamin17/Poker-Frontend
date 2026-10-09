import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GameReviewView } from '../GameReviewView';
import type { GameState } from '../../types';
import '@testing-library/jest-dom';

describe('GameReviewView', () => {
    const mockOnLeave = vi.fn();
    const mockGameState: GameState = {
        gameId: 'game-1',
        phase: 'SHOWDOWN',
        pot: 5000,
        currentBet: 0,
        maxPlayers: 6,
        currentPlayerId: 'p-1',
        currentPlayerName: 'WinnerPlayer',
        communityCards: ['AH', 'KH', 'QD', 'JS', '2C'],
        players: [
            {
                id: 'p-1',
                name: 'WinnerPlayer',
                chips: 5000,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
                isWinner: true,
                holeCards: ['AS', 'KS'],
                handRank: 'ROYAL_FLUSH',
            },
            {
                id: 'p-2',
                name: 'LoserPlayer',
                chips: 0,
                status: 'ACTIVE',
                currentBet: 0,
                hasFolded: false,
                isReadyForNextHand: false,
                isWinner: false,
                holeCards: ['2H', '7D'],
            }
        ]
    };

    it('renders the winner name, final board, and revealed cards', () => {
        render(
            <GameReviewView
                gameEndResult={{
                    winnerName: 'WinnerPlayer',
                    winnerChips: 5000,
                    isForfeit: false,
                    message: 'WinnerPlayer wins with a Royal Flush!',
                }}
                gameState={mockGameState}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByRole('region', { name: /game review/i })).toBeInTheDocument();
        expect(screen.getByText(/WinnerPlayer wins!/i)).toBeInTheDocument();
        expect(screen.getByText(/Collected 5000 chips/i)).toBeInTheDocument();
        expect(screen.getByText(/WinnerPlayer wins with a Royal Flush!/i)).toBeInTheDocument();
        
        // Check final standings
        expect(screen.getByText('WinnerPlayer')).toBeInTheDocument();
        expect(screen.getByText('LoserPlayer')).toBeInTheDocument();
        expect(screen.getByText(/• ROYAL FLUSH/i)).toBeInTheDocument();

        // Leave button
        expect(screen.getByRole('button', { name: /LEAVE/i })).toBeInTheDocument();
    });

    it('renders forfeit note when isForfeit is true', () => {
        render(
            <GameReviewView
                gameEndResult={{
                    winnerName: 'WinnerPlayer',
                    isForfeit: true,
                    message: 'LoserPlayer left the game.',
                }}
                gameState={mockGameState}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByText(/Won by forfeit/i)).toBeInTheDocument();
    });

    it('does not render Action dock or Leave Table button', () => {
        render(
            <GameReviewView
                gameEndResult={{
                    winnerName: 'WinnerPlayer',
                    isForfeit: false,
                    message: 'Game Over',
                }}
                gameState={mockGameState}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.queryByLabelText(/Action dock/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/LEAVE TABLE/i)).not.toBeInTheDocument();
    });
});
