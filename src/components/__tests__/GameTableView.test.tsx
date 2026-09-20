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
        id: 'room-1',
        roomName: 'High Roller Room',
        players: [defaultPlayer, opponentPlayer],
        hostPlayerName: 'Hero',
        gameStarted: true,
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000,
    };

    const mockGameState: GameState = {
        id: 'game-1',
        gameId: 'game-1',
        roomId: 'room-1',
        handNumber: 1,
        phase: 'FLOP',
        pot: 100,
        communityCards: ['AS', 'KH', '2D'],
        currentTurnPlayerId: 'p-1',
        currentPlayerId: 'p-1',
        isHandInProgress: true,
        players: [defaultPlayer, opponentPlayer],
    };

    const defaultProps = {
        tableTier: 'standard' as const,
        isCompactTable: false,
        isMobileLandscape: false,
        scale: 1,
        nowMs: 100000,
        raiseAmount: '40',
        raiseError: null,
        getSeatPosition: () => ({ left: 50, top: 50, cardPlacement: 'below' as const }),
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
                currentTurnPlayerId: 'p-2',
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

    describe('Item 19: isCompactTable scaling and layout classes', () => {
        it('applies compact padding classes when isCompactTable is true', () => {
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

            // Check that compact padding 'p-2' is applied to the table container area
            const tableArea = container.querySelector('.p-2');
            expect(tableArea).toBeInTheDocument();

            // Check that action slot uses compact height 'h-24'
            const actionSlot = container.querySelector('.h-24');
            expect(actionSlot).toBeInTheDocument();
        });

        it('applies standard padding and height classes when isCompactTable is false', () => {
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
