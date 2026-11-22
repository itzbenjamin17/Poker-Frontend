import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GameReviewView } from '../GameReviewView';
import type { PublicGameStateResponse } from '../../types';
import '@testing-library/jest-dom';

describe('GameReviewView', () => {
    const mockOnLeave = vi.fn();
    const mockGameState: PublicGameStateResponse = {
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
                    ...mockGameState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'WinnerPlayer',
                        winnerChips: 5000,
                        isForfeit: false,
                        message: 'WinnerPlayer wins with a Royal Flush!',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByRole('region', { name: /game review/i })).toBeInTheDocument();
        expect(screen.getByText(/WinnerPlayer wins!/i)).toBeInTheDocument();
        expect(screen.getByText(/Finished with 5,000 chips/i)).toBeInTheDocument();
        
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
                    ...mockGameState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'WinnerPlayer',
                        isForfeit: true,
                        message: 'LoserPlayer left the game.',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByText(/Won by forfeit/i)).toBeInTheDocument();
    });

    describe('forfeit reason from the server', () => {
        const forfeitedBy = (reason: string | undefined, forfeitedPlayers: string[] | undefined): PublicGameStateResponse => ({
            ...mockGameState,
            gameId: 'ROOM1',
            gameEnd: {
                winner: 'WinnerPlayer',
                winnerChips: 5000,
                isForfeit: true,
                reason,
                forfeitedPlayers,
                message: 'WinnerPlayer wins the game with 5000 chips!',
            },
        });

        it.each([
            ['TURN_TIMEOUT', 'You ran out of time on your turn.', 'LoserPlayer ran out of time on their turn.'],
            ['PLAYER_LEFT', 'You left the table.', 'LoserPlayer left the table.'],
            ['DISCONNECTED', "You lost connection and didn't return in time.", "LoserPlayer lost connection and didn't return in time."],
        ])('%s: tells the forfeiting player and the winner what happened', (reason, toForfeiter, toWinner) => {
            const result = forfeitedBy(reason, ['LoserPlayer']);
            const { unmount } = render(<GameReviewView gameEndResult={result} playerName="LoserPlayer" onLeave={mockOnLeave} />);
            expect(screen.getByText(toForfeiter)).toBeInTheDocument();
            expect(screen.queryByText(/won by forfeit/i)).not.toBeInTheDocument();
            unmount();

            render(<GameReviewView gameEndResult={result} playerName="WinnerPlayer" onLeave={mockOnLeave} />);
            expect(screen.getByText(toWinner)).toBeInTheDocument();
        });

        it('names several players who forfeited together', () => {
            render(<GameReviewView gameEndResult={forfeitedBy('DISCONNECTED', ['Ben', 'Cal', 'Dee'])} playerName="WinnerPlayer" onLeave={mockOnLeave} />);
            expect(screen.getByText("Ben, Cal and Dee lost connection and didn't return in time.")).toBeInTheDocument();
        });

        it('falls back to the generic forfeit note when the reason is missing or unknown', () => {
            const { unmount } = render(<GameReviewView gameEndResult={forfeitedBy(undefined, undefined)} playerName="WinnerPlayer" onLeave={mockOnLeave} />);
            expect(screen.getByText('(Won by forfeit)')).toBeInTheDocument();
            unmount();
            render(<GameReviewView gameEndResult={forfeitedBy('SOMETHING_NEW', ['LoserPlayer'])} playerName="WinnerPlayer" onLeave={mockOnLeave} />);
            expect(screen.getByText('(Won by forfeit)')).toBeInTheDocument();
        });
    });

    it('does not render Action dock or Leave Table button', () => {
        render(
            <GameReviewView
                gameEndResult={{
                    ...mockGameState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'WinnerPlayer',
                        isForfeit: false,
                        message: 'Game Over',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.queryByLabelText(/Action dock/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/LEAVE TABLE/i)).not.toBeInTheDocument();
    });

    it('renders board and players directly from completed PublicGameStateResponse gameEndResult', () => {
        const finalState: PublicGameStateResponse = {
            ...mockGameState,
            gameId: 'ROOM1',
            communityCards: ['2C', '3D', '4H', '5S', '9C'],
            players: [
                {
                    id: 'p-final-1',
                    name: 'FinalWinner',
                    chips: 8000,
                    status: 'ACTIVE',
                    currentBet: 0,
                    hasFolded: false,
                    isReadyForNextHand: false,
                    isWinner: true,
                    holeCards: ['AH', 'AC'],
                },
                {
                    id: 'p-final-2',
                    name: 'FinalRunnerUp',
                    chips: 2000,
                    status: 'ACTIVE',
                    currentBet: 0,
                    hasFolded: false,
                    isReadyForNextHand: false,
                    isWinner: false,
                    holeCards: ['KH', 'KC'],
                },
            ],
            gameEnd: {
                winner: 'FinalWinner',
                winnerChips: 8000,
                isForfeit: false,
                message: 'FinalWinner won',
            },
        };

        render(
            <GameReviewView
                gameEndResult={finalState}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByText('FinalWinner')).toBeInTheDocument();
        expect(screen.getByText('FinalRunnerUp')).toBeInTheDocument();
        expect(screen.queryByText('WinnerPlayer')).not.toBeInTheDocument();
        expect(screen.queryByText('LoserPlayer')).not.toBeInTheDocument();
    });

    it('awards exactly one champion WINNER badge when gameEnd.winner exists even if other players have isWinner true', () => {
        const stateWithMultipleWinners: PublicGameStateResponse = {
            ...mockGameState,
            players: [
                {
                    id: 'p-1',
                    name: 'PlayerOne',
                    chips: 1000,
                    status: 'ACTIVE',
                    currentBet: 0,
                    hasFolded: false,
                    isReadyForNextHand: false,
                    isWinner: true, // leftover from previous round
                },
                {
                    id: 'p-2',
                    name: 'PlayerTwo',
                    chips: 9000,
                    status: 'ACTIVE',
                    currentBet: 0,
                    hasFolded: false,
                    isReadyForNextHand: false,
                    isWinner: false,
                },
            ],
        };

        render(
            <GameReviewView
                gameEndResult={{
                    ...stateWithMultipleWinners,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'PlayerTwo',
                        winnerChips: 9000,
                        isForfeit: false,
                        message: 'PlayerTwo won',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        const winnerBadges = screen.getAllByText('WINNER');
        expect(winnerBadges).toHaveLength(1);
        expect(winnerBadges[0].closest('div')).toHaveTextContent('PlayerTwo');
    });

    it('sorts standings champion first, then descending chips, retaining original seat order for equal stacks without mutating source', () => {
        const sourcePlayers = Object.freeze([
            { id: 'p-1', name: 'Seat1Equal', chips: 1500, status: 'ACTIVE' as const, currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            { id: 'p-2', name: 'Seat2Low', chips: 500, status: 'ACTIVE' as const, currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            { id: 'p-3', name: 'Seat3Champion', chips: 3000, status: 'ACTIVE' as const, currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            { id: 'p-4', name: 'Seat4High', chips: 4000, status: 'ACTIVE' as const, currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            { id: 'p-5', name: 'Seat5Equal', chips: 1500, status: 'ACTIVE' as const, currentBet: 0, hasFolded: false, isReadyForNextHand: false },
        ]);

        const state: PublicGameStateResponse = {
            ...mockGameState,
            players: sourcePlayers as unknown as PublicGameStateResponse['players'],
        };

        const { container } = render(
            <GameReviewView
                gameEndResult={{
                    ...state,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'Seat3Champion',
                        winnerChips: 3000,
                        isForfeit: false,
                        message: 'Champion won',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        // Expected order:
        // 1. Champion: Seat3Champion (chips 3000, but champion comes first)
        // 2. Highest chips: Seat4High (chips 4000)
        // 3. Equal chips seat 1: Seat1Equal (chips 1500)
        // 4. Equal chips seat 5: Seat5Equal (chips 1500)
        // 5. Lowest chips: Seat2Low (chips 500)
        const playerNames = Array.from(container.querySelectorAll('.truncate')).map((el) => el.textContent);
        expect(playerNames).toEqual(['Seat3Champion', 'Seat4High', 'Seat1Equal', 'Seat5Equal', 'Seat2Low']);
    });

    it('invokes onLeave when clicking Leave review button', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        render(
            <GameReviewView
                gameEndResult={{
                    ...mockGameState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'Seat3Champion',
                        winnerChips: 3000,
                        isForfeit: false,
                        message: 'Champion won',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        const leaveBtn = screen.getByRole('button', { name: /LEAVE/i });
        await user.click(leaveBtn);
        expect(mockOnLeave).toHaveBeenCalledTimes(1);
    });

    it('enforces an exclusive WINNER badge for champion and suppresses multiple lingering isWinner flags', () => {
        const legacyMultiWinnerState: PublicGameStateResponse = {
            ...mockGameState,
            players: [
                { id: 'p-1', name: 'Alice', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: true },
                { id: 'p-2', name: 'Bob', chips: 2000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: true },
                { id: 'p-3', name: 'CharlieChampion', chips: 8000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: false },
                { id: 'p-4', name: 'David', chips: 500, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: true },
            ],
        };

        const { container } = render(
            <GameReviewView
                gameEndResult={{
                    ...legacyMultiWinnerState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'CharlieChampion',
                        winnerChips: 8000,
                        isForfeit: false,
                        message: 'CharlieChampion is the tournament champion',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        // Verify only 1 badge is rendered
        const badges = screen.getAllByText('WINNER');
        expect(badges).toHaveLength(1);
        expect(badges[0].closest('div')).toHaveTextContent('CharlieChampion');

        // Verify standings are champion first, then descending chips
        const names = Array.from(container.querySelectorAll('.truncate')).map((el) => el.textContent);
        expect(names).toEqual(['CharlieChampion', 'Bob', 'Alice', 'David']);
    });

    it('falls back to Boolean(player.isWinner) when gameEnd.winner is absent', () => {
        const stateWithoutWinnerName: PublicGameStateResponse = {
            ...mockGameState,
            players: [
                { id: 'p-1', name: 'PlayerOne', chips: 5000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: true },
                { id: 'p-2', name: 'PlayerTwo', chips: 3000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false, isWinner: false },
            ],
        };

        render(
            <GameReviewView
                gameEndResult={{
                    ...stateWithoutWinnerName,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: null,
                        isForfeit: false,
                        message: 'Game Concluded',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        const badges = screen.getAllByText('WINNER');
        expect(badges).toHaveLength(1);
        expect(badges[0].closest('div')).toHaveTextContent('PlayerOne');
    });

    it('places champion first even if another player has a larger chip stack due to forfeit', () => {
        const forfeitState: PublicGameStateResponse = {
            ...mockGameState,
            players: [
                { id: 'p-1', name: 'RunnerUpLargeStack', chips: 7000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false },
                { id: 'p-2', name: 'ForfeitChampion', chips: 3000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false },
                { id: 'p-3', name: 'ThirdPlace', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            ],
        };

        const { container } = render(
            <GameReviewView
                gameEndResult={{
                    ...forfeitState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: 'ForfeitChampion',
                        winnerChips: 3000,
                        isForfeit: true,
                        message: 'RunnerUp forfeited the match',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        const names = Array.from(container.querySelectorAll('.truncate')).map((el) => el.textContent);
        expect(names).toEqual(['ForfeitChampion', 'RunnerUpLargeStack', 'ThirdPlace']);
    });

    it('renders abandonment review without trophy, champion, or WINNER badges', () => {
        render(
            <GameReviewView
                gameEndResult={{
                    ...mockGameState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: null,
                        isForfeit: false,
                        abandoned: true,
                        reason: 'INACTIVITY',
                        message: 'Game abandoned due to inactivity.',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        expect(screen.getByText('GAME ABANDONED')).toBeInTheDocument();
        expect(screen.getByText('Closed due to inactivity')).toBeInTheDocument();
        expect(screen.queryByText(/wins!/i)).not.toBeInTheDocument();
        expect(screen.queryByText('WINNER')).not.toBeInTheDocument();
        expect(screen.getByText('Table state when play stopped')).toBeInTheDocument();
        expect(screen.getByText('Chips when play stopped')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /LEAVE/i })).toBeInTheDocument();
    });

    it('preserves original table player order on abandonment without ranking by chips', () => {
        const abandonedState: PublicGameStateResponse = {
            ...mockGameState,
            players: [
                { id: 'p-1', name: 'AliceSmallStack', chips: 1000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false },
                { id: 'p-2', name: 'BobLargeStack', chips: 9000, status: 'ACTIVE', currentBet: 0, hasFolded: false, isReadyForNextHand: false },
            ],
        };

        const { container } = render(
            <GameReviewView
                gameEndResult={{
                    ...abandonedState,
                    gameId: 'ROOM1',
                    gameEnd: {
                        winner: null,
                        isForfeit: false,
                        abandoned: true,
                        reason: 'INACTIVITY',
                        message: 'Game abandoned due to inactivity.',
                    },
                }}
                onLeave={mockOnLeave}
            />
        );

        const names = Array.from(container.querySelectorAll('.truncate')).map((el) => el.textContent);
        expect(names).toEqual(['AliceSmallStack', 'BobLargeStack']);
    });
});
