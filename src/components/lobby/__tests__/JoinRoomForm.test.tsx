import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { JoinRoomForm } from '../JoinRoomForm';
import { server } from '../../../test/mocks/server';
import {
    BTN_JOIN,
    BTN_JOINING,
    VALIDATION_PASSWORD_CONTROL,
    formatPasswordMaxError,
} from '../../../constants/strings';
import { VALIDATION } from '../validation';

describe('JoinRoomForm', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const mockSetLoading = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks the room password as a current password so password managers can fill it', () => {
        render(
            <JoinRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    });

    it('submitting empty room name or player name shows inline validation errors and prevents network submission', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/join', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 'tok', roomId: 'ValidRoom', playerName: 'Player1' });
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

        // Submit with whitespace-only room name
        await user.type(roomInput, '   ');
        await user.type(playerInput, 'Player1');
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Room name is required.');
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();

        // Now fill room name but whitespace player alias
        await user.clear(roomInput);
        await user.type(roomInput, 'ValidRoom');
        await user.clear(playerInput);
        await user.type(playerInput, '   ');
        await user.click(submitButton);

        expect(mockOnError).toHaveBeenCalledWith('Player alias is required.');
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
    });

    it('successful submission posts trimmed inputs over MSW and invokes onAuth', async () => {
        const user = userEvent.setup();
        let capturedBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/join', async ({ request }) => {
                capturedBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'join.jwt.token',
                    roomId: 'PokerNight',
                    playerName: 'CardShark',
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

        const roomInput = screen.getByLabelText(/room name/i);
        const playerInput = screen.getByLabelText(/player alias/i);
        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });

        await user.type(roomInput, '  PokerNight  ');
        await user.type(playerInput, '  CardShark  ');
        await user.click(submitButton);

        await waitFor(() => {
            expect(capturedBody).toMatchObject({
                roomName: 'PokerNight',
                playerName: 'CardShark',
            });
            expect(mockOnAuth).toHaveBeenCalledWith({
                token: 'join.jwt.token',
                roomId: 'PokerNight',
                playerName: 'CardShark',
            });
            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('api errors (404 and 500) are displayed to the user via onError', async () => {
        const user = userEvent.setup();
        server.use(
            http.post('*/api/room/join', () => {
                return HttpResponse.json({ detail: 'Room not found' }, { status: 404 });
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

        await user.type(screen.getByLabelText(/room name/i), 'NonExistent');
        await user.type(screen.getByLabelText(/player alias/i), 'Player');
        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Room not found');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });

        vi.clearAllMocks();
        server.use(
            http.post('*/api/room/join', () => {
                return HttpResponse.json({ detail: 'Internal server error' }, { status: 500 });
            })
        );

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Something went wrong on our end. Please try again.');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('recovers from a network failure when the user retries joining', async () => {
        const user = userEvent.setup();
        let attempt = 0;
        server.use(
            http.post('*/api/room/join', () => {
                attempt += 1;
                if (attempt === 1) {
                    return HttpResponse.error();
                }
                return HttpResponse.json({
                    token: 'retry.join.jwt',
                    roomId: 'RetryJoinRoom',
                    playerName: 'GuestRetry',
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

        await user.type(screen.getByLabelText(/room name/i), 'RetryJoinRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'GuestRetry');

        const submitButton = screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Unable to reach the server. Check your connection.');
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
        expect(mockOnAuth).not.toHaveBeenCalled();

        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                token: 'retry.join.jwt',
                roomId: 'RetryJoinRoom',
                playerName: 'GuestRetry',
            });
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

    it('submitting with password forwards password string on the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/join', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'JoinPasswordRoom',
                    playerName: 'Guest1',
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

        await user.type(screen.getByLabelText(/room name/i), 'JoinPasswordRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'Guest1');
        await user.type(screen.getByLabelText(/password \(optional\)/i), 'Pass#789');

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'JoinPasswordRoom',
                playerName: 'Guest1',
                password: 'Pass#789',
            });
            expect(mockOnAuth).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomId: 'JoinPasswordRoom',
                    playerName: 'Guest1',
                })
            );
        });
    });

    it('submitting without password omits password from the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/join', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'PublicJoinRoom',
                    playerName: 'Guest2',
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

        await user.type(screen.getByLabelText(/room name/i), 'PublicJoinRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'Guest2');

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'PublicJoinRoom',
                playerName: 'Guest2',
            });
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('submitting with whitespace-only password normalizes to undefined on the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/join', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'WhitespaceJoin',
                    playerName: 'Guest3',
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

        await user.type(screen.getByLabelText(/room name/i), 'WhitespaceJoin');
        await user.type(screen.getByLabelText(/player alias/i), 'Guest3');
        await user.type(screen.getByLabelText(/password \(optional\)/i), '    ');

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'WhitespaceJoin',
                playerName: 'Guest3',
            });
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('invalid password exceeding 50 chars displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/join', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 't', roomId: 'r', playerName: 'Guest' });
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

        await user.type(screen.getByLabelText(/room name/i), 'ValidRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'Guest');
        // Bypass native input maxLength=50 to exercise the JS validation guard directly.
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'b'.repeat(51) } });

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        expect(mockOnError).toHaveBeenCalledWith(formatPasswordMaxError(VALIDATION.password.max));
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });

    it('invalid password with control characters displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/join', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 't', roomId: 'r', playerName: 'Guest' });
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

        await user.type(screen.getByLabelText(/room name/i), 'ValidRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'Guest');
        // Programmatically inject control character since typing does not emit control characters.
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'ctrl\u001Fpass' } });

        await user.click(screen.getByRole('button', { name: new RegExp(BTN_JOIN, 'i') }));

        expect(mockOnError).toHaveBeenCalledWith(VALIDATION_PASSWORD_CONTROL);
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });
});
