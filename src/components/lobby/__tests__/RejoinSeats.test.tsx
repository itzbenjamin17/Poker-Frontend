import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { RejoinSeats } from '../RejoinSeats';
import { server } from '../../../test/mocks/server';
import { createMockJwt } from '../../../test/fixtures';
import { loadRecentSeats, rememberSeat } from '../../../services/recentSeats';
import { REJOIN_HEADING, REJOIN_STATUS_IN_GAME, REJOIN_STATUS_WAITING } from '../../../constants/strings';
import '@testing-library/jest-dom';

const inAnHour = Math.floor(Date.now() / 1000) + 3600;
const ann = { token: createMockJwt(inAnHour + 1), roomId: 'room-1', playerName: 'Ann' };
const ben = { token: createMockJwt(inAnHour + 2), roomId: 'room-1', playerName: 'Ben' };
const cal = { token: createMockJwt(inAnHour + 3), roomId: 'room-2', playerName: 'Cal' };

/** Answers each seat's room check by its token: a status code, or the room it is still seated at. */
function serveRoomChecks(answers: Record<string, number | { roomName: string; gameStarted: boolean }>) {
    server.use(http.get('/api/room/:roomId', ({ request, params }) => {
        const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
        const answer = answers[token];
        if (answer === undefined || typeof answer === 'number') {
            return HttpResponse.json({ message: 'gone' }, { status: typeof answer === 'number' ? answer : 404 });
        }
        return HttpResponse.json({
            roomId: params.roomId, roomName: answer.roomName, maxPlayers: 6, buyIn: 1000, smallBlind: 10, bigBlind: 20,
            players: [], canStartGame: false, gameStarted: answer.gameStarted,
        });
    }));
}

describe('RejoinSeats', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('renders nothing when this browser has no remembered seats', () => {
        const { container } = render(<RejoinSeats onAuth={vi.fn()} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('offers each seat the server still holds, with whether its game has started', async () => {
        rememberSeat(ann);
        rememberSeat(cal);
        serveRoomChecks({ [ann.token]: { roomName: 'Friday Game', gameStarted: true }, [cal.token]: { roomName: 'Lunch', gameStarted: false } });

        render(<RejoinSeats onAuth={vi.fn()} />);

        const panel = await screen.findByRole('region', { name: REJOIN_HEADING });
        expect(panel).toHaveTextContent('Rejoin Friday Game as Ann');
        expect(panel).toHaveTextContent('Rejoin Lunch as Cal');
        expect(screen.getByText(REJOIN_STATUS_IN_GAME)).toBeInTheDocument();
        expect(screen.getByText(REJOIN_STATUS_WAITING)).toBeInTheDocument();
    });

    it('takes the seat only when its button is clicked', async () => {
        const user = userEvent.setup();
        const onAuth = vi.fn();
        rememberSeat(ann);
        serveRoomChecks({ [ann.token]: { roomName: 'Friday Game', gameStarted: true } });
        render(<RejoinSeats onAuth={onAuth} />);
        const button = await screen.findByRole('button', { name: /rejoin friday game as ann/i });
        expect(onAuth).not.toHaveBeenCalled();

        await user.click(button);

        expect(onAuth).toHaveBeenCalledWith(ann);
    });

    it.each([401, 403, 404, 410])('forgets a seat the server answers %i for, and does not offer it', async status => {
        rememberSeat(ann);
        rememberSeat(ben);
        serveRoomChecks({ [ann.token]: status, [ben.token]: { roomName: 'Friday Game', gameStarted: false } });

        render(<RejoinSeats onAuth={vi.fn()} />);

        await screen.findByRole('button', { name: /as ben/i });
        expect(screen.queryByRole('button', { name: /as ann/i })).not.toBeInTheDocument();
        expect(loadRecentSeats()).toEqual([ben]);
    });

    it.each([429, 500, 503])('keeps a seat it could not check (%i) for next time, without offering it now', async status => {
        rememberSeat(ann);
        serveRoomChecks({ [ann.token]: status });

        const { container } = render(<RejoinSeats onAuth={vi.fn()} />);

        await waitFor(() => expect(loadRecentSeats()).toEqual([ann]));
        expect(container).toBeEmptyDOMElement();
    });

    it('disables the buttons while a create or join request is running', async () => {
        rememberSeat(ann);
        serveRoomChecks({ [ann.token]: { roomName: 'Friday Game', gameStarted: true } });

        render(<RejoinSeats onAuth={vi.fn()} disabled />);

        expect(await screen.findByRole('button', { name: /rejoin friday game as ann/i })).toBeDisabled();
    });
});
