import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameTableView } from '../GameTableView';
import { WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX } from '../../constants/strings';
import type { GameState, RoomState, Player } from '../../types';
import '@testing-library/jest-dom';

describe('GameTableView', () => {
    const defaultPlayer: Player = {
        id: 'p-1',
        name: 'Hero',
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    const opponentPlayer: Player = {
        id: 'p-2',
        name: 'Villain',
        chips: 1000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    const mockRoomState: RoomState = {
        roomId: 'room-1',
        roomName: 'High Roller Room',
        players: [{ name: 'Hero', isHost: true }, { name: 'Villain', isHost: false }],
        gameStarted: true,
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000,
    };

    const mockGameState: GameState = {
        gameId: 'game-1',
        phase: 'FLOP',
        pot: 100,
        communityCards: ['AS', 'KH', '2D'],
        currentPlayerId: 'p-1',
        currentPlayerName: 'Hero',
        currentBet: 0,
        maxPlayers: 6,
        players: [defaultPlayer, opponentPlayer],
    };

    const defaultProps = {
        gameState: mockGameState,
        roomState: mockRoomState,
        auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1', message: 'Success' },
        myPlayerId: 'p-1',
        privateState: { holeCards: ['AH', 'AD'] },
        showdown: null,
        showdownResult: null,
        claimPending: false,
        notification: null,
        wsStatus: 'connected' as const,
        nowMs: 100000,
        raiseAmount: '40',
        raiseError: null,
        onAction: vi.fn(),
        onReady: vi.fn(),
        onUnready: vi.fn(),
        onClaimWin: vi.fn(),
        onLeaveGame: vi.fn(),
        onRaiseChange: vi.fn(),
        isActionPending: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        window.innerWidth = 1024;
        window.innerHeight = 768;
    });

    describe('Item 18: Disconnect Overlay & Reconnect Banner', () => {
        it('renders the connection lost overlay when wsStatus is disconnected', () => {
            render(<GameTableView {...defaultProps} wsStatus="disconnected" />);

            const alertEl = screen.getByRole('alert');
            expect(alertEl).toBeInTheDocument();
            expect(alertEl).toHaveTextContent(/connection lost/i);
            expect(alertEl).toHaveTextContent(/reconnecting/i);
        });

        it('does not render connection lost overlay when wsStatus is connected', () => {
            render(<GameTableView {...defaultProps} wsStatus="connected" />);

            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('shows reconnect status in the dock until the current actor reconnects', () => {
            const disconnectedOpponent: Player = {
                ...opponentPlayer,
                status: 'DISCONNECTED',
            };
            const stateWithDisconnectedTurn: GameState = {
                ...mockGameState,
                currentPlayerId: 'p-2',
                currentPlayerName: 'Villain',
                players: [defaultPlayer, disconnectedOpponent],
            };

            const { rerender } = render(
                <GameTableView
                    {...defaultProps}
                    gameState={stateWithDisconnectedTurn}
                    isCompactTable={false}
                />
            );

            const dock = within(screen.getByTestId('room-dock'));
            expect(dock.getByRole('status')).toHaveTextContent(`${WAITING_RECONNECT_PREFIX}Villain${WAITING_RECONNECT_SUFFIX}`);

            rerender(
                <GameTableView
                    {...defaultProps}
                    gameState={{ ...stateWithDisconnectedTurn, players: [defaultPlayer, opponentPlayer] }}
                    isCompactTable={false}
                />
            );

            expect(dock.getByRole('status')).toHaveTextContent('Waiting for Villain to act');
        });

        it('keeps the local action controls available when an opponent disconnects', () => {
            const disconnectedOpponent: Player = {
                ...opponentPlayer,
                status: 'DISCONNECTED',
            };
            const stateWithHeroTurnAndDisconnectedVillain: GameState = {
                ...mockGameState,
                currentPlayerId: 'p-1',
                currentPlayerName: 'Hero',
                players: [defaultPlayer, disconnectedOpponent],
            };

            render(
                <GameTableView
                    {...defaultProps}
                    gameState={stateWithHeroTurnAndDisconnectedVillain}
                    isCompactTable={false}
                />
            );

            const dock = within(screen.getByTestId('room-dock'));
            expect(dock.getByRole('button', { name: /fold/i })).toBeEnabled();
            expect(dock.queryByText(/to reconnect/i)).not.toBeInTheDocument();
        });
    });

    describe('Short-viewport chrome', () => {
        it('compacts only the showdown dock on short viewports', () => {
            const { unmount } = render(
                <GameTableView
                    {...defaultProps}
                    gameState={{ ...mockGameState, phase: 'SHOWDOWN' }}
                />
            );
            const showdownDock = screen.getByRole('region', { name: /room dock/i });
            expect(showdownDock).toBeInTheDocument();
            expect(showdownDock).toHaveAttribute('data-phase', 'SHOWDOWN');
            unmount();

            render(
                <GameTableView
                    {...defaultProps}
                    gameState={{ ...mockGameState, phase: 'FLOP' }}
                />
            );
            const flopDock = screen.getByRole('region', { name: /room dock/i });
            expect(flopDock).toBeInTheDocument();
            expect(flopDock).toHaveAttribute('data-phase', 'FLOP');
        });
    });

    describe('Item 19: isCompactTable scaling and layout classes', () => {
        it('applies the compact action slot state when isCompactTable is true', () => {
            render(<GameTableView {...defaultProps} isCompactTable={true} />);

            const dock = screen.getByRole('region', { name: /room dock/i });
            expect(dock).toBeInTheDocument();
            expect(dock).toHaveAttribute('data-is-compact', 'true');
        });

        it('applies the standard action slot state when isCompactTable is false', () => {
            render(<GameTableView {...defaultProps} isCompactTable={false} />);

            const dock = screen.getByRole('region', { name: /room dock/i });
            expect(dock).toBeInTheDocument();
            expect(dock).toHaveAttribute('data-is-compact', 'false');
        });

        it('derives isMobileLandscape and isCompactTable from mobile landscape viewport dimensions and suppresses dock leave controls', () => {
            window.innerWidth = 740;
            window.innerHeight = 360;

            render(<GameTableView {...defaultProps} hasShellHeader={true} />);

            const dock = screen.getByRole('region', { name: /room dock/i });
            expect(dock).toHaveAttribute('data-is-compact', 'true');

            const actionDock = screen.getByRole('region', { name: /action dock/i });
            expect(actionDock).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^leave$/i })).not.toBeInTheDocument();
        });

        it('forwards ready eligibility and countdown props to ResultDock during SHOWDOWN', () => {
            const bustedHero: Player = { ...defaultPlayer, status: 'OUT', chips: 0 };
            const showdownState: GameState = {
                ...mockGameState,
                phase: 'SHOWDOWN',
                winners: ['Villain'],
                winningsPerPlayer: 100,
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 112000,
                players: [bustedHero, { ...opponentPlayer, isReadyForNextHand: true }],
            };

            render(
                <GameTableView
                    {...defaultProps}
                    gameState={showdownState}
                    showdownResult={showdownState}
                />,
            );

            expect(screen.queryByRole('button', { name: /^ready$/i })).not.toBeInTheDocument();
            expect(screen.getByText(/12s/i)).toBeInTheDocument();
        });

        it('falls back to ActionPanel during SHOWDOWN when showdownResult is null', () => {
            const showdownState: GameState = {
                ...mockGameState,
                phase: 'SHOWDOWN',
                isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 112000,
            };

            render(
                <GameTableView
                    {...defaultProps}
                    gameState={showdownState}
                    showdownResult={null}
                />,
            );

            expect(screen.queryByRole('region', { name: /round result/i })).not.toBeInTheDocument();
            expect(screen.getByRole('region', { name: /action dock/i })).toBeInTheDocument();
        });

        it('wires the fallback Unready control and respects pending state', async () => {
            const user = (await import('@testing-library/user-event')).default.setup();
            const readyHero = { ...defaultPlayer, isReadyForNextHand: true };
            const showdownState: GameState = {
                ...mockGameState, phase: 'SHOWDOWN', players: [readyHero, opponentPlayer],
                readyGateState: 'COUNTING_DOWN', isReadyCountdownActive: true,
                readyCountdownDeadlineEpochMs: 112000,
            };
            const { unmount } = render(<GameTableView {...defaultProps} gameState={showdownState} nowMs={100000} />);
            const unready = screen.getByRole('button', { name: /^unready$/i });
            expect(unready).toBeEnabled();
            await user.click(unready);
            expect(defaultProps.onUnready).toHaveBeenCalledTimes(1);
            expect(defaultProps.onReady).not.toHaveBeenCalled();

            unmount();
            render(<GameTableView {...defaultProps} gameState={showdownState} nowMs={100000} isActionPending />);
            expect(screen.getByRole('button', { name: /^unready$/i })).toBeDisabled();
        });

        it('shows the authoritative waiting-for-players gate in the SHOWDOWN fallback', () => {
            const waitingState: GameState = {
                ...mockGameState,
                phase: 'SHOWDOWN',
                readyGateState: 'WAITING_FOR_PLAYERS',
                isReadyCountdownActive: false,
            };
            render(<GameTableView {...defaultProps} gameState={waitingState} showdownResult={null} />);
            expect(screen.getByText('Hand complete — waiting for players')).toBeInTheDocument();
        });
    });

    describe('Semantic ARIA roles and domain data attributes', () => {
        it('renders live poker table region, community cards, action dock, and seat attributes', () => {
            render(<GameTableView {...defaultProps} />);

            // Table landmark and surface region
            expect(screen.getByRole('main', { name: /live poker table/i })).toBeInTheDocument();
            expect(screen.getByRole('region', { name: /^poker table$/i })).toBeInTheDocument();

            // Community cards region
            expect(screen.getByRole('region', { name: /community cards/i })).toBeInTheDocument();

            // Action dock region
            const actionDock = screen.getByRole('region', { name: /action dock/i });
            expect(actionDock).toBeInTheDocument();
            expect(actionDock).toHaveAttribute('data-is-active-turn', 'true');

            // Hero seat
            const heroSeat = screen.getByRole('group', { name: /hero hero seat/i });
            expect(heroSeat).toBeInTheDocument();
            expect(heroSeat).toHaveAttribute('data-seat-index', '0');
            expect(heroSeat).toHaveAttribute('data-is-active-turn', 'true');
            expect(heroSeat).toHaveAttribute('data-is-winner', 'false');

            // Opponent seat
            const villainSeat = screen.getByRole('group', { name: /villain seat/i });
            expect(villainSeat).toBeInTheDocument();
            expect(villainSeat).toHaveAttribute('data-seat-index', '1');
            expect(villainSeat).toHaveAttribute('data-is-active-turn', 'false');
            expect(villainSeat).toHaveAttribute('data-is-winner', 'false');
        });
    });
});
