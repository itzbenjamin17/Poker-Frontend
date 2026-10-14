// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@stomp/stompjs';
import {
    InMemoryTransportAdapter,
    StompTransportAdapter,
    type TransportStatus,
} from '../transport';

describe('GameTransport - InMemoryTransportAdapter', () => {
    let transport: InMemoryTransportAdapter;

    beforeEach(() => {
        transport = new InMemoryTransportAdapter();
    });

    it('starts disconnected and transitions to connected on connect', () => {
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((status) => statusChanges.push(status));

        expect(transport.isConnected()).toBe(false);
        transport.connect();
        expect(transport.isConnected()).toBe(true);
        expect(statusChanges).toEqual(['connected']);
    });

    it('transitions to disconnected on disconnect', () => {
        transport.connect();
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((status) => statusChanges.push(status));

        transport.disconnect();
        expect(transport.isConnected()).toBe(false);
        expect(statusChanges).toEqual(['disconnected']);
    });

    it('routes simulated messages to active subscribers', () => {
        transport.connect();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const otherHandler = vi.fn();

        const sub1 = transport.subscribe('/room/123', handler1);
        transport.subscribe('/room/123', handler2);
        transport.subscribe('/room/456', otherHandler);

        transport.simulateMessage('/room/123', '{"event":"HELLO"}');

        expect(handler1).toHaveBeenCalledWith('{"event":"HELLO"}');
        expect(handler2).toHaveBeenCalledWith('{"event":"HELLO"}');
        expect(otherHandler).not.toHaveBeenCalled();

        sub1.unsubscribe();
        transport.simulateMessage('/room/123', '{"event":"WORLD"}');
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(2);
    });

    it('serializes object payloads in simulateMessage if an object is passed', () => {
        transport.connect();
        const handler = vi.fn();
        transport.subscribe('/topic/test', handler);

        transport.simulateMessage('/topic/test', JSON.stringify({ a: 1 }));
        expect(handler).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
    });

    it('records published messages and supports inspection and clearing', () => {
        transport.connect();
        transport.publish('/app/action', JSON.stringify({ type: 'FOLD' }));
        transport.publish('/app/chat', 'hello');

        expect(transport.getPublishedMessages()).toEqual([
            { destination: '/app/action', body: JSON.stringify({ type: 'FOLD' }) },
            { destination: '/app/chat', body: 'hello' },
        ]);

        expect(transport.getPublishedMessages('/app/action')).toEqual([
            { destination: '/app/action', body: JSON.stringify({ type: 'FOLD' }) },
        ]);

        transport.clearPublishedMessages();
        expect(transport.getPublishedMessages()).toEqual([]);
    });

    it('supports simulateStatus and simulateError', () => {
        const statusChanges: TransportStatus[] = [];
        const errors: string[] = [];

        transport.onStatusChange((s) => statusChanges.push(s));
        transport.onError?.((e) => errors.push(e));

        transport.simulateStatus('reconnecting');
        expect(statusChanges).toEqual(['reconnecting']);

        transport.simulateError('Broker unavailable');
        expect(errors).toEqual(['Broker unavailable']);
    });

    it('allows unregistering status and error listeners', () => {
        const statusListener = vi.fn();
        const errorListener = vi.fn();

        const unsubStatus = transport.onStatusChange(statusListener);
        const unsubError = transport.onError?.(errorListener);

        unsubStatus();
        unsubError?.();

        transport.simulateStatus('connected');
        transport.simulateError('err');

        expect(statusListener).not.toHaveBeenCalled();
        expect(errorListener).not.toHaveBeenCalled();
    });
});

