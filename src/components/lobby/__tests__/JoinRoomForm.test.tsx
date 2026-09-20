import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JoinRoomForm } from '../JoinRoomForm';
import { pokerApi } from '../../../services/api';
import { BTN_JOIN, BTN_JOINING } from '../../../constants/strings';
import '@testing-library/jest-dom';

vi.mock('../../../services/api', () => ({
    pokerApi: {
        joinRoom: vi.fn(),
    },
}));

describe('JoinRoomForm', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const mockSetLoading = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('submitting empty room name or player name shows inline validation errors and prevents submission', async () => {
        const user = userEvent.setup();
        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });

        // Submit with whitespace-only room name
        await user.type(roomInput, '   ');
        await user.type(playerInput, 'Player1');
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Room name is required.');
        expect(pokerApi.joinRoom).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();

        // Now fill room name but whitespace player alias
        await user.clear(roomInput);
        await user.type(roomInput, 'ValidRoom');
        await user.clear(playerInput);
        await user.type(playerInput, '   ');
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Player alias is required.');
        expect(pokerApi.joinRoom).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();
    });

    it('successful submission calls pokerApi.joinRoom with trimmed inputs and invokes onAuth', async () => {
        const user = userEvent.setup();
        const fakeAuthResponse = {
            token: 'test-jwt-token',
            playerName: 'CardShark',
            roomId: 'room-xyz',
        };
        vi.mocked(pokerApi.joinRoom).mockResolvedValueOnce(fakeAuthResponse);

        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });

        await user.type(roomInput, '  PokerNight  ');
        await user.type(playerInput, '  CardShark  ');
        await user.click(submitButton);

        await waitFor(() => {
            expect(pokerApi.joinRoom).toHaveBeenCalledWith({
                roomName: 'PokerNight',
                playerName: 'CardShark',
            });
            expect(mockOnAuth).toHaveBeenCalledWith(fakeAuthResponse);
            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('api errors are displayed to the user via onError', async () => {
        const user = userEvent.setup();
        vi.mocked(pokerApi.joinRoom).mockRejectedValueOnce(new Error('Room not found'));

        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });

        await user.type(roomInput, 'NonExistent');
        await user.type(playerInput, 'Player');
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Room not found');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('loading state disables button and shows loading text', () => {
        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={true}
                setLoading={mockSetLoading}
            />
        );

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOINING, 'i') });
        expect(submitButton).toBeDisabled();
    });
});
