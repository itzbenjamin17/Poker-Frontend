import { StrictMode, createElement, useState } from 'react';
import { render, act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { GameProvider } from '../GameProvider';
import { GameSession } from '../../domain/GameSession';
import { TestClock } from '../../domain/clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import { useSessionHydration } from '../../hooks/useSessionHydration';
import { useGameWebSocket } from '../../hooks/useGameWebSocket';
import { useGameContext } from '../GameContext';
import type { AuthResponse } from '../../types';
import { createMockJwt, createValidGameState, createValidRoomData } from '../../test/fixtures';

describe('GameProvider Ownership Lifecycle & StrictMode', () => {
    const authA: AuthResponse = {
        roomId: 'room-A',
        playerName: 'PlayerA',
        token: createMockJwt({ sub: 'PlayerA' }),
    };

    const authB: AuthResponse = {
        roomId: 'room-B',
        playerName: 'PlayerB',
        token: createMockJwt({ sub: 'PlayerB' }),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
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
        const user = userEvent.setup();
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

        render(createElement(Switcher));

        expect(sessionA.isAttached()).toBe(true);
        expect(screen.getByTestId('current-player').textContent).toBe('PlayerA');

        // Switch to Session B before A's redirect completes
        await user.click(screen.getByRole('button', { name: 'Switch to B' }));

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

        server.use(
            http.get('*/api/room/room-A', () => HttpResponse.json(roomDataResponse))
        );

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

        // Hydration succeeded and WebSocket connected
        await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'));
        expect(connectSpy).toHaveBeenCalledTimes(1);

        // Final unmount cleans up everything
        unmount();

        expect(disconnectSpy).toHaveBeenCalled();
    });

    it('stays mounted cleanly when initial room hydration fails with HTTP 500 and cleans up on unmount', async () => {
        const transport = new InMemoryTransportAdapter();
        const disconnectSpy = vi.spyOn(transport, 'disconnect');
        const clock = new TestClock(1000);
        let roomRequests = 0;

        server.use(
            http.get('*/api/room/room-A', () => {
                roomRequests += 1;
                return HttpResponse.json({ detail: 'Server error' }, { status: 500 });
            })
        );

        function RealChild() {
            const { initialLoadFailed } = useSessionHydration();
            const { isHydrated } = useGameContext();
            return createElement(
                'div',
                null,
                createElement('span', { 'data-testid': 'hydrated' }, String(isHydrated)),
                createElement('span', { 'data-testid': 'failed' }, String(initialLoadFailed))
            );
        }

        const session = new GameSession({ auth: authA, transport, clock });
        const { unmount } = render(
            createElement(
                GameProvider,
                { auth: authA, session, transport },
                createElement(RealChild)
            )
        );

        await waitFor(() => expect(roomRequests).toBe(1));
        await waitFor(() => expect(session.hasPendingRecoveryTimer()).toBe(true));
        expect(screen.getByTestId('hydrated').textContent).toBe('false');

        unmount();
        expect(session.isAttached()).toBe(false);
        expect(session.hasPendingRecoveryTimer()).toBe(false);
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

        const resultA = createValidGameState({
            gameId: authA.roomId,
            phase: 'SHOWDOWN',
            players: [{ id: 'p-1', name: 'PlayerA', chips: 1000 }],
            gameEnd: {
                winner: 'PlayerA',
                winnerChips: 1000,
                isForfeit: false,
                message: 'PlayerA wins tournament',
            },
        });

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
            version: 2,
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
                gameEnd: {
                    ...resultA.gameEnd!,
                    message: 'Should not persist after detach',
                },
            });
        });

        expect(sessionStorage.getItem(`poker-game-end:${authA.roomId}`)).toBeNull();
    });

    it('changing auth in GameProvider automatically detaches previous session and prevents old session from evicting new session', async () => {
        const user = userEvent.setup();
        const clock = new TestClock(1000);
        const onLeaveA = vi.fn();
        const onLeaveB = vi.fn();

        let currentSessionInstance: GameSession | null = null;
        function CaptureSession() {
            const { session } = useGameContext();
            currentSessionInstance = session ?? null;
            return createElement('div', { 'data-testid': 'room' }, session?.getAuth().roomId ?? '');
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

        render(createElement(DynamicProvider));

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
        await user.click(screen.getByRole('button', { name: 'Switch Auth' }));

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
