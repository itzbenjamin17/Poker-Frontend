import { describe, it, expect, vi, beforeEach } from 'vitest';
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
        const handler = vi.fn();
        transport.subscribe('/topic/test', handler);

        transport.simulateMessage('/topic/test', JSON.stringify({ a: 1 }));
        expect(handler).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
    });

    it('records published messages and supports inspection and clearing', () => {
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
            activate: vi.fn(),
            deactivate: vi.fn(),
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
        expect(mockClient.deactivate).toHaveBeenCalledTimes(1);
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

    it('subscribes and unwraps incoming STOMP message body', () => {
        const handler = vi.fn();
        let stompCallback: (msg: { body: string }) => void = () => {};

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

    it('publishes messages using client.publish', () => {
        transport.publish('/app/action', JSON.stringify({ action: 'CALL' }));
        expect(mockClient.publish).toHaveBeenCalledWith({
            destination: '/app/action',
            body: JSON.stringify({ action: 'CALL' }),
        });
    });
});
