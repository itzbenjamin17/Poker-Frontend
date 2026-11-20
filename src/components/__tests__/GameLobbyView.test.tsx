import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameLobbyView } from '../GameLobbyView';
import {
    BTN_START_GAME,
    BTN_STARTING_GAME,
    LABEL_WAITING_HOST,
    LABEL_INACTIVITY_LIMIT,
    VALUE_INACTIVITY_LIMIT,
    LOBBY_TIMING_RULE_DESC,
    LABEL_TURN_TIME_EXPLANATION,
    LOBBY_INACTIVITY_WARNING_TITLE,
    LOBBY_INACTIVITY_WARNING_MESSAGE,
    ERROR_COPY_ROOM_CODE,
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
        expect(await screen.findByText(/copied/i)).toBeInTheDocument();
    });

    describe('copy room code feedback', () => {
        function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText },
                configurable: true,
                writable: true,
            });
        }

        function renderLobby() {
            return render(
                <GameLobbyView
                    roomState={baseRoomState}
                    playerName="HostPlayer"
                    onStartGame={mockOnStartGame}
                />
            );
        }

        it('names the copy button with its visible room code', () => {
            renderLobby();
            expect(screen.getByRole('button', { name: /copy room code/i })).toHaveAccessibleName(/HighRollers/);
        });

        it('announces a successful copy in a status region', async () => {
            const user = userEvent.setup();
            mockClipboard(vi.fn().mockResolvedValue(undefined));
            renderLobby();

            await user.click(screen.getByRole('button', { name: /copy room code/i }));

            await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/copied/i));
        });

        it('announces a failed copy in the same status region, not a separate alert', async () => {
            const user = userEvent.setup();
            mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
            renderLobby();

            await user.click(screen.getByRole('button', { name: /copy room code/i }));

            await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ERROR_COPY_ROOM_CODE));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('makes a repeated message differ so VoiceOver announces it again', async () => {
            const user = userEvent.setup();
            mockClipboard(vi.fn().mockResolvedValue(undefined));
            renderLobby();
            const button = screen.getByRole('button', { name: /copy room code/i });

            await user.click(button);
            await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'));

            await user.click(button);
            await waitFor(() => expect(screen.getByRole('status').textContent).toBe(`Copied${String.fromCharCode(0xa0)}`));
        });

        it('clears the feedback after a short delay', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            try {
                const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
                mockClipboard(vi.fn().mockResolvedValue(undefined));
                renderLobby();

                await user.click(screen.getByRole('button', { name: /copy room code/i }));
                await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/copied/i));

                await act(async () => { vi.advanceTimersByTime(2500); });
                expect(screen.getByRole('status').textContent).toBe('');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    it('explains the 60s turn deadline rule in table rules', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        expect(screen.getByText('Turn Time')).toBeInTheDocument();
        expect(screen.getByText('60s')).toBeInTheDocument();
        expect(screen.getByText(LABEL_TURN_TIME_EXPLANATION)).toBeInTheDocument();
    });

    it('renders the fixed 30-minute lobby timing rule under table rules', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
            />
        );

        expect(screen.getByText(LABEL_INACTIVITY_LIMIT)).toBeInTheDocument();
        expect(screen.getByText(VALUE_INACTIVITY_LIMIT)).toBeInTheDocument();
        expect(screen.getByText(LOBBY_TIMING_RULE_DESC)).toBeInTheDocument();
    });

    it('renders accessible warning banner without extension button when isLobbyInactivityWarningActive is true', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
                isLobbyInactivityWarningActive={true}
            />
        );

        // Named, because the copy-feedback live region is also a status.
        const statusBanner = screen.getByRole('status', { name: LOBBY_INACTIVITY_WARNING_TITLE });
        expect(statusBanner).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByText(LOBBY_INACTIVITY_WARNING_TITLE)).toBeInTheDocument();
        expect(screen.getByText(LOBBY_INACTIVITY_WARNING_MESSAGE)).toBeInTheDocument();

        // Verify there is no extension button or control
        expect(screen.queryByRole('button', { name: /extend|keep playing|more time/i })).not.toBeInTheDocument();
    });

    it('does not render warning banner when isLobbyInactivityWarningActive is false', () => {
        render(
            <GameLobbyView
                roomState={baseRoomState}
                playerName="HostPlayer"
                onStartGame={mockOnStartGame}
                isLobbyInactivityWarningActive={false}
            />
        );

        expect(screen.queryByRole('status', { name: LOBBY_INACTIVITY_WARNING_TITLE })).not.toBeInTheDocument();
        expect(screen.queryByText(LOBBY_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
    });
});
