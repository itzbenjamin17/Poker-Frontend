import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameTableView } from '../GameTableView';
import { useGameContext } from '../../context/GameContext';
import { WAITING_RECONNECT_PREFIX, WAITING_RECONNECT_SUFFIX } from '../../constants/strings';
import type { GameState, RoomState, Player } from '../../types';
import '@testing-library/jest-dom';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

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
        isCompactTable: false,
        isMobileLandscape: false,
        nowMs: 100000,
        raiseAmount: '40',
        raiseError: null,
        onAction: vi.fn(),
        onReady: vi.fn(),
        onClaimWin: vi.fn(),
        onLeaveGame: vi.fn(),
        onRaiseChange: vi.fn(),
        isActionPending: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Item 18: Disconnect Overlay & Reconnect Banner', () => {
        it('renders the connection lost overlay when wsStatus is disconnected', () => {
            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: mockGameState,
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'disconnected',
            } as any);

            render(<GameTableView {...defaultProps} />);

            const alertEl = screen.getByRole('alert');
            expect(alertEl).toBeInTheDocument();
            expect(alertEl).toHaveTextContent(/connection lost/i);
            expect(alertEl).toHaveTextContent(/reconnecting/i);
        });

        it('does not render connection lost overlay when wsStatus is connected', () => {
            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: mockGameState,
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'connected',
            } as any);

            render(<GameTableView {...defaultProps} />);

            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('renders the waiting for reconnect banner when an active turn player is disconnected', () => {
            const disconnectedOpponent: Player = {
                ...opponentPlayer,
                status: 'DISCONNECTED',
            };
            const stateWithDisconnectedTurn: GameState = {
                ...mockGameState,
                currentPlayerId: 'p-2',
                players: [defaultPlayer, disconnectedOpponent],
            };

            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: stateWithDisconnectedTurn,
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'connected',
            } as any);

            render(<GameTableView {...defaultProps} isCompactTable={false} />);

            expect(screen.getByText(`${WAITING_RECONNECT_PREFIX}Villain${WAITING_RECONNECT_SUFFIX}`)).toBeInTheDocument();
        });
    });

    describe('Short-viewport chrome', () => {
        const mockContext = (phase: GameState['phase']) =>
            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: { ...mockGameState, phase },
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'connected',
            } as any);

        it('compacts only the showdown dock on short viewports', () => {
            mockContext('SHOWDOWN');
            const { unmount } = render(<GameTableView {...defaultProps} />);
            expect(screen.getByTestId('room-dock')).toHaveClass('h-28', 'short:h-12');
            unmount();

            mockContext('FLOP');
            render(<GameTableView {...defaultProps} />);
            expect(screen.getByTestId('room-dock')).toHaveClass('h-28');
            expect(screen.getByTestId('room-dock')).not.toHaveClass('short:h-12');
        });
    });

    describe('Item 19: isCompactTable scaling and layout classes', () => {
        it('applies the compact action slot height when isCompactTable is true', () => {
            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: mockGameState,
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'connected',
            } as any);

            const { container } = render(<GameTableView {...defaultProps} isCompactTable={true} />);

            // The stage itself has no padding; only the action slot density follows the flag
            // Check that action slot uses compact height 'h-24'
            const actionSlot = container.querySelector('.h-24');
            expect(actionSlot).toBeInTheDocument();
        });

        it('applies the standard action slot height when isCompactTable is false', () => {
            vi.mocked(useGameContext).mockReturnValue({
                auth: { token: 'tok', playerName: 'Hero', roomId: 'room-1' },
                roomState: mockRoomState,
                gameState: mockGameState,
                privateState: { holeCards: ['AH', 'AD'] },
                showdown: null,
                showdownResult: null,
                claimPending: false,
                myPlayerId: 'p-1',
                notification: null,
                wsStatus: 'connected',
            } as any);

            const { container } = render(<GameTableView {...defaultProps} isCompactTable={false} />);

            // Standard layout should have action slot height 'h-28'
            const actionSlot = container.querySelector('.h-28');
            expect(actionSlot).toBeInTheDocument();
        });
    });
});
