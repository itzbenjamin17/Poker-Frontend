import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { JoinRoomForm } from '../JoinRoomForm';
import { server } from '../../../test/mocks/server';
import { BTN_JOIN, BTN_JOINING } from '../../../constants/strings';
import '@testing-library/jest-dom';

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
        fireEvent.change(roomInput, { target: { value: '   ' } });
        fireEvent.change(playerInput, { target: { value: 'Player1' } });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Room name is required.');
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();

        // Now fill room name but whitespace player alias
        fireEvent.change(roomInput, { target: { value: 'ValidRoom' } });
        fireEvent.change(playerInput, { target: { value: '   ' } });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Player alias is required.');
        expect(mockOnAuth).not.toHaveBeenCalled();
    });

    it('successful submission calls pokerApi.joinRoom with trimmed inputs and invokes onAuth', async () => {
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

        fireEvent.change(roomInput, { target: { value: '  PokerNight  ' } });
        fireEvent.change(playerInput, { target: { value: '  CardShark  ' } });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                message: 'Successfully joined room',
                token: expect.any(String),
                roomId: 'PokerNight',
                playerName: 'CardShark',
            });
            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('api errors are displayed to the user via onError', async () => {
        const user = userEvent.setup();
        server.use(
            http.post('/api/room/join', () => {
                return HttpResponse.json({ message: 'Room not found' }, { status: 404 });
            })
        );

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

        fireEvent.change(roomInput, { target: { value: 'NonExistent' } });
        fireEvent.change(playerInput, { target: { value: 'Player' } });
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
