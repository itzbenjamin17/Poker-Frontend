import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameLobbyView } from '../GameLobbyView';
import { useGameContext } from '../../context/GameContext';
import {
    BTN_LEAVE_LOBBY,
    BTN_START_GAME,
    BTN_STARTING_GAME,
    LABEL_WAITING_HOST,
} from '../../constants/strings';
import '@testing-library/jest-dom';

vi.mock('../../context/GameContext', () => ({
    useGameContext: vi.fn(),
}));

describe('GameLobbyView', () => {
    const mockOnStartGame = vi.fn();
    const mockOnLeaveGame = vi.fn();

    const baseRoomState = {
        roomId: 'room-1',
        roomName: 'HighRollers',
        host: 'HostPlayer',
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000,
        maxPlayers: 6,
        canStartGame: true,
        players: [
            { name: 'HostPlayer', isHost: true, chips: 1000 },
            { name: 'GuestPlayer', isHost: false, chips: 1000 },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders room name, blinds, buy-in, player list with host indicator', () => {
        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'HostPlayer', token: 'token', roomId: 'room-1' },
            roomState: baseRoomState,
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        render(<GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />);

        expect(screen.getByText('HighRollers')).toBeInTheDocument();
        expect(screen.getByText('$10 / $20')).toBeInTheDocument();
        expect(screen.getByText('$1,000')).toBeInTheDocument();
        expect(screen.getByText('HostPlayer')).toBeInTheDocument();
        expect(screen.getByText('GuestPlayer')).toBeInTheDocument();
        expect(screen.getByText('HOST')).toBeInTheDocument();
    });

    it('host sees Start Game button enabled when canStartGame is true and clicking invokes onStartGame', async () => {
        const user = userEvent.setup();
        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'HostPlayer', token: 'token', roomId: 'room-1' },
            roomState: baseRoomState,
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        render(<GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />);

        const startButton = screen.getByRole('button', { name: new RegExp(BTN_START_GAME, 'i') });
        expect(startButton).toBeEnabled();

        await user.click(startButton);
        expect(mockOnStartGame).toHaveBeenCalledTimes(1);
    });

    it('host sees Start Game button disabled when canStartGame is false or isStartingGame is true', () => {
        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'HostPlayer', token: 'token', roomId: 'room-1' },
            roomState: { ...baseRoomState, canStartGame: false },
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        const { rerender } = render(
            <GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />
        );

        const startButton = screen.getByRole('button', { name: new RegExp(BTN_START_GAME, 'i') });
        expect(startButton).toBeDisabled();

        rerender(
            <GameLobbyView
                onStartGame={mockOnStartGame}
                onLeaveGame={mockOnLeaveGame}
                isStartingGame={true}
            />
        );

        const startingButton = screen.getByRole('button', { name: new RegExp(BTN_STARTING_GAME, 'i') });
        expect(startingButton).toBeDisabled();
    });

    it('non-host sees waiting for host message instead of start button', () => {
        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'GuestPlayer', token: 'token', roomId: 'room-1' },
            roomState: baseRoomState,
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        render(<GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />);

        expect(screen.queryByRole('button', { name: new RegExp(BTN_START_GAME, 'i') })).not.toBeInTheDocument();
        expect(screen.getByText(LABEL_WAITING_HOST)).toBeInTheDocument();
    });

    it('clicking Leave Lobby invokes onLeaveGame after confirmation', async () => {
        const user = userEvent.setup();
        const confirmSpy = vi.spyOn(window, 'confirm');

        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'GuestPlayer', token: 'token', roomId: 'room-1' },
            roomState: baseRoomState,
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        render(<GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />);

        const leaveButton = screen.getByRole('button', { name: new RegExp(BTN_LEAVE_LOBBY, 'i') });

        // Cancel confirmation
        confirmSpy.mockReturnValueOnce(false);
        await user.click(leaveButton);
        expect(mockOnLeaveGame).not.toHaveBeenCalled();

        // Accept confirmation
        confirmSpy.mockReturnValueOnce(true);
        await user.click(leaveButton);
        expect(mockOnLeaveGame).toHaveBeenCalledTimes(1);

        confirmSpy.mockRestore();
    });

    it('copy room code button writes room name to clipboard', async () => {
        const user = userEvent.setup();
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextMock },
            configurable: true,
            writable: true,
        });

        vi.mocked(useGameContext).mockReturnValue({
            auth: { playerName: 'HostPlayer', token: 'token', roomId: 'room-1' },
            roomState: baseRoomState,
            gameState: null,
            privateState: null,
            notification: null,
            wsStatus: 'connected',
            actionPending: false,
            lastSettledChips: null,
            setNotificationWithAutoDismiss: vi.fn(),
            clearNotification: vi.fn(),
            applyIncomingGameState: vi.fn(),
            resetSessionState: vi.fn(),
            dispatch: vi.fn(),
        });

        render(<GameLobbyView onStartGame={mockOnStartGame} onLeaveGame={mockOnLeaveGame} />);

        const copyButton = screen.getByRole('button', { name: /copy room code/i });
        await user.click(copyButton);

        expect(writeTextMock).toHaveBeenCalledWith('HighRollers');
    });
});
