import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameLobbyView } from '../GameLobbyView';
import {
    BTN_START_GAME,
    BTN_STARTING_GAME,
    LABEL_WAITING_HOST,
} from '../../constants/strings';
import type { RoomState } from '../../types';
import '@testing-library/jest-dom';

describe('GameLobbyView', () => {
    const mockOnStartGame = vi.fn();

    const baseRoomState: RoomState = {
        roomId: 'room-1',
        roomName: 'HighRollers',
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000,
        maxPlayers: 6,
        canStartGame: true,
        gameStarted: false,
        players: [
            { name: 'HostPlayer', isHost: true },
            { name: 'GuestPlayer', isHost: false },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders room name, blinds, buy-in, player list with host indicator and semantic region', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        expect(screen.getByRole('region', { name: /game lobby/i })).toBeInTheDocument();
        expect(screen.getByText('HighRollers')).toBeInTheDocument();
        expect(screen.getByText('$10 / $20')).toBeInTheDocument();
        expect(screen.getByText('$1,000')).toBeInTheDocument();
        expect(screen.getByText('HostPlayer')).toBeInTheDocument();
        expect(screen.getByText('GuestPlayer')).toBeInTheDocument();
        expect(screen.getByLabelText('HOST')).toBeInTheDocument();
    });

    it('host sees Start Game button enabled when canStartGame is true and clicking invokes onStartGame', async () => {
        const user = userEvent.setup();

        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        const startButton = screen.getByRole('button', { name: new RegExp(BTN_START_GAME, 'i') });
        expect(startButton).toBeEnabled();

        await user.click(startButton);
        expect(mockOnStartGame).toHaveBeenCalledTimes(1);
    });

    it('host sees Start Game button disabled when canStartGame is false or isStartingGame is true', () => {
        const { rerender } = render(
            <GameLobbyView
                roomState={{ ...baseRoomState, canStartGame: false }}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        const startButton = screen.getByRole('button', { name: new RegExp(BTN_START_GAME, 'i') });
        expect(startButton).toBeDisabled();

        rerender(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
                isStartingGame={true}
            />
        );

        const startingButton = screen.getByRole('button', { name: new RegExp(BTN_STARTING_GAME, 'i') });
        expect(startingButton).toBeDisabled();
    });

    it('non-host sees waiting for host message instead of start button', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="GuestPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        expect(screen.queryByRole('button', { name: new RegExp(BTN_START_GAME, 'i') })).not.toBeInTheDocument();
        expect(screen.getByText(LABEL_WAITING_HOST)).toBeInTheDocument();
    });

    it('copy room code button writes room name to clipboard', async () => {
        const user = userEvent.setup();
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextMock },
            configurable: true,
            writable: true,
        });

        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        const copyButton = screen.getByRole('button', { name: /copy room code/i });
        await user.click(copyButton);

        expect(writeTextMock).toHaveBeenCalledWith('HighRollers');
    });
});
