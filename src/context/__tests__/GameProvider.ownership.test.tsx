import { StrictMode, createElement, useState } from 'react';
import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameProvider } from '../GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import { useSessionHydration } from '../../hooks/useSessionHydration';
import { useGameWebSocket } from '../../hooks/useGameWebSocket';
import { useGameContext } from '../GameContext';
import { pokerApi } from '../../services/api';
import type { AuthResponse } from '../../types';
import { createValidRoomData } from '../../test/fixtures';

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/api')>();
    return {
        ...actual,
        pokerApi: {
            ...actual.pokerApi,
            getRoomData: vi.fn(),
            getGame: vi.fn(),
            getPrivateState: vi.fn(),
            getReview: vi.fn(),
            claimWin: vi.fn(),
            startGame: vi.fn(),
            leaveRoom: vi.fn(),
        },
    };
});

describe('GameProvider Ownership Lifecycle & StrictMode', () => {
    const authA: AuthResponse = {
        roomId: 'room-A',
        playerName: 'PlayerA',
        token: 'token-A',
        message: 'Success',
    };

    const authB: AuthResponse = {
        roomId: 'room-B',
        playerName: 'PlayerB',
        token: 'token-B',
        message: 'Success',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('unmounting GameProvider before hydration or socket setup cleans up session completely', () => {
        const clock = new TestClock(1000);
        const transport = new InMemoryTransportAdapter();
        const onLeave = vi.fn();
        const disconnectSpy = vi.spyOn(transport, 'disconnect');

        const session = new GameSession({
            auth: authA,
            transport,
            clock,
            onLeave,
        });

        // Session schedules redirect before hydration completes
        session.scheduleRedirect('Room closed before hydration');

        const { unmount } = render(
            createElement(GameProvider, {
                auth: authA,
                session,
                onLeave,
                children: createElement('div', null, 'child'),
            })
        );

        expect(session.isAttached()).toBe(true);

        unmount();

        // Must be detached, transport disconnected, and onLeave cleared
        expect(session.isAttached()).toBe(false);
        expect(disconnectSpy).toHaveBeenCalled();

        // Advancing clock past redirect delay must NOT call onLeave
        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('replacing session A with session B cancels A redirect/hydration and leaves B fully intact', async () => {
        const clock = new TestClock(1000);
        const transportA = new InMemoryTransportAdapter();
        const transportB = new InMemoryTransportAdapter();
        const onLeaveA = vi.fn();
        const onLeaveB = vi.fn();

        const sessionA = new GameSession({
            auth: authA,
            transport: transportA,
            clock,
            onLeave: onLeaveA,
        });

        const sessionB = new GameSession({
            auth: authB,
            transport: transportB,
            clock,
            onLeave: onLeaveB,
        });

        sessionA.scheduleRedirect('Session A expired');

        function Switcher() {
            const [currentAuth, setCurrentAuth] = useState(authA);
            const [currentSession, setCurrentSession] = useState(sessionA);
            const [currentOnLeave, setCurrentOnLeave] = useState(() => onLeaveA);

            return createElement(
                'div',
                null,
                createElement(
                    GameProvider,
                    {
                        auth: currentAuth,
                        session: currentSession,
                        onLeave: currentOnLeave,
                    },
                    createElement('div', { 'data-testid': 'current-player' }, currentAuth.playerName)
                ),
                createElement(
                    'button',
                    {
                        onClick: () => {
                            setCurrentAuth(authB);
                            setCurrentSession(sessionB);
                            setCurrentOnLeave(() => onLeaveB);
                        },
                    },
                    'Switch to B'
                )
            );
        }

        const { getByText } = render(createElement(Switcher));

        expect(sessionA.isAttached()).toBe(true);
        expect(screen.getByTestId('current-player').textContent).toBe('PlayerA');

        // Switch to Session B before A's redirect completes
        act(() => {
            getByText('Switch to B').click();
        });

        expect(screen.getByTestId('current-player').textContent).toBe('PlayerB');
        expect(sessionA.isAttached()).toBe(false);
        expect(sessionB.isAttached()).toBe(true);

        // Advance timers - Session A's redirect must not trigger onLeaveA or affect B
        clock.tick(5000);
        expect(onLeaveA).not.toHaveBeenCalled();
        expect(onLeaveB).not.toHaveBeenCalled();
        expect(sessionB.isAttached()).toBe(true);
    });

    it('renders real provider, hydration, and socket seams in StrictMode with single live connection and clean unmount', async () => {
        const transport = new InMemoryTransportAdapter();
        const connectSpy = vi.spyOn(transport, 'connect');
        const disconnectSpy = vi.spyOn(transport, 'disconnect');

        const roomDataResponse = createValidRoomData({
            roomId: 'room-A',
            roomName: 'Main Room',
            players: [{ name: 'PlayerA', isHost: true }],
            gameStarted: false,
        });

        vi.mocked(pokerApi.getRoomData).mockResolvedValue(roomDataResponse);

        function RealChild() {
            useSessionHydration();
            useGameWebSocket();
            const { isHydrated, wsStatus } = useGameContext();
            return createElement(
                'div',
                null,
                createElement('span', { 'data-testid': 'hydrated' }, String(isHydrated)),
                createElement('span', { 'data-testid': 'status' }, wsStatus)
            );
        }

        let unmountFn!: () => void;
        await act(async () => {
            const { unmount } = render(
                createElement(
                    StrictMode,
                    null,
                    createElement(
                        GameProvider,
                        {
                            auth: authA,
                            transport,
                        },
                        createElement(RealChild)
                    )
                )
            );
            unmountFn = unmount;
        });

        // Hydration succeeded and WebSocket connected
        expect(screen.getByTestId('hydrated').textContent).toBe('true');
        expect(connectSpy).toHaveBeenCalledTimes(1);

        // Final unmount cleans up everything
        act(() => {
            unmountFn();
        });

        expect(disconnectSpy).toHaveBeenCalled();
    });

    it('gates persistence of gameEndResult on attachment and matching auth identity', async () => {
        const clock = new TestClock(1000);
        const transport = new InMemoryTransportAdapter();

        const session = new GameSession({
            auth: authA,
            transport,
            clock,
        });

        const resultA = {
            gameId: authA.roomId,
            winnerName: 'PlayerA',
            winnerChips: 1000,
            isForfeit: false,
            message: 'PlayerA wins tournament',
        };

        const { unmount } = render(
            createElement(GameProvider, {
                auth: authA,
                session,
                children: createElement('div', null, 'content'),
            })
        );

        // While attached and matching auth, setting gameEndResult persists
        act(() => {
            session.setGameEndResult(resultA);
        });

        const raw = sessionStorage.getItem(`poker-game-end:${authA.roomId}`);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({
            version: 1,
            roomId: authA.roomId,
            playerName: authA.playerName,
            token: authA.token,
            result: resultA,
        });

        // Clear storage
        sessionStorage.clear();

        // Once detached (unmounted), setting a new result does NOT persist
        unmount();
        expect(session.isAttached()).toBe(false);

        act(() => {
            session.setGameEndResult({
                ...resultA,
                message: 'Should not persist after detach',
            });
        });

        expect(sessionStorage.getItem(`poker-game-end:${authA.roomId}`)).toBeNull();
    });

    it('changing auth in GameProvider automatically detaches previous session and prevents old session from evicting new session', () => {
        const clock = new TestClock(1000);
        const onLeaveA = vi.fn();
        const onLeaveB = vi.fn();

        let currentSessionInstance: GameSession | null = null;
        function CaptureSession() {
            const { session } = useGameContext();
            currentSessionInstance = session;
            return createElement('div', { 'data-testid': 'room' }, session.getAuth().roomId);
        }

        function DynamicProvider() {
            const [currentAuth, setCurrentAuth] = useState(authA);
            const [currentOnLeave, setCurrentOnLeave] = useState(() => onLeaveA);

            return createElement(
                'div',
                null,
                createElement(
                    GameProvider,
                    {
                        auth: currentAuth,
                        onLeave: currentOnLeave,
                        clock,
                    },
                    createElement(CaptureSession)
                ),
                createElement(
                    'button',
                    {
                        onClick: () => {
                            setCurrentAuth(authB);
                            setCurrentOnLeave(() => onLeaveB);
                        },
                    },
                    'Switch Auth'
                )
            );
        }

        const { getByText } = render(createElement(DynamicProvider));

        expect(screen.getByTestId('room').textContent).toBe('room-A');
        const sessionA = currentSessionInstance!;
        expect(sessionA).not.toBeNull();
        expect(sessionA.isAttached()).toBe(true);

        // Session A schedules a redirect (e.g. host left or seat expired)
        act(() => {
            sessionA.scheduleRedirect('Room closed by host');
        });
        expect(sessionA.isRedirectingActive()).toBe(true);

        // Before 3,000ms elapses, the auth is switched to Auth B (cross-tab login or re-auth)
        act(() => {
            getByText('Switch Auth').click();
        });

        expect(screen.getByTestId('room').textContent).toBe('room-B');
        const sessionB = currentSessionInstance!;
        expect(sessionB).not.toBeNull();
        expect(sessionB).not.toBe(sessionA);
        expect(sessionA.isAttached()).toBe(false);
        expect(sessionB.isAttached()).toBe(true);

        // Advance clock past 3,000ms redirect timer of session A
        act(() => {
            clock.tick(5000);
        });

        // Neither onLeaveA nor onLeaveB was called
        expect(onLeaveA).not.toHaveBeenCalled();
        expect(onLeaveB).not.toHaveBeenCalled();

        // Replacement session B remains attached and uncorrupted
        expect(sessionB.isAttached()).toBe(true);
        expect(sessionB.isRedirectingActive()).toBe(false);
    });
});
