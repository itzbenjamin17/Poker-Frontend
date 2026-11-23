import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { GameTableView } from '../GameTableView';
import { RoomShellContext } from '../PokerRoomLayout';
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

    describe('standalone leave button', () => {
        it('asks for confirmation in a modal dialog before leaving', async () => {
            const user = userEvent.setup();
            const onLeaveGame = vi.fn();
            const confirmSpy = vi.spyOn(window, 'confirm');
            render(<GameTableView {...defaultProps} onLeaveGame={onLeaveGame} />);

            await user.click(screen.getByRole('button', { name: /leave table/i }));
            const dialog = screen.getByRole('dialog', { name: /leave the table/i });
            expect(onLeaveGame).not.toHaveBeenCalled();

            await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
            expect(onLeaveGame).toHaveBeenCalledTimes(1);
            expect(confirmSpy).not.toHaveBeenCalled();
        });

        it('stays at the table when the confirmation is cancelled', async () => {
            const user = userEvent.setup();
            const onLeaveGame = vi.fn();
            render(<GameTableView {...defaultProps} onLeaveGame={onLeaveGame} />);

            await user.click(screen.getByRole('button', { name: /leave table/i }));
            await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stay' }));
            expect(onLeaveGame).not.toHaveBeenCalled();
        });
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
            const unready = screen.getByRole('button', { name: /^cancel ready$/i });
            expect(unready).toBeEnabled();
            await user.click(unready);
            expect(defaultProps.onUnready).toHaveBeenCalledTimes(1);
            expect(defaultProps.onReady).not.toHaveBeenCalled();

            unmount();
            render(<GameTableView {...defaultProps} gameState={showdownState} nowMs={100000} isActionPending />);
            expect(screen.getByRole('button', { name: /^cancel ready$/i })).toBeDisabled();
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

    describe('Busted players', () => {
        const bustedPlayer: Player = { ...opponentPlayer, id: 'p-3', name: 'Busted', chips: 0, status: 'OUT' };

        it('does not draw a seat for an opponent who is out of chips', () => {
            render(<GameTableView {...defaultProps} gameState={{ ...mockGameState, players: [defaultPlayer, opponentPlayer, bustedPlayer] }} />);

            expect(screen.getByRole('group', { name: /villain seat/i })).toBeInTheDocument();
            expect(screen.queryByRole('group', { name: /busted seat/i })).not.toBeInTheDocument();
        });

        it("tells a busted hero they're out and lets them leave without the abandon-seat warning", async () => {
            const user = userEvent.setup();
            const onLeaveGame = vi.fn();
            render(
                <GameTableView
                    {...defaultProps}
                    onLeaveGame={onLeaveGame}
                    gameState={{
                        ...mockGameState,
                        currentPlayerId: 'p-2',
                        currentPlayerName: 'Villain',
                        players: [{ ...defaultPlayer, chips: 0, status: 'OUT' }, opponentPlayer, { ...bustedPlayer, name: 'Third', status: 'ACTIVE', chips: 500 }],
                    }}
                />,
            );

            const dock = screen.getByRole('region', { name: /action dock/i });
            expect(within(dock).getByText("You're out of chips")).toBeInTheDocument();
            expect(within(dock).queryByText(/waiting for villain/i)).not.toBeInTheDocument();
            await user.click(within(dock).getByRole('button', { name: /leave table/i }));
            expect(onLeaveGame).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    describe('Dealer button', () => {
        it('shows the dealer button on the seat the server marks as dealer', () => {
            const third: Player = { ...opponentPlayer, id: 'p-3', name: 'Third' };
            render(
                <GameTableView
                    {...defaultProps}
                    gameState={{
                        ...mockGameState,
                        players: [{ ...defaultPlayer, isDealer: true }, { ...opponentPlayer, isSmallBlind: true }, { ...third, isBigBlind: true }],
                    }}
                />,
            );

            const heroSeat = screen.getByRole('group', { name: /hero hero seat/i });
            expect(within(heroSeat).getByTestId('seat-dealer-button')).toHaveAccessibleName('Dealer');
            expect(within(screen.getByRole('group', { name: /villain seat/i })).queryByTestId('seat-dealer-button')).not.toBeInTheDocument();
            expect(within(screen.getByRole('group', { name: /third seat/i })).queryByTestId('seat-dealer-button')).not.toBeInTheDocument();
        });
    });

    describe('Table inactivity warning', () => {
        it('sits above the table stage instead of over the seats', () => {
            render(<GameTableView {...defaultProps} hasShellHeader isGameInactivityWarningActive />);

            const warning = screen.getByText('Table Inactivity Warning').closest('[role="status"]')!;
            const stage = screen.getByTestId('room-stage');
            expect(stage).not.toContainElement(warning as HTMLElement);
            expect(warning.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(warning).not.toHaveClass('absolute');
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

    describe('corner chrome on short landscape screens', () => {
        const cornerHeader = <header aria-label="Room Header">Friday Game</header>;

        beforeEach(() => {
            window.innerWidth = 750;
            window.innerHeight = 280;
        });

        it('overlays the header and action dock in the dead corners instead of a bar under the table', () => {
            render(<GameTableView {...defaultProps} hasShellHeader cornerHeader={cornerHeader} />);

            const layout = screen.getByTestId('corner-chrome-layout');
            expect(within(layout).getByRole('banner', { name: 'Room Header' })).toBeInTheDocument();
            expect(within(layout).getByRole('region', { name: /action dock/i })).toBeInTheDocument();
            expect(screen.queryByRole('region', { name: /room dock/i })).not.toBeInTheDocument();
            expect(screen.queryByTestId('pot-phase')).not.toBeInTheDocument();
        });

        it('keeps the bar layout when the shell has no corner header to give, and names the street in the dock', () => {
            render(<GameTableView {...defaultProps} hasShellHeader />);

            expect(screen.queryByTestId('corner-chrome-layout')).not.toBeInTheDocument();
            expect(screen.getByRole('region', { name: /room dock/i })).toBeInTheDocument();
            expect(screen.getByTestId('dock-phase')).toHaveTextContent('FLOP');
            expect(screen.queryByTestId('pot-phase')).not.toBeInTheDocument();
        });

        it('follows cornerHeader as the single layout switch regardless of window height', () => {
            window.innerWidth = 1024;
            window.innerHeight = 768;
            render(<GameTableView {...defaultProps} hasShellHeader cornerHeader={cornerHeader} />);

            expect(screen.getByTestId('corner-chrome-layout')).toBeInTheDocument();
        });

        it('freezes the table, action dock, notification banner, and inactivity warning while reconnecting, but not the header with Leave', () => {
            render(
                <RoomShellContext.Provider value={{ isContentFrozen: true }}>
                    <GameTableView
                        {...defaultProps}
                        hasShellHeader
                        cornerHeader={cornerHeader}
                        notification="Player joined"
                        notificationControls={{ onDismiss: vi.fn() }}
                        isGameInactivityWarningActive={true}
                    />
                </RoomShellContext.Provider>,
            );

            const dock = screen.getByRole('region', { name: /action dock/i });
            const frozenWrapper = dock.closest('[inert]');
            expect(frozenWrapper).not.toBeNull();
            expect(frozenWrapper).toHaveClass('isolate');
            expect(dock).toHaveClass('z-20');
            expect(screen.getByTestId('live-table-stage').closest('[inert]')).toBe(frozenWrapper);
            expect(screen.getByText('Player joined').closest('[inert]')).not.toBeNull();
            expect(screen.getByText(/table inactivity warning/i).closest('[inert]')).not.toBeNull();
            expect(screen.getByRole('banner', { name: 'Room Header' }).closest('[inert]')).toBeNull();
        });
    });
});
