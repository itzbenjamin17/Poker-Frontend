// @vitest-environment node
import * as stompMock from '../mocks/stomp';
import { Client, ReconnectionTimeMode } from '@stomp/stompjs';
import { describe, expect, it, vi } from 'vitest';

describe('MockStompClient infrastructure', () => {
    it('resolves waitForSubscription without deadlocking under fake timers', async () => {
        vi.useFakeTimers();
        const client = new stompMock.MockStompClient();
        client.activate();
        await vi.advanceTimersByTimeAsync(0);

        const waitPromise = stompMock.MockStompClient.waitForSubscription('/topic/a');
        let resolved = false;
        void waitPromise.then(() => {
            resolved = true;
        });

        client.subscribe('/topic/a', () => {});
        await waitPromise;
        expect(resolved).toBe(true);
    });

    it('records published frames and passes raw strings, serialized objects, and headers in simulateMessage', async () => {
        const client = new Client() as unknown as stompMock.MockStompClient;
        expect(client).toBeInstanceOf(stompMock.MockStompClient);

        client.activate();
        await vi.waitFor(() => expect(client.connected).toBe(true));

        client.publish({
            destination: '/app/1/action',
            body: JSON.stringify({ action: 'CHECK' }),
            headers: { 'x-test': '1' },
        });
        expect(client.publishedFrames).toEqual([
            {
                destination: '/app/1/action',
                body: JSON.stringify({ action: 'CHECK' }),
                headers: { 'x-test': '1' },
            },
        ]);

        const received: Array<{ body: string; headers?: Record<string, string> }> = [];
        client.subscribe('/game/1', (msg) => received.push(msg));

        stompMock.MockStompClient.simulateMessage('/game/1', '{"raw":true}', { 'message-id': 'm-1' });
        stompMock.MockStompClient.simulateMessage('/game/1', { parsed: true }, { 'message-id': 'm-2' });

        expect(received).toEqual([
            { body: '{"raw":true}', headers: { 'message-id': 'm-1' } },
            { body: '{"parsed":true}', headers: { 'message-id': 'm-2' } },
        ]);
    });

    it('prevents a stale unsubscribe() from removing a newer subscriber on the same destination', async () => {
        const client = new stompMock.MockStompClient();
        client.activate();
        await vi.waitFor(() => expect(client.connected).toBe(true));

        const calls1: string[] = [];
        const calls2: string[] = [];
        const sub1 = client.subscribe('/room/1', (msg) => calls1.push(msg.body));
        client.subscribe('/room/1', (msg) => calls2.push(msg.body));

        sub1.unsubscribe();
        stompMock.MockStompClient.simulateMessage('/room/1', { ping: 1 });

        expect(calls1).toEqual([]);
        expect(calls2).toEqual(['{"ping":1}']);
    });

    it('resets activeInstance, pending connectTimer, and subscriptions via resetMockStomp()', () => {
        const onConnect = vi.fn();
        const client = new stompMock.MockStompClient();
        client.onConnect = onConnect;
        client.activate();

        expect(stompMock.MockStompClient.activeInstance).toBe(client);

        stompMock.resetMockStomp();

        expect(stompMock.MockStompClient.activeInstance).toBeNull();
        expect(stompMock.activeSubscriptions.size).toBe(0);
    });

    it('automatically resets MockStompClient state between tests', () => {
        expect(stompMock.MockStompClient.activeInstance).toBeNull();
        expect(stompMock.activeSubscriptions.size).toBe(0);
    });

    it('propagates StompConfig options, surfaces beforeConnect errors, and supports forceDisconnect and deactivate', async () => {
        const error = new Error('boom');
        const onWebSocketError = vi.fn();
        const onWebSocketClose = vi.fn();

        const client = new stompMock.MockStompClient({
            brokerURL: 'ws://example.test/ws',
            reconnectDelay: 2500,
            reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
            maxReconnectDelay: 30000,
            connectionTimeout: 15000,
            discardWebsocketOnCommFailure: true,
            connectHeaders: { Authorization: 'Bearer tok' },
            beforeConnect: () => {
                throw error;
            },
        });
        client.onWebSocketError = onWebSocketError;
        client.onWebSocketClose = onWebSocketClose;

        expect(client.brokerURL).toBe('ws://example.test/ws');
        expect(client.reconnectDelay).toBe(2500);
        expect(client.reconnectTimeMode).toBe(ReconnectionTimeMode.EXPONENTIAL);
        expect(client.maxReconnectDelay).toBe(30000);
        expect(client.connectionTimeout).toBe(15000);
        expect(client.discardWebsocketOnCommFailure).toBe(true);
        expect(client.connectHeaders).toEqual({ Authorization: 'Bearer tok' });

        client.activate();
        await vi.waitFor(() => expect(onWebSocketError).toHaveBeenCalledWith(error));

        client.connected = true;
        client.forceDisconnect();
        expect(client.connected).toBe(false);
        expect(onWebSocketClose).toHaveBeenCalledTimes(1);

        await client.deactivate({ force: true });
        expect(client.active).toBe(false);
        expect(stompMock.MockStompClient.activeInstance).toBeNull();
    });
});