describe('GameTransport - StompTransportAdapter', () => {
    let mockClient: any;
    let transport: StompTransportAdapter;

    beforeEach(() => {
        mockClient = {
            active: false,
            activate: vi.fn(function (this: { active: boolean }) {
                this.active = true;
            }),
            deactivate: vi.fn(function (this: { active: boolean }) {
                this.active = false;
            }),
            subscribe: vi.fn().mockImplementation(() => ({
                unsubscribe: vi.fn(),
            })),
            publish: vi.fn(),
            connected: false,
        };
        transport = new StompTransportAdapter(mockClient);
    });

    it('delegates connect to client.activate and disconnect to client.deactivate', () => {
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((s) => statusChanges.push(s));

        transport.connect();
        expect(mockClient.activate).toHaveBeenCalledTimes(1);

        transport.disconnect();
        expect(mockClient.deactivate).toHaveBeenCalledWith({ force: true });
        expect(statusChanges).toContain('disconnected');
    });

    it('maps client onConnect and onWebSocketClose to status transitions', () => {
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((s) => statusChanges.push(s));

        mockClient.connected = true;
        mockClient.onConnect?.();
        expect(statusChanges).toEqual(['connected']);

        mockClient.connected = false;
        mockClient.onWebSocketClose?.();
        expect(statusChanges).toEqual(['connected', 'reconnecting']);
    });

    it('maps client onStompError to reconnecting status and error listener', () => {
        const statusChanges: TransportStatus[] = [];
        const errors: string[] = [];

        transport.onStatusChange((s) => statusChanges.push(s));
        transport.onError?.((err) => errors.push(err));

        mockClient.onStompError?.({
            headers: { message: 'Bad STOMP frame' },
            body: 'Detailed error trace',
        });

        expect(statusChanges).toEqual(['reconnecting']);
        expect(errors).toEqual(['Bad STOMP frame']);
    });

    it('falls back to body or default message when header is missing in onStompError', () => {
        const errors: string[] = [];
        transport.onError?.((err) => errors.push(err));

        mockClient.onStompError?.({
            headers: {},
            body: 'Connection refused',
        });
        expect(errors).toEqual(['Connection refused']);

        mockClient.onStompError?.({});
        expect(errors).toEqual(['Connection refused', 'STOMP transport error']);
    });

    it('subscribes and unwraps incoming STOMP message body when connected', () => {
        const handler = vi.fn();
        let stompCallback: (msg: { body: string }) => void = () => {};

        mockClient.connected = true;
        mockClient.subscribe.mockImplementation((...args: any[]) => {
            stompCallback = args[1];
            return { unsubscribe: vi.fn() };
        });

        const sub = transport.subscribe('/topic/news', handler);
        expect(mockClient.subscribe).toHaveBeenCalledWith('/topic/news', expect.any(Function));

        stompCallback({ body: 'breaking news' });
        expect(handler).toHaveBeenCalledWith('breaking news');

        sub.unsubscribe();
    });

    it('delivers duplicate STOMP frames with the same message-id only once', () => {
        const handler = vi.fn();
        let stompCallback: (msg: { body: string; headers: Record<string, string> }) => void = () => {};

        mockClient.connected = true;
        mockClient.subscribe.mockImplementation((...args: any[]) => {
            stompCallback = args[1];
            return { unsubscribe: vi.fn() };
        });
        transport.subscribe('/topic/news', handler);

        const frame = { body: 'breaking news', headers: { 'message-id': 'message-1' } };
        stompCallback(frame);
        stompCallback(frame);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('breaking news');
    });

    it('defers client.subscribe while disconnected and unsubscribes stale stompSub before resubscribing on reconnect', () => {
        const handler = vi.fn();
        const firstUnsub = vi.fn();
        const secondUnsub = vi.fn();

        mockClient.connected = false;
        transport.subscribe('/topic/news', handler);
        expect(mockClient.subscribe).not.toHaveBeenCalled();

        mockClient.connected = true;
        mockClient.subscribe.mockReturnValueOnce({ unsubscribe: firstUnsub });
        mockClient.onConnect?.();
        expect(mockClient.subscribe).toHaveBeenCalledTimes(1);

        // If onConnect fires again, previous stompSub should be unsubscribed before overwriting
        mockClient.subscribe.mockReturnValueOnce({ unsubscribe: secondUnsub });
        mockClient.onConnect?.();
        expect(firstUnsub).toHaveBeenCalledTimes(1);
        expect(mockClient.subscribe).toHaveBeenCalledTimes(2);
    });

    it('does not flip status back to reconnecting when onWebSocketClose fires after disconnect()', () => {
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((s) => statusChanges.push(s));

        transport.connect();
        mockClient.connected = true;
        mockClient.onConnect?.();
        expect(statusChanges).toEqual(['connected']);

        transport.disconnect();
        mockClient.connected = false;
        mockClient.onWebSocketClose?.();

        expect(statusChanges).toEqual(['connected', 'disconnected']);
    });

    it('ignores late onConnect after disconnect(), deactivates the client, and does not re-enable reconnects', () => {
        const statusChanges: TransportStatus[] = [];
        transport.onStatusChange((s) => statusChanges.push(s));
        transport.subscribe('/topic/news', vi.fn());

        transport.connect();
        transport.disconnect();
        expect(statusChanges).toEqual(['disconnected']);
        mockClient.deactivate.mockClear();

        // Simulate an in-flight handshake completing after disconnect()
        mockClient.connected = true;
        mockClient.onConnect?.();

        expect(statusChanges).toEqual(['disconnected']);
        expect(mockClient.subscribe).not.toHaveBeenCalled();
        expect(mockClient.deactivate).toHaveBeenCalledTimes(1);

        // Subsequent WebSocket close must not flip status to 'reconnecting'
        mockClient.connected = false;
        mockClient.onWebSocketClose?.();
        expect(statusChanges).toEqual(['disconnected']);
    });

    it('stays connected across connect, disconnect, connect at the beforeConnect microtask boundary', async () => {
        let activationGeneration = 0;
        let beforeConnectCalls = 0;
        let releaseFirstBeforeConnect!: () => void;
        const firstBeforeConnect = new Promise<void>((resolve) => {
            releaseFirstBeforeConnect = resolve;
        });
        const client = {
            active: false,
            connected: false,
            beforeConnect: vi.fn(async () => {
                beforeConnectCalls += 1;
                if (beforeConnectCalls === 1) await firstBeforeConnect;
            }),
            onConnect: vi.fn(),
            activate: vi.fn(() => {
                client.active = true;
                const generation = ++activationGeneration;
                void Promise.resolve().then(async () => {
                    await client.beforeConnect();
                    if (!client.active || generation !== activationGeneration) return;
                    client.connected = true;
                    client.onConnect({});
                });
            }),
            deactivate: vi.fn(() => {
                client.active = false;
                client.connected = false;
                activationGeneration += 1;
            }),
            subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
            publish: vi.fn(),
        };
        const adapter = new StompTransportAdapter(client as unknown as Client);

        adapter.connect();
        await Promise.resolve();
        adapter.disconnect();
        adapter.connect();
        await Promise.resolve();
        await Promise.resolve();
        releaseFirstBeforeConnect();
        await Promise.resolve();
        await Promise.resolve();

        expect(adapter.isConnected()).toBe(true);
        expect(client.connected).toBe(true);
    });

    it('transitions status from reconnecting to disconnected when beforeConnect deactivates on an expired token', async () => {
        const clientWithBeforeConnect = {
            ...mockClient,
            beforeConnect: vi.fn(() => {
                void clientWithBeforeConnect.deactivate();
            }),
        };
        const adapter = new StompTransportAdapter(clientWithBeforeConnect as unknown as Client);
        const statusChanges: TransportStatus[] = [];
        adapter.onStatusChange((s) => statusChanges.push(s));

        adapter.connect();
        clientWithBeforeConnect.connected = true;
        clientWithBeforeConnect.onConnect?.();
        clientWithBeforeConnect.connected = false;
        clientWithBeforeConnect.onWebSocketClose?.();
        expect(statusChanges).toEqual(['connected', 'reconnecting']);

        // Next reconnect attempt triggers beforeConnect, which deactivates the client
        await (clientWithBeforeConnect.beforeConnect as () => Promise<void>)();

        expect(statusChanges).toEqual(['connected', 'reconnecting', 'disconnected']);

        // Subsequent WebSocket close does not re-enter reconnecting
        clientWithBeforeConnect.onWebSocketClose?.();
        expect(statusChanges).toEqual(['connected', 'reconnecting', 'disconnected']);
    });

    it('deactivates client and halts reconnecting when onStompError reports an invalid authorization token', () => {
        const statusChanges: TransportStatus[] = [];
        const errors: string[] = [];
        transport.onStatusChange((s) => statusChanges.push(s));
        transport.onError?.((err) => errors.push(err));

        transport.connect();
        mockClient.onStompError?.({
            headers: { message: 'Invalid WebSocket authorization token' },
            body: '',
        });

        expect(statusChanges).toEqual(['disconnected']);
        expect(mockClient.deactivate).toHaveBeenCalledTimes(1);
        expect(errors).toEqual(['Invalid WebSocket authorization token']);

        // Subsequent onWebSocketClose should not flip status back to reconnecting
        mockClient.onWebSocketClose?.();
        expect(statusChanges).toEqual(['disconnected']);
    });

    it('deactivates with force: true and reactivates client on forceReconnect when deactivate returns a Promise', async () => {
        let resolveDeactivate!: () => void;
        mockClient.forceDisconnect = vi.fn();
        mockClient.deactivate = vi.fn().mockImplementation(
            () => new Promise<void>((resolve) => {
                resolveDeactivate = resolve;
            })
        );

        transport.forceReconnect();

        expect(mockClient.forceDisconnect).toHaveBeenCalledTimes(1);
        expect(mockClient.deactivate).toHaveBeenCalledWith({ force: true });
        expect(mockClient.activate).not.toHaveBeenCalled();

        resolveDeactivate();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockClient.activate).toHaveBeenCalledTimes(1);
    });

    it('publishes messages using client.publish', () => {
        transport.publish('/app/action', JSON.stringify({ action: 'CALL' }));
        expect(mockClient.publish).toHaveBeenCalledWith({
            destination: '/app/action',
            body: JSON.stringify({ action: 'CALL' }),
        });
    });
});
