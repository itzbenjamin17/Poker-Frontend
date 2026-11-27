import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { CreateRoomForm } from '../CreateRoomForm';
import { server } from '../../../test/mocks/server';
import {
    VALIDATION_PASSWORD_CONTROL,
    formatPasswordMaxError,
} from '../../../constants/strings';
import { VALIDATION } from '../validation';

describe('CreateRoomForm', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const mockSetLoading = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks the room password as a new password so saved passwords are not autofilled into it', () => {
        render(
            <CreateRoomForm
                onAuth={mockOnAuth}
                onError={mockOnError}
                loading={false}
                setLoading={mockSetLoading}
            />
        );

        expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'new-password');
    });

    it('calls onError without sending a network request when local validation fails', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/create', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 'tok', roomId: 'ABCD', playerName: 'Player1' });
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
        const smallBlindInput = screen.getByLabelText(/small blind/i);
        const bigBlindInput = screen.getByLabelText(/big blind/i);

        await user.type(roomInput, 'Test Room');
        await user.type(playerInput, 'Player1');
        await user.clear(smallBlindInput);
        await user.type(smallBlindInput, '10');
        await user.clear(bigBlindInput);
        await user.type(bigBlindInput, '15');

        await user.click(screen.getByRole('button', { name: /create game/i }));

        expect(mockOnError).toHaveBeenCalledWith('Big blind must be at least 2× the small blind.');
        expect(requestCount).toBe(0);
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
        const smallBlindInput = screen.getByLabelText(/small blind/i);
        const bigBlindInput = screen.getByLabelText(/big blind/i);
        const buyInInput = screen.getByLabelText(/buy-in/i);

        await user.type(roomInput, 'Vip High Stakes');
        await user.type(playerInput, 'CardShark');
        await user.clear(smallBlindInput);
        await user.type(smallBlindInput, '50');
        await user.clear(bigBlindInput);
        await user.type(bigBlindInput, '100');
        await user.clear(buyInInput);
        await user.type(buyInInput, '2000');

        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                token: expect.any(String),
                roomId: 'ABCD',
                playerName: 'CardShark',
            });
            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('calls onError with backend error message when room creation fails with 400 or 500', async () => {
        const user = userEvent.setup();
        server.use(
            http.post('*/api/room/create', () => {
                return HttpResponse.json({ detail: 'Room already exists' }, { status: 400 });
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

        await user.type(screen.getByLabelText(/room name/i), 'Duplicate Room');
        await user.type(screen.getByLabelText(/player alias/i), 'Alice');
        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Room already exists');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });

        vi.clearAllMocks();
        server.use(
            http.post('*/api/room/create', () => {
                return HttpResponse.json({ detail: 'Internal server error' }, { status: 500 });
            })
        );

        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Something went wrong on our end. Please try again.');
            expect(mockOnAuth).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
    });

    it('recovers cleanly when an initial network failure is followed by a successful retry', async () => {
        const user = userEvent.setup();
        let attempt = 0;
        server.use(
            http.post('*/api/room/create', () => {
                attempt += 1;
                if (attempt === 1) {
                    return HttpResponse.error();
                }
                return HttpResponse.json({
                    token: 'retry.jwt.token',
                    roomId: 'RETRY1',
                    playerName: 'Alice',
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

        await user.type(screen.getByLabelText(/room name/i), 'Retry Room');
        await user.type(screen.getByLabelText(/player alias/i), 'Alice');

        const submitButton = screen.getByRole('button', { name: /create game/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnError).toHaveBeenCalledWith('Unable to reach the server. Check your connection.');
            expect(mockSetLoading).toHaveBeenCalledWith(false);
        });
        expect(mockOnAuth).not.toHaveBeenCalled();

        await user.click(submitButton);

        await waitFor(() => {
            expect(mockOnAuth).toHaveBeenCalledWith({
                token: 'retry.jwt.token',
                roomId: 'RETRY1',
                playerName: 'Alice',
            });
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

    it('submitting with password forwards password string on the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/create', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'ROOM_PW',
                    playerName: 'HostUser',
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

        await user.type(screen.getByLabelText(/room name/i), 'SecretRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'HostUser');
        await user.type(screen.getByLabelText(/password \(optional\)/i), 'MyP@ssw0rd!');

        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'SecretRoom',
                playerName: 'HostUser',
                password: 'MyP@ssw0rd!',
            });
            expect(mockOnAuth).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomId: 'ROOM_PW',
                    playerName: 'HostUser',
                })
            );
        });
    });

    it('submitting without password omits password from the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/create', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'ROOM_NOPW',
                    playerName: 'HostUser',
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

        await user.type(screen.getByLabelText(/room name/i), 'PublicRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'HostUser');

        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'PublicRoom',
                playerName: 'HostUser',
            });
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('submitting with whitespace-only password normalizes to undefined on the wire request', async () => {
        const user = userEvent.setup();
        let capturedWireBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/room/create', async ({ request }) => {
                capturedWireBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-token',
                    roomId: 'ROOM_WS',
                    playerName: 'HostUser',
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

        await user.type(screen.getByLabelText(/room name/i), 'WhitespaceRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'HostUser');
        await user.type(screen.getByLabelText(/password \(optional\)/i), '    ');

        await user.click(screen.getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(capturedWireBody).toMatchObject({
                roomName: 'WhitespaceRoom',
                playerName: 'HostUser',
            });
            expect(capturedWireBody?.password).toBeUndefined();
            expect(mockOnAuth).toHaveBeenCalled();
        });
    });

    it('invalid password exceeding 50 chars displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/create', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 't', roomId: 'r', playerName: 'HostUser' });
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

        await user.type(screen.getByLabelText(/room name/i), 'ValidRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'HostUser');
        // Bypass native input maxLength=50 to exercise the JS validation guard directly.
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'a'.repeat(51) } });

        await user.click(screen.getByRole('button', { name: /create game/i }));

        expect(mockOnError).toHaveBeenCalledWith(formatPasswordMaxError(VALIDATION.password.max));
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });

    it('invalid password with control characters displays validation error and blocks submission', async () => {
        const user = userEvent.setup();
        let requestCount = 0;
        server.use(
            http.post('*/api/room/create', () => {
                requestCount += 1;
                return HttpResponse.json({ token: 't', roomId: 'r', playerName: 'HostUser' });
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

        await user.type(screen.getByLabelText(/room name/i), 'ValidRoom');
        await user.type(screen.getByLabelText(/player alias/i), 'HostUser');
        // Programmatically inject NUL control character since typing does not emit control characters.
        fireEvent.change(screen.getByLabelText(/password \(optional\)/i), { target: { value: 'ctrl\u0000pass' } });

        await user.click(screen.getByRole('button', { name: /create game/i }));

        expect(mockOnError).toHaveBeenCalledWith(VALIDATION_PASSWORD_CONTROL);
        expect(requestCount).toBe(0);
        expect(mockOnAuth).not.toHaveBeenCalled();
        expect(mockSetLoading).not.toHaveBeenCalled();
    });
});
