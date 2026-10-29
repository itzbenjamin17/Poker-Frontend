import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { CreateRoomForm } from '../CreateRoomForm';
import { server } from '../../../test/mocks/server';
import { pokerApi } from '../../../services/api';
import {
    VALIDATION_PASSWORD_CONTROL,
    formatPasswordMaxError,
} from '../../../constants/strings';
import { VALIDATION } from '../validation';
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

    it('renders optional password input and accepts user typing', async () => {
        const user = userEvent.setup();
        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        const passwordInput = screen.getByLabelText(/password \(optional\)/i);
        expect(passwordInput).toBeInTheDocument();
        expect(passwordInput).toHaveAttribute('type', 'password');
        expect(passwordInput).toHaveAttribute('placeholder', 'Enter Room Password (Optional)');
        expect(passwordInput).toHaveAttribute('maxLength', String(VALIDATION.password.max));

        await user.type(passwordInput, 'Secret123');
        expect(passwordInput).toHaveValue('Secret123');
    });

    it('submitting with password forwards normalized password string to pokerApi and wire request', async () => {
        const user = userEvent.setup();
        const createRoomSpy = vi.spyOn(pokerApi, 'createRoom');
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('/api/room/create', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    message: 'Room created successfully',
                    data: {
                        token: 'mock-token',
                        roomId: 'ROOM_PW',
                        playerName: 'HostUser',
                    },
                });
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

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'SecretRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'HostUser' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'MyP@ssw0rd!' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(createRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'SecretRoom',
                    playerName: 'HostUser',
                    password: 'MyP@ssw0rd!',
                }),
                expect.any(AbortSignal)
            );
            expect(mockOnAuth).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomId: 'ROOM_PW',
                    playerName: 'HostUser',
                })
            );
            expect(capturedWireBody).not.toBeNull();
            expect(capturedWireBody?.password).toBe('MyP@ssw0rd!');
        });
    });

    it('submitting without password forwards undefined to pokerApi', async () => {
        const user = userEvent.setup();
        const createRoomSpy = vi.spyOn(pokerApi, 'createRoom');
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('/api/room/create', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    message: 'Room created successfully',
                    data: {
                        token: 'mock-token',
                        roomId: 'ROOM_NOPW',
                        playerName: 'HostUser',
                    },
                });
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

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'PublicRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'HostUser' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(createRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'PublicRoom',
                    playerName: 'HostUser',
                }),
                expect.any(AbortSignal)
            );
            const callArgs = createRoomSpy.mock.calls[0][0];
            expect(callArgs.password).toBeUndefined();
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('submitting with whitespace-only password normalizes to undefined and forwards undefined', async () => {
        const user = userEvent.setup();
        const createRoomSpy = vi.spyOn(pokerApi, 'createRoom');

        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'WhitespaceRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'HostUser' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: '    ' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(createRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'WhitespaceRoom',
                    playerName: 'HostUser',
                }),
                expect.any(AbortSignal)
            );
            const callArgs = createRoomSpy.mock.calls[0][0];
            expect(callArgs.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('invalid password exceeding 50 chars displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        const createRoomSpy = vi.spyOn(pokerApi, 'createRoom');

        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'ValidRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'HostUser' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'a'.repeat(51) } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith(formatPasswordMaxError(VALIDATION.password.max));
        expect(createRoomSpy).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });

    it('invalid password with control characters displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        const createRoomSpy = vi.spyOn(pokerApi, 'createRoom');

        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'ValidRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'HostUser' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'ctrl\u0000pass' } });

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith(VALIDATION_PASSWORD_CONTROL);
        expect(createRoomSpy).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });
});
