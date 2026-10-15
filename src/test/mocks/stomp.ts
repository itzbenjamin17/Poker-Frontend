import { vi } from 'vitest';

// Map to store active subscriptions in tests.
export const activeSubscriptions = new Map<
    string,
    (msg: { body: string; headers?: Record<string, string> }) => void
>();

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
    connectHeaders: Record<string, string> = {};
    debug: (message: string) => void = () => {};
    reconnectDelay = 0;

    constructor(config?: Record<string, unknown>) {
        if (config) {
            if (typeof config.beforeConnect === 'function') {
                this.beforeConnect = config.beforeConnect as (client: MockStompClient) => void | Promise<void>;
            }
            if (config.connectHeaders && typeof config.connectHeaders === 'object') {
                this.connectHeaders = config.connectHeaders as Record<string, string>;
            }
            if (typeof config.debug === 'function') {
                this.debug = config.debug as (message: string) => void;
            }
            if (typeof config.reconnectDelay === 'number') {
                this.reconnectDelay = config.reconnectDelay;
            }
        }
    }

    activate() {
        if (this.active) return;
        this.active = true;
        const generation = ++this.generation;
        MockStompClient.activeInstance = this;
        this.connectTimer = setTimeout(async () => {
            await this.beforeConnect(this);
            if (!this.active || generation !== this.generation) return;
            this.connected = true;
            this.onConnect();
        }, 0);
    }

    async deactivate() {
        this.active = false;
        this.connected = false;
        this.generation++;
        clearTimeout(this.connectTimer);
        if (MockStompClient.activeInstance === this) {
            MockStompClient.activeInstance = null;
            activeSubscriptions.clear();
        }
    }

    subscribe(destination: string, callback: (msg: { body: string; headers?: Record<string, string> }) => void) {
        if (!this.connected) throw new Error('No underlying STOMP connection');
        activeSubscriptions.set(destination, callback);
        return {
            unsubscribe: () => {
                activeSubscriptions.delete(destination);
            },
        };
    }

    publish() {
        if (!this.connected) throw new Error('No underlying STOMP connection');
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

    static simulateMessage(destination: string, body: unknown) {
        const callback = activeSubscriptions.get(destination);
        if (callback) {
            callback({ body: JSON.stringify(body) });
        }
    }

    static async waitForSubscription(destination: string) {
        const start = Date.now();
        while (!activeSubscriptions.has(destination)) {
            if (Date.now() - start > 2000) {
                throw new Error(`Timeout waiting for subscription to ${destination}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
}

vi.mock('@stomp/stompjs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@stomp/stompjs')>();
    return {
        ...actual,
        Client: MockStompClient,
    };
});
