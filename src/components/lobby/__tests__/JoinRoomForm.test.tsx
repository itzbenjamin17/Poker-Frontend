import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { JoinRoomForm } from '../JoinRoomForm';
import { server } from '../../../test/mocks/server';
import { pokerApi } from '../../../services/api';
import {
    BTN_JOIN,
    BTN_JOINING,
    VALIDATION_PASSWORD_CONTROL,
    formatPasswordMaxError,
} from '../../../constants/strings';
import { VALIDATION } from '../validation';
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

    it('renders optional password input and accepts user typing', async () => {
        const user = userEvent.setup();
        render(
            <JoinRoomForm
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

        await user.type(passwordInput, 'JoinSecret456');
        expect(passwordInput).toHaveValue('JoinSecret456');
    });

    it('submitting with password forwards normalized password string to pokerApi and wire request', async () => {
        const user = userEvent.setup();
        const joinRoomSpy = vi.spyOn(pokerApi, 'joinRoom');
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('/api/room/join', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    message: 'Successfully joined room',
                    data: {
                        token: 'mock-token',
                        roomId: 'JoinPasswordRoom',
                        playerName: 'Guest1',
                    },
                });
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

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'JoinPasswordRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'Guest1' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'Pass#789' } });

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        await waitFor(() => {
            expect(joinRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'JoinPasswordRoom',
                    playerName: 'Guest1',
                    password: 'Pass#789',
                }),
                expect.any(AbortSignal)
            );
            expect(mockOnAuth).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomId: 'JoinPasswordRoom',
                    playerName: 'Guest1',
                })
            );
            expect(capturedWireBody).not.toBeNull();
            expect(capturedWireBody?.password).toBe('Pass#789');
        });
    });

    it('submitting without password forwards undefined to pokerApi', async () => {
        const user = userEvent.setup();
        const joinRoomSpy = vi.spyOn(pokerApi, 'joinRoom');
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('/api/room/join', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    message: 'Successfully joined room',
                    data: {
                        token: 'mock-token',
                        roomId: 'PublicJoinRoom',
                        playerName: 'Guest2',
                    },
                });
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

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'PublicJoinRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'Guest2' } });

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        await waitFor(() => {
            expect(joinRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'PublicJoinRoom',
                    playerName: 'Guest2',
                }),
                expect.any(AbortSignal)
            );
            const callArgs = joinRoomSpy.mock.calls[0][0];
            expect(callArgs.password).toBeUndefined();
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('submitting with whitespace-only password normalizes to undefined and forwards undefined', async () => {
        const user = userEvent.setup();
        const joinRoomSpy = vi.spyOn(pokerApi, 'joinRoom');

        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'WhitespaceJoin' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'Guest3' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: '    ' } });

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        await waitFor(() => {
            expect(joinRoomSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomName: 'WhitespaceJoin',
                    playerName: 'Guest3',
                }),
                expect.any(AbortSignal)
            );
            const callArgs = joinRoomSpy.mock.calls[0][0];
            expect(callArgs.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('invalid password exceeding 50 chars displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        const joinRoomSpy = vi.spyOn(pokerApi, 'joinRoom');

        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'ValidRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'Guest' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'b'.repeat(51) } });

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith(formatPasswordMaxError(VALIDATION.password.max));
        expect(joinRoomSpy).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });

    it('invalid password with control characters displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        const joinRoomSpy = vi.spyOn(pokerApi, 'joinRoom');

        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'ValidRoom' } });
        fireEvent.change(screen.getByLabelText(/player alias/i), { target: { value: 'Guest' } });
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'ctrl\u001Fpass' } });

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith(VALIDATION_PASSWORD_CONTROL);
        expect(joinRoomSpy).not.toHaveBeenCalled();
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });
});
