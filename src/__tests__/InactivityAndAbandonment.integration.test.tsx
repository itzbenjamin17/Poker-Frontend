import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import App from '../App';
import GameView from '../GameView';
import { AUTH_KEY, HOST_LEFT, LOBBY_INACTIVE_CLOSED, LOBBY_INACTIVITY_WARNING_TITLE, TABLE_INACTIVITY_WARNING_TITLE } from '../constants/strings';
import { createValidGameState, createValidRoomData, mockAuth } from '../test/fixtures';
import { server } from '../test/mocks/server';
import { MockStompClient } from '../test/mocks/stomp';

const auth = { ...mockAuth, roomId: 'inactivity-room' };
const roomTopic = `/room/${auth.roomId}`;
const gameTopic = `/game/${auth.roomId}`;
const privateTopic = '/user/queue/private';
const storageKey = `poker-game-end:${auth.roomId}`;
const roster = [
    { name: auth.playerName, isHost: true, joinedAt: '2026-01-01T00:00:00Z' },
    { name: 'Opponent', isHost: false, joinedAt: '2026-01-01T00:00:00Z' },
];

// Only HTTP/STOMP and time are doubled: GameView, GameProvider, GameSession,
// payload decoding, controls and persistence all run their production paths.
function fixture(started = false, remainingMs = 90_000) {
    const deadline = Date.now() + remainingMs;
    const state = {
        room: createValidRoomData({ roomId: auth.roomId, players: roster, canStartGame: true, gameStarted: started, inactivityDeadlineEpochMs: deadline }),
        game: createValidGameState({
            gameId: auth.roomId, handNumber: 0, pot: 30, currentBet: 20,
            legalActions: ['CALL', 'FOLD'], inactivityDeadlineEpochMs: deadline,
            players: [
                { id: 'player-1', name: auth.playerName, chips: 990, currentBet: 10 },
                { id: 'player-2', name: 'Opponent', chips: 980, currentBet: 20 },
            ],
        }),
    };
    server.use(
        http.get(`/api/room/${auth.roomId}`, () => HttpResponse.json({ ...state.room, serverTimeEpochMs: Date.now() })),
        http.get(`/api/game/${auth.roomId}/state`, () => state.room.gameStarted
            ? HttpResponse.json({ ...state.game, serverTimeEpochMs: Date.now() }) : new HttpResponse(null, { status: 404 })),
        http.get(`/api/game/${auth.roomId}/private-state`, () => HttpResponse.json({ playerId: 'player-1', handNumber: 0, holeCards: ['AS', 'KS'] })),
    );
    return state;
}

async function connected(started = false) {
    await screen.findByRole('region', { name: started ? /poker table/i : /game lobby/i });
    await MockStompClient.waitForSubscription(privateTopic);
    // Drain initial connection/resync before changing the authoritative fixture.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
}

async function frame(topic: string, payload: unknown) {
    await act(async () => { MockStompClient.simulateMessage(topic, payload); });
}

async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function warning(title: string) {
    const status = screen.getAllByRole('status').find(node => within(node).queryByText(title));
    expect(status).toBeVisible();
    expect(status).toHaveAttribute('aria-live', 'polite');
    return status!;
}

