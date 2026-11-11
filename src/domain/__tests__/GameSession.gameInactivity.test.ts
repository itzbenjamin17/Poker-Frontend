// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, GameState, RoomState } from '../../types';

describe('GameSession Active Game Inactivity Lifecycle & Enforcement', () => {
    const auth: AuthResponse = {
        roomId: 'room-game-inactivity',
        playerName: 'Hero',
        token: 'token-hero',
        message: 'Success',
    };

    const baseGameState: GameState = {
        gameId: auth.roomId,
        phase: 'PRE_FLOP',
        pot: 30,
        currentBet: 20,
        maxPlayers: 4,
        currentPlayerId: 'p-hero',
        currentPlayerName: 'Hero',
        communityCards: [],
        players: [
            { id: 'p-hero', name: 'Hero', chips: 990, status: 'ACTIVE', currentBet: 10, hasFolded: false, isReadyForNextHand: false },
            { id: 'p-bob', name: 'Bob', chips: 980, status: 'ACTIVE', currentBet: 20, hasFolded: false, isReadyForNextHand: false },
        ],
    };

    function createSession(clock = new TestClock(1000), initialRoom?: RoomState, initialGame?: GameState) {
        const transport = new InMemoryTransportAdapter();
        const onLeave = vi.fn();
        const session = new GameSession({
            auth,
            transport,
            clock,
            onLeave,
            initialRoomState: initialRoom,
            initialGameState: initialGame,
        });
        session.attach();
        session.connect();
        transport.simulateStatus('connected');
        return { session, transport, clock, onLeave };
    }

    it('schedules warning timer for 13 minutes when initial game deadline is 15 minutes in future', () => {
        const clock = new TestClock(1000);
        const deadline = clock.now() + 15 * 60_000;
        const initialGame: GameState = {
            ...baseGameState,
            inactivityDeadlineEpochMs: deadline,
            serverTimeEpochMs: clock.now(),
        };

        const { session } = createSession(clock, undefined, initialGame);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);

        // Advance 12 minutes (3 minutes remaining) -> warning still inactive
        clock.tick(12 * 60_000);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);

        // Advance 1 minute more (now 13 minutes elapsed, 2 minutes remaining) -> warning activates!
        clock.tick(60_000);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(true);
    });

    it('activates warning immediately if reconnecting or hydrating during final 2 minutes', () => {
        const clock = new TestClock(1000);
        // Only 90 seconds remaining until deadline
        const deadline = clock.now() + 90_000;
        const initialGame: GameState = {
            ...baseGameState,
            inactivityDeadlineEpochMs: deadline,
            serverTimeEpochMs: clock.now(),
        };

        const { session } = createSession(clock, undefined, initialGame);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(true);
    });

    it('accepted player action resets deadline and dismisses active warning', () => {
        const clock = new TestClock(1000);
        // Start with only 60 seconds remaining -> warning is active
        const initialGame: GameState = {
            ...baseGameState,
            inactivityDeadlineEpochMs: clock.now() + 60_000,
            serverTimeEpochMs: clock.now(),
        };

        const { session } = createSession(clock, undefined, initialGame);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(true);

        // An action is accepted, extending the active-game deadline back to 15 minutes from now
        const freshDeadline = clock.now() + 15 * 60_000;
        session.applyGameState({
            ...baseGameState,
            inactivityDeadlineEpochMs: freshDeadline,
            serverTimeEpochMs: clock.now(),
        });

        // Warning must be dismissed immediately upon valid reset
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);

        // Advance 12 minutes -> still inactive
        clock.tick(12 * 60_000);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);

        // Advance 1 minute (13 min total) -> warning reactivates
        clock.tick(60_000);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(true);
    });

    it('game start retires lobby inactivity timer and installs active game deadline', () => {
        const clock = new TestClock(1000);
        const lobbyDeadline = clock.now() + 60_000; // 1 min remaining in lobby -> warning would be active
        const initialRoom: RoomState = {
            roomId: auth.roomId,
            roomName: 'Lobby',
            players: [{ name: auth.playerName, isHost: true }],
            gameStarted: false,
            inactivityDeadlineEpochMs: lobbyDeadline,
            serverTimeEpochMs: clock.now(),
        };

        const { session, transport } = createSession(clock, initialRoom);
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(true);

        // Game starts with 15m active game deadline
        const gameDeadline = clock.now() + 15 * 60_000;
        transport.simulateMessage(`/room/${auth.roomId}`, {
            message: 'GAME_STARTED',
            data: {
                roomId: auth.roomId,
                gameStarted: true,
                inactivityDeadlineEpochMs: gameDeadline,
                players: [{ name: auth.playerName, isHost: true }],
            },
        });

        // Lobby warning is dismissed and game warning is not yet active
        expect(session.getSnapshot().isLobbyInactivityWarningActive).toBe(false);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);
    });

    it('terminal abandonment installs abandonment review and clears timers', () => {
        const clock = new TestClock(1000);
        const initialGame: GameState = {
            ...baseGameState,
            inactivityDeadlineEpochMs: clock.now() + 60_000,
        };

        const { session } = createSession(clock, undefined, initialGame);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(true);

        // Set game end result as abandonment
        session.setGameEndResult({
            gameId: auth.roomId,
            winnerName: null,
            abandoned: true,
            reason: 'INACTIVITY',
            message: 'Game abandoned due to inactivity.',
            isForfeit: false,
        });

        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().isGameInactivityWarningActive).toBe(false);
        expect(session.getSnapshot().gameEndResult?.abandoned).toBe(true);
        expect(session.getSnapshot().gameEndResult?.winnerName).toBeNull();
    });
});
