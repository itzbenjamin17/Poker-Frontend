import { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { GameProvider } from '../../context/GameProvider';
import { GameSession } from '../../domain/GameSession';
import { InMemoryTransportAdapter } from '../../services/transport';
import { mapRoomDataToRoomState } from '../../lib/payloads';
import { createValidGameState, createValidRoomData, mockAuth } from '../../test/fixtures';
import { server } from '../../test/mocks/server';
import { useSessionHydration } from '../useSessionHydration';
import { useGameWebSocket } from '../useGameWebSocket';

describe('public game snapshot diagnostics at REST boundaries', () => {
    afterEach(() => vi.restoreAllMocks());

    function setup() {
        const auth = { ...mockAuth };
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({ auth, transport, onLeave: vi.fn() });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const room = createValidRoomData({ gameStarted: true });
        server.use(
            http.get('/api/room/:roomId', () => HttpResponse.json(room)),
            http.get('/api/game/:gameId/state', () => HttpResponse.json(createValidGameState({
                players: [{ chips: 'private-invalid-value' }],
            }))),
            http.get('/api/game/:gameId/private-state', () => HttpResponse.json({ holeCards: [] })),
        );
        const wrapper = ({ children }: { children: ReactNode }) => (
            <GameProvider auth={auth} onLeave={() => {}} session={session}>
                {children}
            </GameProvider>
        );
        return { session, transport, warn, room, wrapper };
    }

    it('identifies an invalid snapshot returned by initial REST hydration', async () => {
        const { session, warn, wrapper } = setup();
        renderHook(() => useSessionHydration(), { wrapper });

        await waitFor(() => expect(warn).toHaveBeenCalledWith('Rejected public game snapshot:', {
            source: 'initial REST game snapshot',
            path: '$.players[0].chips',
            expected: 'nonnegative safe integer',
            receivedType: 'string',
        }));
        expect(session.getSnapshot().gameState).toBeNull();
    });

    it('identifies an invalid REST recovery snapshot and retains the accepted table', async () => {
        const { session, transport, warn, room, wrapper } = setup();
        session.setRoomState(mapRoomDataToRoomState(room));
        session.applyGameState(createValidGameState({ pot: 75 }));
        session.setHydrated(true);
        const accepted = session.getSnapshot().gameState;
        renderHook(() => useGameWebSocket(), { wrapper });
        act(() => transport.simulateStatus('connected'));

        await waitFor(() => expect(warn).toHaveBeenCalledWith('Rejected public game snapshot:', {
            source: 'REST recovery game snapshot',
            path: '$.players[0].chips',
            expected: 'nonnegative safe integer',
            receivedType: 'string',
        }));
        expect(session.getSnapshot().gameState).toBe(accepted);
    });

    it('diagnoses a malformed HTTP recovery response without losing the accepted table', async () => {
        const { session, warn, room, wrapper } = setup();
        server.use(http.get('/api/game/:gameId/state', () => HttpResponse.json(null)));
        session.setRoomState(mapRoomDataToRoomState(room));
        session.applyGameState(createValidGameState({ pot: 75 }));
        session.setHydrated(true);
        const accepted = session.getSnapshot().gameState;
        renderHook(() => useGameWebSocket(), { wrapper });

        await waitFor(() => expect(warn).toHaveBeenCalledWith('Rejected public game snapshot:', {
            source: 'REST recovery game snapshot', path: '$', expected: 'object', receivedType: 'null',
        }));
        expect(session.getSnapshot().gameState).toBe(accepted);
    });
});