function expectAbandonmentReview() {
    const review = screen.getByRole('region', { name: 'Game review' });
    expect(within(review).getByRole('heading', { name: 'GAME ABANDONED' })).toBeVisible();
    expect(within(review).getByText('Closed due to inactivity')).toBeVisible();
    expect(within(review).getByRole('heading', { name: 'Chips when play stopped' })).toBeVisible();
    expect(within(review).getByText('990 chips')).toBeVisible();
    expect(within(review).getByText('980 chips')).toBeVisible();
    expect(within(review).queryByText(/wins!|WINNER|Collected|Final Standings/)).not.toBeInTheDocument();
    expect(review.querySelector('.lucide-trophy')).toBeNull();
    // Public snapshots omit unrevealed holeCards ("??" is not a valid wire card).
    // Only the three community cards may appear, including after local recovery.
    expect(within(review).getAllByTestId('card')).toHaveLength(3);
    expect(within(review).getByRole('img', { name: 'Ace of Hearts' })).toBeVisible();
    expect(within(review).queryByRole('img', { name: 'Ace of Spades' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /call|fold|ready/i })).not.toBeInTheDocument();
    expect(screen.queryByText(TABLE_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
}

describe('Inactivity and abandonment UI integration (checks 12–24)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('18: refresh, reconnect, automatic progression and eliminated-player updates preserve the warning', async () => {
        const state = fixture(true);
        const first = render(<GameView auth={auth} />);
        await connected(true);
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        await advance(15_000);
        first.unmount();
        render(<GameView auth={auth} />);
        await connected(true);
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        await act(async () => { MockStompClient.simulateDisconnect(); });
        expect(await screen.findByText(/Connection lost/i)).toBeVisible();
        await act(async () => { MockStompClient.simulateConnect(); });
        await waitFor(() => expect(screen.queryByText(/Connection lost/i)).not.toBeInTheDocument());
        await advance(100);
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        state.game = { ...state.game, phase: 'FLOP', communityCards: ['AH', 'KD', 'QC'], isAutoAdvancing: true };
        await frame(gameTopic, { ...state.game, serverTimeEpochMs: Date.now() });
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        state.game = { ...state.game, players: [...state.game.players, {
            id: 'eliminated', name: 'Eliminated player', chips: 0, currentBet: 0,
            status: 'DISCONNECTED', hasFolded: true, isReadyForNextHand: false,
        }] };
        await frame(gameTopic, { ...state.game, serverTimeEpochMs: Date.now() });
        warning(TABLE_INACTIVITY_WARNING_TITLE);
    });

    it('19–21: preserves abandonment, last-state chips and privacy after cleanup and same-tab remount', async () => {
        const state = fixture(true);
        state.game = { ...state.game, phase: 'FLOP', communityCards: ['AH', 'KD', 'QC'] };
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        const first = render(<App />);
        await connected(true);
        await frame(gameTopic, { type: 'GAME_END', abandoned: true, reason: 'INACTIVITY', finalState: state.game });
        expectAbandonmentReview();
        expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({
            version: 1, roomId: auth.roomId, token: auth.token, playerName: auth.playerName,
            result: { abandoned: true, reason: 'INACTIVITY', winnerName: null,
                finalState: { pot: 30, players: [{ chips: 990 }, { chips: 980 }] } },
        });
        await advance(21_000);
        first.unmount();
        const liveRequest = vi.fn(() => new HttpResponse(null, { status: 404 }));
        server.use(
            http.get(`/api/room/${auth.roomId}`, liveRequest),
            http.get(`/api/game/${auth.roomId}/state`, liveRequest),
            http.get(`/api/game/${auth.roomId}/private-state`, liveRequest),
            http.get(`/api/game/${auth.roomId}/review`, liveRequest),
        );
        render(<App />);
        await screen.findByRole('heading', { name: 'GAME ABANDONED' });
        await advance(3000);
        expectAbandonmentReview();
        expect(liveRequest).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));
        expect(await screen.findByRole('navigation', { name: 'Main Navigation' })).toBeInTheDocument();
        expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
        expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('22: handles authoritative abandonment when turn and inactivity deadlines coincide', async () => {
        const state = fixture(true, 5000);
        state.game = { ...state.game, turnDeadlineEpochMs: state.game.inactivityDeadlineEpochMs!,
            phase: 'FLOP', communityCards: ['AH', 'KD', 'QC'] };
        render(<GameView auth={auth} />);
        await connected(true);
        await advance(5000);
        // The browser does not adjudicate expiry. The server decides which outcome wins.
        await frame(gameTopic, { type: 'GAME_END', abandoned: true, reason: 'INACTIVITY', finalState: state.game });
        expectAbandonmentReview();
        await advance(60_000);
        expectAbandonmentReview();
    });

    it('23 (client recovery): remount keeps a pending turn deadline instead of granting a fresh minute', async () => {
        const state = fixture(true);
        state.game = { ...state.game, turnDeadlineEpochMs: Date.now() + 20_000 };
        const first = render(<GameView auth={auth} />);
        await connected(true);
        expect(screen.queryByText('Warning: 10 seconds or less remaining to act.')).not.toBeInTheDocument();
        await advance(12_000);
        first.unmount();
        render(<GameView auth={auth} />);
        await connected(true);
        expect(screen.getByText('Warning: 10 seconds or less remaining to act.')).toBeInTheDocument();
        warning(TABLE_INACTIVITY_WARNING_TITLE);
    });

    it('17: CALL dismisses the table warning only after an accepted server update', async () => {
        const state = fixture(true);
        const publish = vi.spyOn(MockStompClient.prototype, 'publish');
        render(<GameView auth={auth} />);
        await connected(true);
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        fireEvent.click(screen.getByRole('button', { name: /call/i }));
        expect(publish).toHaveBeenCalledWith({ destination: `/app/${auth.roomId}/action`, body: JSON.stringify({ action: 'CALL', amount: 0 }) });
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        state.game = { ...state.game, currentPlayerId: 'player-2', currentPlayerName: 'Opponent', pot: 40, inactivityDeadlineEpochMs: Date.now() + 900_000 };
        await frame(gameTopic, { ...state.game, serverTimeEpochMs: Date.now() });
        expect(screen.queryByText(TABLE_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Total Pot')).toHaveTextContent('40');
    });

    it.each([false, true])('17: an accepted readiness change clears the warning (previously ready: %s)', async (wasReady) => {
        const state = fixture(true);
        state.game = { ...state.game, phase: 'SHOWDOWN', currentPlayerId: '', currentPlayerName: '',
            winners: ['Opponent'], isReadyCountdownActive: true, readyGateState: 'COUNTING_DOWN',
            readyCountdownDeadlineEpochMs: Date.now() + 30_000,
            players: state.game.players.map(player => ({ ...player, isReadyForNextHand: player.id === 'player-1' && wasReady })),
        };
        const publish = vi.spyOn(MockStompClient.prototype, 'publish');
        render(<GameView auth={auth} />);
        await connected(true);
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        fireEvent.click(screen.getByRole('button', { name: wasReady ? /unready/i : /^ready$/i }));
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ destination: `/app/${auth.roomId}/${wasReady ? 'unready' : 'ready'}` }));
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        state.game = { ...state.game, inactivityDeadlineEpochMs: Date.now() + 900_000,
            players: state.game.players.map(player => ({ ...player, isReadyForNextHand: player.id === 'player-1' && !wasReady })),
        };
        await frame(gameTopic, { ...state.game, serverTimeEpochMs: Date.now() });
        expect(screen.queryByText(TABLE_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: wasReady ? /^ready$/i : /unready/i })).toBeEnabled();
    });

    it('18, 24: a late action error releases the controls without extending inactivity', async () => {
        fixture(true);
        const publish = vi.spyOn(MockStompClient.prototype, 'publish');
        render(<GameView auth={auth} />);
        await connected(true);
        const call = screen.getByRole('button', { name: /call/i });
        fireEvent.click(call);
        expect(call).toBeDisabled();
        // Gameplay uses STOMP, not HTTP. Exercise the actual rejection contract.
        await frame(privateTopic, { type: 'ACTION_ERROR', code: 'TURN_EXPIRED', action: 'CALL', message: 'Action rejected: turn expired' });
        expect(screen.getByRole('alert')).toHaveTextContent('Action rejected: turn expired');
        expect(call).toBeEnabled();
        warning(TABLE_INACTIVITY_WARNING_TITLE);
        expect(screen.getByRole('region', { name: /poker table/i })).toBeVisible();
        fireEvent.click(call);
        expect(publish).toHaveBeenCalledTimes(2);
    });

    it.each(['PLAYER_JOINED', 'PLAYER_LEFT'])('13–14: %s clears the warning until the extended deadline', async (message) => {
        const state = fixture();
        render(<GameView auth={auth} />);
        await connected();
        warning(LOBBY_INACTIVITY_WARNING_TITLE);
        const players = message === 'PLAYER_JOINED' ? [...roster, { name: 'Guest', isHost: false, joinedAt: new Date().toISOString() }] : [roster[0]];
        state.room = { ...state.room, players, inactivityDeadlineEpochMs: Date.now() + 30 * 60_000 };
        await frame(roomTopic, { message, data: { ...state.room, serverTimeEpochMs: Date.now() } });
        expect(screen.queryByText(LOBBY_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        const list = screen.getByRole('list');
        if (message === 'PLAYER_JOINED') expect(within(list).getByText('Guest')).toBeVisible();
        else expect(within(list).queryByText('Opponent')).not.toBeInTheDocument();
        await advance(120_000); // Past the original deadline.
        expect(screen.getByText('GAME LOBBY')).toBeVisible();
        expect(screen.queryByText(LOBBY_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
    });

    it('14: host departure closes the room under the existing host rule', async () => {
        fixture();
        const onLeave = vi.fn();
        render(<GameView auth={auth} onLeave={onLeave} />);
        await connected();
        await frame(roomTopic, { message: 'ROOM_CLOSED', data: { roomId: auth.roomId } });
        expect(screen.getByText(HOST_LEFT)).toBeVisible();
        await advance(3000);
        expect(onLeave).toHaveBeenCalledExactlyOnceWith(auth.token);
    });

    it('15: refresh restores the warning and closure at the original server deadline', async () => {
        const state = fixture();
        const onLeave = vi.fn();
        const first = render(<GameView auth={auth} onLeave={onLeave} />);
        await connected();
        warning(LOBBY_INACTIVITY_WARNING_TITLE);
        await advance(30_000);
        first.unmount();
        render(<GameView auth={auth} onLeave={onLeave} />);
        await connected();
        warning(LOBBY_INACTIVITY_WARNING_TITLE);
        expect(screen.queryByRole('button', { name: /keep playing|extend/i })).not.toBeInTheDocument();
        await advance(state.room.inactivityDeadlineEpochMs! - Date.now());
        await frame(roomTopic, { message: 'ROOM_CLOSED', data: { reason: 'INACTIVITY' } });
        expect(screen.getByText(LOBBY_INACTIVE_CLOSED)).toBeVisible();
        await advance(3000);
        expect(onLeave).toHaveBeenCalledExactlyOnceWith(auth.token);
    });

    it('16: game start mounts the table and retires the old lobby warning', async () => {
        const state = fixture();
        const onLeave = vi.fn();
        render(<GameView auth={auth} onLeave={onLeave} />);
        await connected();
        warning(LOBBY_INACTIVITY_WARNING_TITLE);
        state.room = { ...state.room, gameStarted: true, inactivityDeadlineEpochMs: Date.now() + 900_000 };
        state.game = { ...state.game, inactivityDeadlineEpochMs: Date.now() + 900_000 };
        await frame(roomTopic, { message: 'GAME_STARTED', data: state.room });
        await screen.findByRole('region', { name: /poker table/i });
        expect(screen.queryByText(LOBBY_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        await advance(120_000);
        expect(screen.getByRole('region', { name: /poker table/i })).toBeVisible();
        expect(screen.queryByText(TABLE_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('12: warns at 28 minutes and handles server closure at 30 minutes through App', async () => {
        fixture(false, 30 * 60_000);
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        render(<App />);
        await connected();
        await advance(27 * 60_000);
        expect(screen.queryByText(LOBBY_INACTIVITY_WARNING_TITLE)).not.toBeInTheDocument();
        await advance(60_000);
        warning(LOBBY_INACTIVITY_WARNING_TITLE);
        expect(screen.queryByRole('button', { name: /keep playing|extend/i })).not.toBeInTheDocument();
        await advance(2 * 60_000);
        await frame(roomTopic, { message: 'ROOM_CLOSED', data: { roomId: auth.roomId, reason: 'INACTIVITY' } });
        expect(screen.getByText(LOBBY_INACTIVE_CLOSED)).toBeVisible();
        expect(screen.queryByText('GAME LOBBY')).not.toBeInTheDocument();
        await advance(3000);
        expect(await screen.findByRole('navigation', { name: 'Main Navigation' })).toBeInTheDocument();
        expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    });
});
