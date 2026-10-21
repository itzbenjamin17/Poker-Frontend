// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse, IncomingGameStatePayload, PokerAction } from '../../types';
import { pokerApi } from '../../services/api';

describe('GameSession Public State Ordering & Revision Invariants', () => {
    const auth: AuthResponse = {
        roomId: 'room-ordering',
        playerName: 'Hero',
        token: 'token-hero',
        message: 'Success',
    };

    function createSession(clock = new TestClock(1000)) {
        const transport = new InMemoryTransportAdapter();
        const session = new GameSession({
            auth,
            transport,
            clock,
        });
        session.attach();
        return { session, transport, clock };
    }

    function makeGameState(overrides: Partial<IncomingGameStatePayload> = {}): IncomingGameStatePayload {
        return {
            gameId: 'room-ordering',
            maxPlayers: 6,
            pot: 100,
            phase: 'PRE_FLOP',
            currentBet: 10,
            communityCards: [],
            players: [
                { id: 'p1', name: 'Hero', chips: 1000, currentBet: 10, hasFolded: false, status: 'ACTIVE' },
                { id: 'p2', name: 'Villain', chips: 1000, currentBet: 10, hasFolded: false, status: 'ACTIVE' },
            ],
            currentPlayerName: 'Hero',
            currentPlayerId: 'p1',
            legalActions: ['CHECK', 'BET'] as PokerAction[],
            ...overrides,
        };
    }

    it('advances stateSyncRevision exactly once inside applyGameState and does not advance on duplicate or stale snapshot', () => {
        const { session } = createSession();
        expect(session.getStateSyncRevision()).toBe(0);

        // 1. Initial valid snapshot accepted
        const accepted1 = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(accepted1).toBe(true);
        expect(session.getStateSyncRevision()).toBe(1);

        // 2. Duplicate snapshot (same hand, same revision): must return false and NOT advance revision
        const acceptedDuplicate = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(acceptedDuplicate).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);

        // 3. Stale snapshot (same hand, lower revision): must return false and NOT advance revision
        const acceptedStaleRev = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 0 }));
        expect(acceptedStaleRev).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);

        // 4. Stale snapshot (lower hand): must return false and NOT advance revision
        const acceptedStaleHand = session.applyGameState(makeGameState({ handNumber: 0, stateRevision: 5 }));
        expect(acceptedStaleHand).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);

        // 5. Higher revision on same hand accepted
        const acceptedNewer = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 2 }));
        expect(acceptedNewer).toBe(true);
        expect(session.getStateSyncRevision()).toBe(2);

        // 6. Next hand restarting revision at 1 (or 0) accepted
        const acceptedNextHand = session.applyGameState(makeGameState({ handNumber: 2, stateRevision: 1 }));
        expect(acceptedNextHand).toBe(true);
        expect(session.getStateSyncRevision()).toBe(3);
    });

    it('equal hand and revision is an idempotent no-op that does NOT clear action locks', () => {
        const { session, transport } = createSession();
        transport.simulateStatus('connected');

        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(session.getStateSyncRevision()).toBe(1);

        // Acquire action lock
        session.playAction('BET', 20);
        expect(session.isActionPending('PLAY_ACTION')).toBe(true);

        // Re-applying duplicate equal hand and revision: returns false and keeps action lock pending!
        const acceptedDuplicate = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(acceptedDuplicate).toBe(false);
        expect(session.isActionPending('PLAY_ACTION')).toBe(true);

        // Stale snapshot also returns false and keeps action lock pending
        const acceptedStale = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 0 }));
        expect(acceptedStale).toBe(false);
        expect(session.isActionPending('PLAY_ACTION')).toBe(true);

        // Newer snapshot accepted: returns true and clears action lock
        const acceptedNewer = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 2 }));
        expect(acceptedNewer).toBe(true);
        expect(session.isActionPending('PLAY_ACTION')).toBe(false);
    });

    it('rejects phase regression within the same hand', () => {
        const { session } = createSession();
        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 3, phase: 'FLOP' }));
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');

        // Regression to PRE_FLOP on same hand (even with higher revision): must be rejected
        const accepted = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 4, phase: 'PRE_FLOP' }));
        expect(accepted).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
    });

    it('advances stateSyncRevision by exactly 1 on incoming STOMP frame and does not double-count', () => {
        const { session, transport } = createSession();
        session.connect();
        transport.simulateStatus('connected');

        expect(session.getStateSyncRevision()).toBe(0);

        transport.simulateMessage('/game/room-ordering', makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(session.getStateSyncRevision()).toBe(1);

        transport.simulateMessage('/game/room-ordering', makeGameState({ handNumber: 1, stateRevision: 2 }));
        expect(session.getStateSyncRevision()).toBe(2);

        // Duplicate STOMP frame: does NOT advance revision
        transport.simulateMessage('/game/room-ordering', makeGameState({ handNumber: 1, stateRevision: 2 }));
        expect(session.getStateSyncRevision()).toBe(2);
    });

    it('rejects snapshots missing handNumber or stateRevision once an ordered snapshot is accepted', () => {
        const { session } = createSession();
        // 1. Accept ordered snapshot
        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(session.getStateSyncRevision()).toBe(1);

        // 2. Incoming snapshot missing stateRevision: rejected
        const missingRev = session.applyGameState(makeGameState({ handNumber: 1, stateRevision: undefined }));
        expect(missingRev).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);

        // 3. Incoming snapshot missing handNumber: rejected
        const missingHand = session.applyGameState(makeGameState({ handNumber: undefined, stateRevision: 2 }));
        expect(missingHand).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);

        // 4. Incoming snapshot missing both: rejected
        const missingBoth = session.applyGameState(makeGameState({ handNumber: undefined, stateRevision: undefined }));
        expect(missingBoth).toBe(false);
        expect(session.getStateSyncRevision()).toBe(1);
    });

    it('retains legacy compatibility before ordered state exists', () => {
        const { session } = createSession();
        expect(session.getSnapshot().gameState).toBeNull();

        // 1. Legacy snapshot without revisions is accepted before ordered state exists
        const acceptedLegacy1 = session.applyGameState(makeGameState({ phase: 'PRE_FLOP' }));
        expect(acceptedLegacy1).toBe(true);
        expect(session.getSnapshot().gameState?.phase).toBe('PRE_FLOP');

        // 2. Phase advancement in legacy mode is accepted
        const acceptedLegacy2 = session.applyGameState(makeGameState({ phase: 'FLOP' }));
        expect(acceptedLegacy2).toBe(true);
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');

        // 3. Phase regression in legacy mode is rejected
        const acceptedLegacyRegress = session.applyGameState(makeGameState({ phase: 'PRE_FLOP' }));
        expect(acceptedLegacyRegress).toBe(false);
        expect(session.getSnapshot().gameState?.phase).toBe('FLOP');
    });

    it('prevents an unordered legacy REST response from overwriting state accepted since the REST request began', async () => {
        const { clock } = createSession();

        let resolveRest: (value: any) => void;
        const restPromise = new Promise((resolve) => {
            resolveRest = resolve;
        });

        const customApi = {
            ...pokerApi,
            getPublicGameState: vi.fn(() => restPromise),
            getGameState: vi.fn(() => restPromise),
            getRoomData: vi.fn(() => Promise.resolve({ roomId: 'room-ordering', roomName: 'Room', players: [{ name: 'Hero', isHost: true }], maxPlayers: 6, buyIn: 100, smallBlind: 5, bigBlind: 10, createdAt: '2026-01-01', hostName: 'Hero', currentPlayers: 1, canStartGame: false, gameStarted: true })),
            getPrivatePlayerState: vi.fn(() => Promise.resolve({ handNumber: 0, playerId: 'p1', holeCards: ['Ah', 'Kh'] })),
            getPrivateState: vi.fn(() => Promise.resolve({ handNumber: 0, playerId: 'p1', holeCards: ['Ah', 'Kh'] })),
        };

        const sessionWithApi = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            pokerApi: customApi as any,
        });
        sessionWithApi.attach();
        sessionWithApi.markGameStarted();

        // Start REST sync
        const syncPromise = sessionWithApi.synchronizeSession();

        // While REST is in-flight, a newer ordered WS snapshot arrives
        sessionWithApi.applyGameState(makeGameState({ handNumber: 1, stateRevision: 2, pot: 500 }));
        expect(sessionWithApi.getStateSyncRevision()).toBe(1);
        expect(sessionWithApi.getSnapshot().gameState?.pot).toBe(500);

        // Now REST finishes with an unordered legacy snapshot (missing stateRevision)
        resolveRest!(makeGameState({ handNumber: 0, stateRevision: undefined, pot: 100 }));
        await syncPromise;

        // The newer state (pot: 500) must NOT have been overwritten by the unordered legacy response
        expect(sessionWithApi.getSnapshot().gameState?.pot).toBe(500);
    });

    it('updates display clock offset only AFTER snapshot passes acceptance', () => {
        const { session } = createSession(new TestClock(10_000));
        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 5, serverTimeEpochMs: 20_000 }));
        // clock was 10,000, server was 20,000 => offset is +10,000
        expect(session.displayNow()).toBe(20_000);

        // Now send a rejected stale snapshot with backwards serverTimeEpochMs: 15_000
        const rejected = session.applyGameState(makeGameState({
            handNumber: 1,
            stateRevision: 3, // stale!
            serverTimeEpochMs: 15_000,
        }));
        expect(rejected).toBe(false);

        // Display clock offset must NOT have changed from the rejected snapshot
        expect(session.displayNow()).toBe(20_000);
    });

    it('clears hero ID when setting game state to null', () => {
        const { session } = createSession();
        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 1 }));
        expect(session.getSnapshot().myPlayerId).toBe('p1');

        session.setGameState(null);
        expect(session.getSnapshot().gameState).toBeNull();
        expect(session.getSnapshot().myPlayerId).toBeNull();
    });

    it('equal-revision REST recovery hydrates coherent private data without rolling back or hanging', async () => {
        const { clock } = createSession();

        const customApi = {
            ...pokerApi,
            getPublicGameState: vi.fn(() => Promise.resolve(makeGameState({ handNumber: 1, stateRevision: 2, pot: 250 }))),
            getGameState: vi.fn(() => Promise.resolve(makeGameState({ handNumber: 1, stateRevision: 2, pot: 250 }))),
            getRoomData: vi.fn(() => Promise.resolve({ roomId: 'room-ordering', roomName: 'Room', players: [{ name: 'Hero', isHost: true }], maxPlayers: 6, buyIn: 100, smallBlind: 5, bigBlind: 10, createdAt: '2026-01-01', hostName: 'Hero', currentPlayers: 1, canStartGame: false, gameStarted: true })),
            getPrivatePlayerState: vi.fn(() => Promise.resolve({ handNumber: 1, playerId: 'p1', holeCards: ['As', 'Ks'] })),
            getPrivateState: vi.fn(() => Promise.resolve({ handNumber: 1, playerId: 'p1', holeCards: ['As', 'Ks'] })),
        };

        const session = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            pokerApi: customApi as any,
        });
        session.attach();
        session.markGameStarted();

        // WS arrived already with hand 1, stateRevision 2
        session.applyGameState(makeGameState({ handNumber: 1, stateRevision: 2, pot: 250 }));
        expect(session.getStateSyncRevision()).toBe(1);

        // Now REST recovery runs and returns equal-revision (hand 1, stateRevision 2) + private cards
        await session.synchronizeSession();

        // Public state remains, private cards applied, hydrated is true!
        expect(session.getSnapshot().isHydrated).toBe(true);
        expect(session.getSnapshot().privateState?.holeCards).toEqual(['AS', 'KS']);
        expect(session.getSnapshot().gameState?.pot).toBe(250);
        // Duplicate public snapshot did not advance stateSyncRevision a second time
        expect(session.getStateSyncRevision()).toBe(1);
    });
});
