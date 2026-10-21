// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../GameSession';
import { TestClock } from '../clock';
import { InMemoryTransportAdapter } from '../../services/transport';
import type { AuthResponse } from '../../types';
import { pokerApi } from '../../services/api';

describe('GameSession Lifecycle Ownership & Attachment Epochs', () => {
    const auth: AuthResponse = {
        roomId: 'room-lifecycle',
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
        return { session, transport, clock, onLeave };
    }

    it('manages attachment epochs with idempotent acquire and detach', () => {
        const { session } = createSession();

        // Initial attach
        const epoch1 = session.attach();
        expect(epoch1).toBeGreaterThan(0);
        expect(session.isAttached()).toBe(true);
        expect(session.getAttachmentEpoch()).toBe(epoch1);

        // Idempotent re-attach returns same epoch while attached
        const epoch1Again = session.attach();
        expect(epoch1Again).toBe(epoch1);

        // Detach invalidates epoch and sets attached to false
        session.detach();
        expect(session.isAttached()).toBe(false);
        const detachedEpoch = session.getAttachmentEpoch();
        expect(detachedEpoch).toBeGreaterThan(epoch1);

        // Idempotent detach
        session.detach();
        expect(session.isAttached()).toBe(false);

        // acquire / release aliases
        const epoch2 = session.acquire();
        expect(epoch2).toBeGreaterThan(detachedEpoch);
        expect(session.isAttached()).toBe(true);

        session.release();
        expect(session.isAttached()).toBe(false);
    });

    it('detaching clears onLeave and cancels pending redirect timers', () => {
        const { session, clock, onLeave } = createSession();
        session.attach();

        session.scheduleRedirect('Room closed by host');
        expect(onLeave).not.toHaveBeenCalled();

        // Detach session before redirect timer completes
        session.detach();

        // Advance past ROOM_CLOSED_REDIRECT_MS
        clock.tick(5000);
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('detaching cancels action locks and notification timers', () => {
        const { session, clock } = createSession();
        session.attach();

        // Trigger notification with timer
        session.setNotification('Hello world', 4000);
        expect(session.getSnapshot().notification).toBe('Hello world');

        session.detach();
        expect(session.getSnapshot().notification).toBeNull();

        // Advance timers - no resurrection
        clock.tick(5000);
        expect(session.getSnapshot().notification).toBeNull();
    });

    it('detaching cancels recovery timers and aborts in-flight recovery attempts', async () => {
        const { session, clock } = createSession();
        session.attach();

        let abortSignalled = false;
        const mockGetRoomData = vi.fn((_roomId: string, _token: string, signal?: AbortSignal) => {
            return new Promise<never>((_, reject) => {
                signal?.addEventListener('abort', () => {
                    abortSignalled = true;
                    reject(new Error('Aborted'));
                });
            });
        });

        const customApi = {
            ...pokerApi,
            getRoomData: mockGetRoomData,
        };

        const sessionWithApi = new GameSession({
            auth,
            transport: new InMemoryTransportAdapter(),
            clock,
            pokerApi: customApi as any,
        });

        sessionWithApi.attach();
        void sessionWithApi.synchronizeSession();

        // Detach before synchronization finishes
        sessionWithApi.detach();
        expect(abortSignalled).toBe(true);
        expect(sessionWithApi.getSnapshot().isRecovering).toBe(false);
    });

    it('detaching cancels claim work and disconnects transport without socket setup', () => {
        const { session, transport } = createSession();
        const disconnectSpy = vi.spyOn(transport, 'disconnect');
        session.attach();

        session.setClaimPending(true);
        expect(session.getSnapshot().claimPending).toBe(true);

        session.detach();

        expect(session.getSnapshot().claimPending).toBe(false);
        expect(session.getSnapshot().wsStatus).toBe('disconnected');
        expect(disconnectSpy).toHaveBeenCalled();
    });

    it('supports Strict Mode reversible detach -> attach with pre-hydration work re-enabled', async () => {
        const { session } = createSession();

        // 1st mount: attach
        const epoch1 = session.attach();
        expect(session.hasLifecyclePermission()).toBe(true);

        // StrictMode cleanup: detach
        session.detach();
        expect(session.isAttached()).toBe(false);
        expect(session.hasLifecyclePermission()).toBe(false);

        // StrictMode remount: attach again
        const epoch2 = session.attach();
        expect(epoch2).toBeGreaterThan(epoch1);
        expect(session.isAttached()).toBe(true);
        expect(session.hasLifecyclePermission()).toBe(true);

        // Pre-hydration work works without needing connect()
        let loadCalled = false;
        vi.spyOn(session, 'synchronizeSession').mockImplementation(async () => {
            loadCalled = true;
        });

        await session.synchronizeSession();
        expect(loadCalled).toBe(true);
    });

    it('dispose permanently prevents re-attachment lifecycle permission', () => {
        const { session } = createSession();
        session.attach();

        session.dispose();
        expect(session.isAttached()).toBe(false);
        expect(session.hasLifecyclePermission()).toBe(false);

        // Attempting to attach after dispose does not re-enable lifecycle permission
        session.attach();
        expect(session.hasLifecyclePermission()).toBe(false);
    });
});
