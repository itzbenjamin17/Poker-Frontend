import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

        fireEvent.change(roomInput, { target: { value: 'Test Room' } });
        fireEvent.change(playerInput, { target: { value: 'Player1' } });
        fireEvent.change(smallBlindInput, { target: { value: '10' } });
        fireEvent.change(bigBlindInput, { target: { value: '15' } });

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

        fireEvent.change(roomInput, { target: { value: 'Vip High Stakes' } });
        fireEvent.change(playerInput, { target: { value: 'CardShark' } });
        fireEvent.change(smallBlindInput, { target: { value: '50' } });
        fireEvent.change(bigBlindInput, { target: { value: '100' } });
        fireEvent.change(buyInInput, { target: { value: '2000' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                message: 'Room created successfully',
                token: expect.any(String),
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

        fireEvent.change(roomInput, { target: { value: 'Duplicate Room' } });
        fireEvent.change(playerInput, { target: { value: 'Alice' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Room already exists');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });
});
