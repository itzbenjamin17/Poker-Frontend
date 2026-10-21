// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, GameEndResult, IncomingGameStatePayload } from '../../types';
import { HOST_LEFT, SESSION_EXPIRED, SESSION_SEAT_GONE } from '../../constants/strings';

describe('GameSession Redirect Lifecycle & Transport Barrier', () => {
    const auth: AuthResponse = {
        roomId: 'room-redirect',
        playerName: 'Hero',
        token: 'token-hero',
        message: 'Success',
    };

    function createSession(clock = new TestClock(1000)) {
        const transport = new InMemoryTransportAdapter();
        const onLeave = vi.fn();
        const session = new GameSession({
            auth,
            transport,
            clock,
            onLeave,
        });
        session.attach();
        return { session, transport, clock, onLeave };
    }

    it('latches isRedirecting = true and first reason wins without restarting the 3s deadline on duplicates', () => {
        const { session, clock, onLeave } = createSession();
        expect(session.getSnapshot().isRedirecting).toBe(false);

        // First redirect reason
        session.scheduleRedirect(SESSION_SEAT_GONE);
        expect(session.getSnapshot().isRedirecting).toBe(true);
        expect(session.getSnapshot().notification).toBe(SESSION_SEAT_GONE);
        expect(session.hasLifecyclePermission()).toBe(false);

        // Advance 1s (elapsed: 1000ms, 2000ms remaining)
        clock.tick(1000);

        // Duplicate redirect reason arrives at 1s
        session.scheduleRedirect(SESSION_EXPIRED);
        // Message and timer deadline must NOT be reset/restarted!
        expect(session.getSnapshot().notification).toBe(SESSION_SEAT_GONE);

        // Advance 2s more (total 3000ms from start)
        clock.tick(2000);
        expect(onLeave).toHaveBeenCalledTimes(1);

        // Advance further: onLeave is not called again
        clock.tick(5000);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('routes ROOM_CLOSED through shared redirect, clearing roomState and setting HOST_LEFT', () => {
        const { session, transport, clock, onLeave } = createSession();
        session.connect();
        transport.simulateStatus('connected');

        transport.simulateMessage('/room/room-redirect', {
            message: 'ROOM_CLOSED',
            data: { roomId: 'room-redirect' },
        });

        expect(session.getSnapshot().isRedirecting).toBe(true);
        expect(session.getSnapshot().roomState).toBeNull();
        expect(session.getSnapshot().notification).toBe(HOST_LEFT);
        expect(session.getSnapshot().wsStatus).toBe('disconnected');

        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('entering redirect disconnects transport and creates a network barrier against queued frames and callbacks', () => {
        const { session, transport, clock, onLeave } = createSession();
        session.connect();
        transport.simulateStatus('connected');
        const publishSpy = vi.spyOn(transport, 'publish');
        const disconnectSpy = vi.spyOn(transport, 'disconnect');

        session.scheduleRedirect('Seat gone');
        expect(session.getSnapshot().isRedirecting).toBe(true);
        expect(disconnectSpy).toHaveBeenCalled();

        // 1. Gameplay actions are rejected
        session.playAction('CHECK');
        expect(publishSpy).not.toHaveBeenCalled();
        expect(session.isActionPending('PLAY_ACTION')).toBe(false);

        // 2. Incoming game frames queued or simulated after redirect are discarded
        transport.simulateMessage('/game/room-redirect', {
            phase: 'TURN',
            pot: 999,
            currentBet: 0,
            communityCards: ['Ah', 'Kh', 'Qh'],
            players: [],
            currentPlayerName: '',
            currentPlayerId: '',
            maxPlayers: 2,
        } as IncomingGameStatePayload);
        expect(session.getSnapshot().gameState).toBeNull();

        // 3. Status changes simulated after redirect are discarded
        transport.simulateStatus('connected');
        expect(session.getSnapshot().wsStatus).toBe('disconnected');

        // 4. Connect / reconnect / retry requests are rejected
        session.connect();
        expect(session.getSnapshot().wsStatus).toBe('disconnected');
        session.retryConnection();

        // 5. Timer finishes and onLeave fires
        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledTimes(1);

        // After timer fires, lifecycle permission is NOT restored
        expect(session.hasLifecyclePermission()).toBe(false);
    });

    it('does not start redirect on an already terminal session', () => {
        const { session, transport, clock, onLeave } = createSession();
        const terminalResult: GameEndResult = {
            gameId: 'room-redirect',
            winnerName: 'Hero',
            winnerChips: 1000,
            isForfeit: false,
            message: 'Hero won',
        };

        session.installTerminalResult(terminalResult);
        expect(session.getSnapshot().isGameOver).toBe(true);

        // Attempt redirect via scheduleRedirect
        session.scheduleRedirect(SESSION_EXPIRED);
        expect(session.getSnapshot().isRedirecting).toBe(false);

        // Attempt redirect via ROOM_CLOSED
        transport.simulateMessage('/room/room-redirect', {
            message: 'ROOM_CLOSED',
            data: { roomId: 'room-redirect' },
        });
        expect(session.getSnapshot().isRedirecting).toBe(false);

        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('allows an explicit terminal-install from an authorized owner to cancel a pending redirect', () => {
        const { session, clock, onLeave } = createSession();
        session.scheduleRedirect('Lost connection');
        expect(session.getSnapshot().isRedirecting).toBe(true);

        const terminalResult: GameEndResult = {
            gameId: 'room-redirect',
            winnerName: 'Hero',
            winnerChips: 1000,
            isForfeit: false,
            message: 'Hero won tournament',
        };

        // Explicit install from current authorized owner
        session.installTerminalResult(terminalResult);
        expect(session.getSnapshot().isGameOver).toBe(true);
        expect(session.getSnapshot().isRedirecting).toBe(false);

        // 3-second redirect deadline expires: onLeave must NOT be called
        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('rejects stale network frames attempting to install terminal result after redirect barrier', () => {
        const { session, transport, clock, onLeave } = createSession();
        session.connect();
        transport.simulateStatus('connected');

        session.scheduleRedirect('Seat gone');
        expect(session.getSnapshot().isRedirecting).toBe(true);

        // Stale STOMP frame arrives on /game after redirect entered
        transport.simulateMessage('/game/room-redirect', {
            type: 'GAME_END',
            gameId: 'room-redirect',
            winnerName: 'Hero',
            message: 'Hero won',
            isForfeit: false,
        });

        // Frame must be rejected at barrier
        expect(session.getSnapshot().isGameOver).toBe(false);
        expect(session.getSnapshot().isRedirecting).toBe(true);

        clock.tick(3000);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('detaching session before redirect expires cancels onLeave', () => {
        const { session, clock, onLeave } = createSession();
        session.scheduleRedirect(SESSION_SEAT_GONE);
        expect(session.getSnapshot().isRedirecting).toBe(true);

        // Ownership release / detach
        session.detach();
        expect(session.isAttached()).toBe(false);

        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });
});
