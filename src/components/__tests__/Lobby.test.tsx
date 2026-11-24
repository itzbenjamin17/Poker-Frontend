import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import Lobby from '../../Lobby';
import { server } from '../../test/mocks/server';
import { http, HttpResponse } from 'msw';
import { createMockJwt } from '../../test/fixtures';
import { rememberSeat } from '../../services/recentSeats';
import '@testing-library/jest-dom';

describe('Lobby Component Password Fields', () => {
    it('renders labelled optional password inputs on both Create and Join forms', () => {
        render(<Lobby onAuth={vi.fn()} />);

        const createRegion = screen.getByRole('region', { name: /create table/i });
        const createPasswordInput = within(createRegion).getByLabelText(/password/i);
        expect(createPasswordInput).toBeInTheDocument();
        expect(createPasswordInput).toHaveAttribute('type', 'password');
        expect(createPasswordInput).toHaveAttribute('maxlength', '50');

        const joinRegion = screen.getByRole('region', { name: /quick join/i });
        const joinPasswordInput = within(joinRegion).getByLabelText(/password/i);
        expect(joinPasswordInput).toBeInTheDocument();
        expect(joinPasswordInput).toHaveAttribute('type', 'password');
        expect(joinPasswordInput).toHaveAttribute('maxlength', '50');
    });

    it('disables password inputs when create request is pending', async () => {
        const user = userEvent.setup();
        let resolveCreate!: () => void;
        server.use(
            http.post('/api/room/create', async () => {
                await new Promise<void>((resolve) => { resolveCreate = resolve; });
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Host',
                    roomId: 'ABCD',
                });
            })
        );

        render(<Lobby onAuth={vi.fn()} />);
        const createRegion = screen.getByRole('region', { name: /create table/i });
        const joinRegion = screen.getByRole('region', { name: /quick join/i });

        fireEvent.change(within(createRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(createRegion).getByLabelText(/player alias/i), { target: { value: 'Host' } });

        const createPasswordInput = within(createRegion).getByLabelText(/password/i);
        const joinPasswordInput = within(joinRegion).getByLabelText(/password/i);

        expect(createPasswordInput).not.toBeDisabled();
        expect(joinPasswordInput).not.toBeDisabled();

        await user.click(within(createRegion).getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(createPasswordInput).toBeDisabled();
            expect(joinPasswordInput).toBeDisabled();
        });

        resolveCreate();
    });

    it('disables password inputs when join request is pending', async () => {
        const user = userEvent.setup();
        let resolveJoin!: () => void;
        server.use(
            http.post('/api/room/join', async () => {
                await new Promise<void>((resolve) => { resolveJoin = resolve; });
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Player',
                    roomId: 'ABCD',
                });
            })
        );

        render(<Lobby onAuth={vi.fn()} />);
        const createRegion = screen.getByRole('region', { name: /create table/i });
        const joinRegion = screen.getByRole('region', { name: /quick join/i });

        fireEvent.change(within(joinRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(joinRegion).getByLabelText(/player alias/i), { target: { value: 'Player' } });

        const createPasswordInput = within(createRegion).getByLabelText(/password/i);
        const joinPasswordInput = within(joinRegion).getByLabelText(/password/i);

        expect(createPasswordInput).not.toBeDisabled();
        expect(joinPasswordInput).not.toBeDisabled();

        await user.click(within(joinRegion).getByRole('button', { name: /join game/i }));

        await waitFor(() => {
            expect(createPasswordInput).toBeDisabled();
            expect(joinPasswordInput).toBeDisabled();
        });

        resolveJoin();
    });

    it('submits create room with entered password preserved', async () => {
        const user = userEvent.setup();
        const handleAuth = vi.fn();
        let submittedPayload: Record<string, unknown> | null = null;

        server.use(
            http.post('/api/room/create', async ({ request }) => {
                submittedPayload = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Host',
                    roomId: 'ABCD',
                });
            })
        );

        render(<Lobby onAuth={handleAuth} />);
        const createRegion = screen.getByRole('region', { name: /create table/i });

        fireEvent.change(within(createRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(createRegion).getByLabelText(/player alias/i), { target: { value: 'Host' } });
        fireEvent.change(within(createRegion).getByLabelText(/password/i), { target: { value: '  p@ssw0rd!  ' } });

        await user.click(within(createRegion).getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(submittedPayload).toEqual(expect.objectContaining({
                roomName: 'Room 1',
                playerName: 'Host',
                password: '  p@ssw0rd!  ',
            }));
            expect(handleAuth).toHaveBeenCalled();
        });
    });

    it('submits create room without password when password field is whitespace-only', async () => {
        const user = userEvent.setup();
        let submittedPayload: Record<string, unknown> | null = null;

        server.use(
            http.post('/api/room/create', async ({ request }) => {
                submittedPayload = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Host',
                    roomId: 'ABCD',
                });
            })
        );

        render(<Lobby onAuth={vi.fn()} />);
        const createRegion = screen.getByRole('region', { name: /create table/i });

        fireEvent.change(within(createRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(createRegion).getByLabelText(/player alias/i), { target: { value: 'Host' } });
        fireEvent.change(within(createRegion).getByLabelText(/password/i), { target: { value: '   ' } });

        await user.click(within(createRegion).getByRole('button', { name: /create game/i }));

        await waitFor(() => {
            expect(submittedPayload).not.toBeNull();
            expect(submittedPayload).not.toHaveProperty('password');
        });
    });

    it('submits join room with entered password preserved', async () => {
        const user = userEvent.setup();
        const handleAuth = vi.fn();
        let submittedPayload: Record<string, unknown> | null = null;

        server.use(
            http.post('/api/room/join', async ({ request }) => {
                submittedPayload = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Player',
                    roomId: 'Room 1',
                });
            })
        );

        render(<Lobby onAuth={handleAuth} />);
        const joinRegion = screen.getByRole('region', { name: /quick join/i });

        fireEvent.change(within(joinRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(joinRegion).getByLabelText(/player alias/i), { target: { value: 'Player' } });
        fireEvent.change(within(joinRegion).getByLabelText(/password/i), { target: { value: '  joinPass!  ' } });

        await user.click(within(joinRegion).getByRole('button', { name: /join game/i }));

        await waitFor(() => {
            expect(submittedPayload).toEqual(expect.objectContaining({
                roomName: 'Room 1',
                playerName: 'Player',
                password: '  joinPass!  ',
            }));
            expect(handleAuth).toHaveBeenCalled();
        });
    });

    it('submits join room without password when password field is blank', async () => {
        const user = userEvent.setup();
        let submittedPayload: Record<string, unknown> | null = null;

        server.use(
            http.post('/api/room/join', async ({ request }) => {
                submittedPayload = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    token: 'mock-jwt',
                    playerName: 'Player',
                    roomId: 'Room 1',
                });
            })
        );

        render(<Lobby onAuth={vi.fn()} />);
        const joinRegion = screen.getByRole('region', { name: /quick join/i });

        fireEvent.change(within(joinRegion).getByLabelText(/room name/i), { target: { value: 'Room 1' } });
        fireEvent.change(within(joinRegion).getByLabelText(/player alias/i), { target: { value: 'Player' } });

        await user.click(within(joinRegion).getByRole('button', { name: /join game/i }));

        await waitFor(() => {
            expect(submittedPayload).not.toBeNull();
            expect(submittedPayload).not.toHaveProperty('password');
        });
    });

    it('displays server error message when joining fails due to incorrect password', async () => {
        const user = userEvent.setup();
        server.use(
            http.post('/api/room/join', () => {
                return HttpResponse.json(
                    { detail: 'Incorrect room password' },
                    { status: 403 }
                );
            })
        );

        render(<Lobby onAuth={vi.fn()} />);
        const joinRegion = screen.getByRole('region', { name: /quick join/i });

        fireEvent.change(within(joinRegion).getByLabelText(/room name/i), { target: { value: 'LockedRoom' } });
        fireEvent.change(within(joinRegion).getByLabelText(/player alias/i), { target: { value: 'Player' } });
        fireEvent.change(within(joinRegion).getByLabelText(/password/i), { target: { value: 'wrongpass' } });

        await user.click(within(joinRegion).getByRole('button', { name: /join game/i }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Incorrect room password');
        });
    });

    describe('Rejoin coordination', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('disables Create and Quick Join forms while Rejoin click check is in flight and surfaces stale-room alert', async () => {
            const user = userEvent.setup();
            const seat = { token: createMockJwt(Math.floor(Date.now() / 1000) + 3600), roomId: 'room-1', playerName: 'Ann' };
            rememberSeat(seat);
            let checks = 0;
            let resolveSecondCheck!: () => void;
            server.use(
                http.get('/api/room/:roomId', async ({ params }) => {
                    checks += 1;
                    if (checks === 1) {
                        return HttpResponse.json({
                            roomId: params.roomId, roomName: 'Friday Game', maxPlayers: 6, buyIn: 1000,
                            smallBlind: 10, bigBlind: 20, players: [], canStartGame: false, gameStarted: false, gameFinished: false,
                        });
                    }
                    await new Promise<void>(resolve => { resolveSecondCheck = resolve; });
                    return HttpResponse.json({ detail: 'Room not found' }, { status: 404 });
                })
            );

            render(<Lobby onAuth={vi.fn()} />);
            const rejoinButton = await screen.findByRole('button', { name: /rejoin friday game as ann/i });
            const createRegion = screen.getByRole('region', { name: /create table/i });
            const joinRegion = screen.getByRole('region', { name: /quick join/i });

            await user.click(rejoinButton);

            await waitFor(() => {
                expect(within(createRegion).getByRole('button', { name: /create game/i })).toBeDisabled();
                expect(within(joinRegion).getByRole('button', { name: /join game/i })).toBeDisabled();
                expect(rejoinButton).toBeDisabled();
            });

            resolveSecondCheck();

            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent('This room is no longer available.');
                expect(within(createRegion).getByRole('button', { name: /create game/i })).toBeEnabled();
                expect(within(joinRegion).getByRole('button', { name: /join game/i })).toBeEnabled();
            });
        });

        it('renders lobby inside a main landmark with h1 before Your seats and form h2 headings', async () => {
            const seat = { token: createMockJwt(Math.floor(Date.now() / 1000) + 3600), roomId: 'room-1', playerName: 'Ann' };
            rememberSeat(seat);
            server.use(
                http.get('/api/room/:roomId', ({ params }) => HttpResponse.json({
                    roomId: params.roomId, roomName: 'Friday Game', maxPlayers: 6, buyIn: 1000,
                    smallBlind: 10, bigBlind: 20, players: [], canStartGame: false, gameStarted: false, gameFinished: false,
                }))
            );

            render(<Lobby onAuth={vi.fn()} />);
            await screen.findByRole('button', { name: /rejoin friday game as ann/i });

            const main = screen.getByRole('main');
            const headings = within(main).getAllByRole('heading');
            expect(headings.map(h => `${h.tagName}:${h.textContent?.trim()}`)).toEqual([
                expect.stringMatching(/^H1:PLAY POKER/),
                'H2:Your seats',
                'H2:Create Game',
                'H2:Quick Join',
            ]);
        });
    });
});
