import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { CreateRoomForm } from '../CreateRoomForm';
import { server } from '../../../test/mocks/server';
import '@testing-library/jest-dom';

describe('CreateRoomForm', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const mockSetLoading = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls onError without calling pokerApi when local validation fails', async () => {
        const user = userEvent.setup();
        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        // Fill in room name and player alias
        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const smallBlindInput = screen.getByLabelText(/small blind/i) as HTMLInputElement;
        const bigBlindInput = screen.getByLabelText(/big blind/i) as HTMLInputElement;

        await user.type(roomInput, 'Test Room');
        await user.type(playerInput, 'Player1');

        // Set invalid blinds (big blind 15 < 2x small blind 10)
        await user.type(smallBlindInput, '10', {
            initialSelectionStart: 0,
            initialSelectionEnd: smallBlindInput.value.length,
        });
        await user.type(bigBlindInput, '15', {
            initialSelectionStart: 0,
            initialSelectionEnd: bigBlindInput.value.length,
        });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Big blind must be at least 2× the small blind.');
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });

    it('submits valid form data through MSW and invokes onAuth on success', async () => {
        const user = userEvent.setup();
        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const smallBlindInput = screen.getByLabelText(/small blind/i) as HTMLInputElement;
        const bigBlindInput = screen.getByLabelText(/big blind/i) as HTMLInputElement;
        const buyInInput = screen.getByLabelText(/buy-in/i) as HTMLInputElement;

        await user.type(roomInput, 'Vip High Stakes');
        await user.type(playerInput, 'CardShark');
        await user.type(smallBlindInput, '50', {
            initialSelectionStart: 0,
            initialSelectionEnd: smallBlindInput.value.length,
        });
        await user.type(bigBlindInput, '100', {
            initialSelectionStart: 0,
            initialSelectionEnd: bigBlindInput.value.length,
        });
        await user.type(buyInInput, '2000', {
            initialSelectionStart: 0,
            initialSelectionEnd: buyInInput.value.length,
        });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                message: 'Room created successfully',
                token: 'mock-jwt-token',
                roomId: 'ABCD',
                playerName: 'CardShark',
            });
            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('calls onError with backend error message when room creation fails', async () => {
        const user = userEvent.setup();
        server.use(
            http.post('/api/room/create', () => {
                return HttpResponse.json({ message: 'Room already exists' }, { status: 400 });
            })
        );

        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);

        await user.type(roomInput, 'Duplicate Room');
        await user.type(playerInput, 'Alice');

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Room already exists');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });
});
