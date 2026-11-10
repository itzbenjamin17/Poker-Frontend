// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, RoomState } from '../../types';
import { HOST_LEFT, LOBBY_INACTIVE_CLOSED } from '../../constants/strings';

describe('GameSession Lobby Inactivity Lifecycle & Enforcement', () => {
    const auth: AuthResponse = {
        roomId: 'room-lobby-inactivity',
        playerName: 'Hero',
        token: 'token-hero',
        message: 'Success',
    };

    function createSession(clock = new TestClock(1000), initialRoom?: RoomState) {
        const transport = new InMemoryTransportAdapter();
        const onLeave = vi.fn();
        const session = new GameSession({
            auth,
            transport,
            clock,
            onLeave,
            initialRoomState: initialRoom,
        });
        session.attach();
        session.connect();
        transport.simulateStatus('connected');
        return { session, transport, clock, onLeave };
    }

    it('schedules warning timer for 28 minutes when initial lobby deadline is 30 minutes in future', () => {
        const clock = new TestClock(1000);
        const deadline = clock.now() + 30 * 60_000;
        const initialRoom: RoomState = {
            roomId: auth.roomId,
            roomName: 'Lobby-1',
            players: [{ name: auth.playerName, isHost: true }],
            gameStarted: false,
            inactivityDeadlineEpochMs: deadline,
            serverTimeEpochMs: clock.now(),
        };

        const { session } = createSession(clock, initialRoom);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);

        // Advance 27 minutes (3 minutes remaining) -> warning still inactive
        clock.tick(27 * 60_000);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);

        // Advance 1 minute more (now 28 minutes elapsed, 2 minutes remaining) -> warning activates!
        clock.tick(60_000);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);
    });

    it('activates warning immediately if reconnecting or hydrating during final 2 minutes', () => {
        const clock = new TestClock(1000);
        // Only 90 seconds remaining until deadline
        const deadline = clock.now() + 90_000;
        const initialRoom: RoomState = {
            roomId: auth.roomId,
            roomName: 'Lobby-1',
            players: [{ name: auth.playerName, isHost: true }],
            gameStarted: false,
            inactivityDeadlineEpochMs: deadline,
            serverTimeEpochMs: clock.now(),
        };

        const { session } = createSession(clock, initialRoom);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);
    });

    it('accepted player activity (join/leave) resets deadline and dismisses active warning', () => {
        const clock = new TestClock(1000);
        // Start with only 60 seconds remaining -> warning is active
        const initialRoom: RoomState = {
            roomId: auth.roomId,
            roomName: 'Lobby-1',
            players: [{ name: auth.playerName, isHost: true }],
            gameStarted: false,
            inactivityDeadlineEpochMs: clock.now() + 60_000,
            serverTimeEpochMs: clock.now(),
        };

        const { session, transport } = createSession(clock, initialRoom);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);

        // A new player joins, extending the deadline back to 30 minutes from now
        const freshDeadline = clock.now() + 30 * 60_000;
        transport.simulateMessage(`/room/${auth.roomId}`, {
            message: 'PLAYER_JOINED',
            data: {
                roomId: auth.roomId,
                roomName: 'Lobby-1',
                players: [
                    { name: auth.playerName, isHost: true },
                    { name: 'Bob', isHost: false },
                ],
                inactivityDeadlineEpochMs: freshDeadline,
                serverTimeEpochMs: clock.now(),
            },
        });

        // Warning should be dismissed immediately
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);

        // Advance 28 minutes -> warning reappears
        clock.tick(28 * 60_000);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);
    });

    it('starting a game clears lobby inactivity warning and cancels timer', () => {
        const clock = new TestClock(1000);
        const initialRoom: RoomState = {
            roomId: auth.roomId,
            roomName: 'Lobby-1',
            players: [{ name: auth.playerName, isHost: true }],
            gameStarted: false,
            inactivityDeadlineEpochMs: clock.now() + 60_000,
            serverTimeEpochMs: clock.now(),
        };

        const { session, transport } = createSession(clock, initialRoom);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);

        // Host starts game
        transport.simulateMessage(`/room/${auth.roomId}`, {
            message: 'GAME_STARTED',
            data: {
                roomId: auth.roomId,
                roomName: 'Lobby-1',
                players: [{ name: auth.playerName, isHost: true }],
                gameStarted: true,
                inactivityDeadlineEpochMs: null,
            },
        });

        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);
        expect(session.getSnapshot().roomState?.gameStarted).toBe(true);
    });

    it('closes lobby with LOBBY_INACTIVE_CLOSED when ROOM_CLOSED arrives with reason INACTIVITY', () => {
        const clock = new TestClock(1000);
        const { session, transport, onLeave } = createSession(clock);
        session.connect();
        transport.simulateStatus('connected');

        transport.simulateMessage(`/room/${auth.roomId}`, {
            message: 'ROOM_CLOSED',
            data: {
                roomId: auth.roomId,
                reason: 'INACTIVITY',
            },
        });

        expect(session.getSnapshot().isRedirecting).toBe(true);
        expect(session.getSnapshot().roomState).toBeNull();
        expect(session.getSnapshot().notification).toBe(LOBBY_INACTIVE_CLOSED);
        expect(session.getSnapshot().loadingStatus).toBe(LOBBY_INACTIVE_CLOSED);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);

        // Advance 3s past redirect timeout
        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledWith(auth.token);
    });

    it('defaults to HOST_LEFT when ROOM_CLOSED arrives without INACTIVITY reason', () => {
        const clock = new TestClock(1000);
        const { session, transport, onLeave } = createSession(clock);
        session.connect();
        transport.simulateStatus('connected');

        transport.simulateMessage(`/room/${auth.roomId}`, {
            message: 'ROOM_CLOSED',
            data: {
                roomId: auth.roomId,
            },
        });

        expect(session.getSnapshot().isRedirecting).toBe(true);
        expect(session.getSnapshot().notification).toBe(HOST_LEFT);

        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledWith(auth.token);
    });
});
