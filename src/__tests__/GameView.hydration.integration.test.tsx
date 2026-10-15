import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import GameView from '../GameView';
import { GameSession } from '../domain/GameSession';
import { InMemoryTransportAdapter } from '../services/transport';
import { createValidGameState, createValidRoomData, mockAuth } from '../test/fixtures';
import { server } from '../test/mocks/server';

const failureMessage = 'Couldn’t load the table data. Please retry.';

describe('GameView initial table loading', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows an invalid initial snapshot as an error and loads the table through Retry', async () => {
        const user = userEvent.setup();
        const auth = { ...mockAuth };
        const session = new GameSession({ auth, transport: new InMemoryTransportAdapter() });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let valid = false;
        server.use(
            http.get('/api/room/:roomId', () => HttpResponse.json(createValidRoomData({ gameStarted: true }))),
            http.get('/api/game/:gameId/state', () => HttpResponse.json(createValidGameState({
                pot: valid ? 125 : 'invalid-money',
            }))),
            http.get('/api/game/:gameId/private-state', () => HttpResponse.json({ holeCards: ['AS', 'KS'] })),
        );

        const { container } = render(<GameView auth={auth} session={session} />);

        expect(await screen.findByRole('alert')).toHaveTextContent(failureMessage);
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(screen.queryByText('Connected.')).not.toBeInTheDocument();
        expect(session.getSnapshot().isHydrated).toBe(false);
        expect(warn).toHaveBeenCalledWith('Rejected public game snapshot:', {
            source: 'initial REST game snapshot', path: '$.pot',
            expected: 'nonnegative safe integer', receivedType: 'string',
        });

        valid = true;
        await user.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByLabelText('Total Pot')).toHaveTextContent('125');
        const hero = screen.getByRole('group', { name: /player 1 hero seat/i });
        expect(within(hero).getByRole('img', { name: 'Ace of Spades' })).toBeInTheDocument();
        await waitFor(() => expect(session.getSnapshot().wsStatus).toBe('connected'));
        expect(session.getSnapshot().isHydrated).toBe(true);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
        ['null', () => HttpResponse.json(null)],
        ['array', () => HttpResponse.json([])],
        ['number', () => HttpResponse.json(17)],
        ['string', () => HttpResponse.json('private-value')],
        ['invalid JSON', () => new HttpResponse('{broken', { headers: { 'Content-Type': 'application/json' } })],
        ['non-JSON response', () => HttpResponse.html('<html>private-value</html>')],
        ['empty response', () => new HttpResponse(null, { status: 204 })],
    ])('stops on a successful HTTP %s response, including when Retry also fails', async (receivedType, response) => {
        const user = userEvent.setup();
        const auth = { ...mockAuth };
        const session = new GameSession({ auth, transport: new InMemoryTransportAdapter() });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        server.use(
            http.get('/api/room/:roomId', () => HttpResponse.json(createValidRoomData({ gameStarted: true }))),
            http.get('/api/game/:gameId/state', response),
        );
        render(<GameView auth={auth} session={session} />);

        expect(await screen.findByRole('alert')).toHaveTextContent(failureMessage);
        expect(warn).toHaveBeenCalledWith('Rejected public game snapshot:', {
            source: 'initial REST game snapshot', path: '$', expected: 'object', receivedType,
        });
        expect(JSON.stringify(warn.mock.calls)).not.toContain('private-value');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(failureMessage);
        expect(session.getSnapshot().isHydrated).toBe(false);
        expect(session.getSnapshot().gameState).toBeNull();
    });

    it('opens an already accepted table when the next initial snapshot is rejected', async () => {
        const auth = { ...mockAuth };
        const session = new GameSession({
            auth, transport: new InMemoryTransportAdapter(),
            initialGameState: createValidGameState({ pot: 350 }),
        });
        const accepted = session.getSnapshot().gameState;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        server.use(
            http.get('/api/room/:roomId', () => HttpResponse.json(createValidRoomData({ gameStarted: true }))),
            http.get('/api/game/:gameId/state', () => HttpResponse.json(null)),
            http.get('/api/game/:gameId/private-state', () => HttpResponse.json({ holeCards: [] })),
        );
        render(<GameView auth={auth} session={session} />);

        expect(await screen.findByLabelText('Total Pot')).toHaveTextContent('350');
        expect(session.getSnapshot().gameState).toBe(accepted);
        expect(session.getSnapshot().isHydrated).toBe(true);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
