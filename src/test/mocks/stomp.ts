import type { ReconnectionTimeMode, StompConfig } from '@stomp/stompjs';
import { afterEach, vi } from 'vitest';

export type StompMessageCallback = (msg: { body: string; headers?: Record<string, string> }) => void;

export interface PublishedStompFrame {
    destination: string;
    body?: string;
    headers?: Record<string, string>;
}

interface PendingSubscriptionWaiter {
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
}

// Map to store active subscriptions in tests.
export const activeSubscriptions = new Map<string, StompMessageCallback>();

const destinationSubscribers = new Map<string, Set<StompMessageCallback>>();
const subscriptionWaiters = new Map<string, PendingSubscriptionWaiter[]>();

export function resetMockStomp(): void {
    const active = MockStompClient.activeInstance;
    if (active) {
        active.cancelPendingTimers();
        active.active = false;
        active.connected = false;
        MockStompClient.activeInstance = null;
    }
    for (const waiters of subscriptionWaiters.values()) {
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
        }
    }
    subscriptionWaiters.clear();
    destinationSubscribers.clear();
    activeSubscriptions.clear();
}

afterEach(() => {
    resetMockStomp();
});

export class MockStompClient {
    static activeInstance: MockStompClient | null = null;
    onConnect: () => void = () => {};
    onStompError: (frame: { headers: Record<string, string>; body: string }) => void = () => {};
    onWebSocketClose: () => void = () => {};
    onWebSocketError: (evt: unknown) => void = () => {};
    beforeConnect: (client: MockStompClient) => void | Promise<void> = () => {};
    connected = false;
    public active = false;
    private generation = 0;
    private connectTimer: ReturnType<typeof setTimeout> | undefined;
    brokerURL?: string;
    connectHeaders: Record<string, string> = {};
    debug: (message: string) => void = () => {};
    reconnectDelay = 0;
    reconnectTimeMode?: ReconnectionTimeMode;
    maxReconnectDelay = 0;
    connectionTimeout = 0;
    discardWebsocketOnCommFailure = false;
    publishedFrames: PublishedStompFrame[] = [];

    constructor(config?: StompConfig) {
        if (config) {
            if (typeof config.brokerURL === 'string') {
                this.brokerURL = config.brokerURL;
            }
            if (typeof config.beforeConnect === 'function') {
                this.beforeConnect = config.beforeConnect as unknown as (client: MockStompClient) => void | Promise<void>;
            }
            if (config.connectHeaders && typeof config.connectHeaders === 'object') {
                this.connectHeaders = { ...config.connectHeaders };
            }
            if (typeof config.debug === 'function') {
                this.debug = config.debug;
            }
            if (typeof config.reconnectDelay === 'number') {
                this.reconnectDelay = config.reconnectDelay;
            }
            if (config.reconnectTimeMode !== undefined) {
                this.reconnectTimeMode = config.reconnectTimeMode;
            }
            if (typeof config.maxReconnectDelay === 'number') {
                this.maxReconnectDelay = config.maxReconnectDelay;
            }
            if (typeof config.connectionTimeout === 'number') {
                this.connectionTimeout = config.connectionTimeout;
            }
            if (typeof config.discardWebsocketOnCommFailure === 'boolean') {
                this.discardWebsocketOnCommFailure = config.discardWebsocketOnCommFailure;
            }
        }
    }

    cancelPendingTimers(): void {
        clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
    }

    activate() {
        if (this.active) return;
        this.active = true;
        const generation = ++this.generation;
        MockStompClient.activeInstance = this;
        this.connectTimer = setTimeout(async () => {
            this.connectTimer = undefined;
            try {
                await this.beforeConnect(this);
            } catch (err) {
                this.onWebSocketError(err);
                return;
            }
            if (!this.active || generation !== this.generation) return;
            this.connected = true;
            this.onConnect();
        }, 0);
    }

    async deactivate(_options?: { force?: boolean }) {
        void _options;
        this.active = false;
        this.connected = false;
        this.generation++;
        this.cancelPendingTimers();
        if (MockStompClient.activeInstance === this) {
            MockStompClient.activeInstance = null;
            destinationSubscribers.clear();
            activeSubscriptions.clear();
        }
    }

    forceDisconnect(): void {
        this.connected = false;
        this.cancelPendingTimers();
        this.onWebSocketClose();
    }

    subscribe(destination: string, callback: StompMessageCallback) {
        if (!this.connected) throw new Error('No underlying STOMP connection');
        let callbacks = destinationSubscribers.get(destination);
        if (!callbacks) {
            callbacks = new Set();
            destinationSubscribers.set(destination, callbacks);
        }
        callbacks.add(callback);
        activeSubscriptions.set(destination, callback);

        const waiters = subscriptionWaiters.get(destination);
        if (waiters) {
            subscriptionWaiters.delete(destination);
            for (const waiter of waiters) {
                clearTimeout(waiter.timer);
                waiter.resolve();
            }
        }

        return {
            unsubscribe: () => {
                const currentCallbacks = destinationSubscribers.get(destination);
                if (!currentCallbacks) return;
                currentCallbacks.delete(callback);
                if (currentCallbacks.size === 0) {
                    destinationSubscribers.delete(destination);
                    activeSubscriptions.delete(destination);
                } else if (activeSubscriptions.get(destination) === callback) {
                    const remaining = [...currentCallbacks];
                    activeSubscriptions.set(destination, remaining[remaining.length - 1]);
                }
            },
        };
    }

    publish(params?: PublishedStompFrame) {
        if (!this.connected) throw new Error('No underlying STOMP connection');
        if (params) {
            this.publishedFrames.push(params);
        }
    }

    static simulateDisconnect() {
        if (MockStompClient.activeInstance) {
            MockStompClient.activeInstance.connected = false;
            MockStompClient.activeInstance.onWebSocketClose();
        }
    }

    static simulateConnect() {
        if (MockStompClient.activeInstance) {
            MockStompClient.activeInstance.connected = true;
            MockStompClient.activeInstance.onConnect();
        }
    }

    static simulateStompError(frame: { headers?: Record<string, string>; body?: string } = {}) {
        if (MockStompClient.activeInstance) {
            MockStompClient.activeInstance.connected = false;
            MockStompClient.activeInstance.onStompError({
                headers: frame.headers ?? {},
                body: frame.body ?? '',
            });
        }
    }

    static simulateMessage(destination: string, body: unknown, headers?: Record<string, string>) {
        if (!activeSubscriptions.has(destination)) return;
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        const message = headers ? { body: payload, headers } : { body: payload };
        const callbacks = destinationSubscribers.get(destination);
        if (!callbacks) return;
        for (const callback of [...callbacks]) {
            callback(message);
        }
    }

    static waitForSubscription(destination: string, timeoutMs = 2000): Promise<void> {
        if (activeSubscriptions.has(destination)) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const entry: PendingSubscriptionWaiter = {
                resolve: () => resolve(),
                timer: setTimeout(() => {
                    const list = subscriptionWaiters.get(destination);
                    if (list) {
                        const idx = list.indexOf(entry);
                        if (idx !== -1) list.splice(idx, 1);
                        if (list.length === 0) subscriptionWaiters.delete(destination);
                    }
                    reject(new Error(`Timeout waiting for subscription to ${destination}`));
                }, timeoutMs),
            };
            const existing = subscriptionWaiters.get(destination) ?? [];
            existing.push(entry);
            subscriptionWaiters.set(destination, existing);
        });
    }
}

vi.mock('@stomp/stompjs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@stomp/stompjs')>();
    return {
        ...actual,
        Client: MockStompClient,
    };
});
