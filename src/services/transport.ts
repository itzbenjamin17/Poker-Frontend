import { Client } from '@stomp/stompjs';
import type { IMessage } from '@stomp/stompjs';
import { createStompClient } from './api';
import { logger } from '../security/logger';

export type TransportStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface TransportSubscription {
    unsubscribe: () => void;
}

export interface GameTransport {
    connect(): void;
    disconnect(): void;
    forceReconnect?(): void;
    subscribe(destination: string, handler: (message: string) => void): TransportSubscription;
    publish(destination: string, body: string): void;
    onStatusChange(listener: (status: TransportStatus) => void): () => void;
    onError?(listener: (error: string) => void): () => void;
    isConnected?(): boolean;
}

/**
 * Production adapter wrapping the @stomp/stompjs Client behind the GameTransport port.
 */
export class StompTransportAdapter implements GameTransport {
    private client: Client;
    private statusListeners: Set<(status: TransportStatus) => void> = new Set();
    private errorListeners: Set<(error: string) => void> = new Set();
    private currentStatus: TransportStatus = 'disconnected';
    private isActive = true;
    private lifecycleGeneration = 0;
    private seenFrames = new Map<number, Set<string>>();
    private nextSubId = 1;
    private subscriptions: Map<
        number,
        {
            destination: string;
            handler: (message: string) => void;
            stompSub?: { unsubscribe: () => void };
        }
    > = new Map();

    constructor(clientOrToken: Client | string) {
        if (typeof clientOrToken === 'string') {
            this.client = createStompClient(clientOrToken);
        } else {
            this.client = clientOrToken;
        }

        this.setupClientCallbacks();
    }

    public getClient(): Client {
        return this.client;
    }

    private setupClientCallbacks(): void {
        const existingBeforeConnect = this.client.beforeConnect;
        this.client.beforeConnect = async () => {
            const generation = this.lifecycleGeneration;
            await existingBeforeConnect?.(this.client);
            if (generation === this.lifecycleGeneration && !this.client.active) {
                this.isActive = false;
                this.setStatus('disconnected');
            }
        };

        this.client.onConnect = () => {
            if (!this.isActive) {
                void this.client.deactivate();
                return;
            }
            logger.log('Connected to WebSocket');
            this.resubscribeAll();
            this.setStatus('connected');
        };

        this.client.onWebSocketClose = () => {
            this.seenFrames.clear();
            for (const entry of this.subscriptions.values()) {
                entry.stompSub = undefined;
            }
            if (!this.isActive) return;
            logger.warn('WebSocket closed — will reconnect automatically');
            this.setStatus('reconnecting');
        };

        this.client.onStompError = (frame) => {
            const errorMsg = frame?.headers?.['message'] || frame?.body || 'STOMP transport error';
            logger.warn('STOMP error:', errorMsg);
            if (/authorization token|unauthorized|expired|invalid.*token/i.test(errorMsg)) {
                this.isActive = false;
                this.setStatus('disconnected');
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    const authorization = this.client.connectHeaders?.Authorization;
                    const token = authorization?.startsWith('Bearer ')
                        ? authorization.slice(7)
                        : undefined;
                    if (token) {
                        window.dispatchEvent(new CustomEvent('auth-expired', { detail: { token } }));
                    }
                }
                void this.client.deactivate();
                this.notifyError(errorMsg);
                return;
            }
            this.setStatus('reconnecting');
            this.notifyError(errorMsg);
        };
    }

    private resubscribeAll(): void {
        for (const [id, entry] of this.subscriptions) {
            entry.stompSub?.unsubscribe();
            entry.stompSub = this.client.subscribe(entry.destination, (msg) => {
                this.deliver(id, msg, entry.handler);
            });
        }
    }

    private deliver(id: number, message: IMessage, handler: (body: string) => void): void {
        const messageId = message.headers?.['message-id'];
        if (messageId) {
            let seen = this.seenFrames.get(id);
            if (!seen) {
                seen = new Set();
                this.seenFrames.set(id, seen);
            }
            if (seen.has(messageId)) return;
            seen.add(messageId);
            if (seen.size > 1024) {
                const oldest = seen.values().next().value;
                if (oldest !== undefined) seen.delete(oldest);
            }
        }
        handler(message.body);
    }

    private setStatus(status: TransportStatus): void {
        this.currentStatus = status;
        for (const listener of this.statusListeners) {
            listener(status);
        }
    }

    private notifyError(errorMessage: string): void {
        for (const listener of this.errorListeners) {
            listener(errorMessage);
        }
    }

    public connect(): void {
        this.lifecycleGeneration += 1;
        this.isActive = true;
        this.client.activate();
    }

    public forceReconnect(): void {
        this.lifecycleGeneration += 1;
        this.isActive = true;
        if (typeof (this.client as unknown as { forceDisconnect?: () => void }).forceDisconnect === 'function') {
            (this.client as unknown as { forceDisconnect: () => void }).forceDisconnect();
        }
        if (typeof this.client.deactivate === 'function') {
            const result = this.client.deactivate({ force: true }) as Promise<void> | undefined;
            if (result && typeof result.then === 'function') {
                void result.finally(() => {
                    if (this.isActive) {
                        this.client.activate();
                    }
                });
                return;
            }
        }
        this.client.activate();
    }

    public disconnect(): void {
        this.lifecycleGeneration += 1;
        this.isActive = false;
        this.setStatus('disconnected');
        for (const entry of this.subscriptions.values()) {
            if (entry.stompSub && this.client.connected) {
                entry.stompSub.unsubscribe();
            }
            entry.stompSub = undefined;
        }
        void this.client.deactivate({ force: true });
    }

    public subscribe(destination: string, handler: (message: string) => void): TransportSubscription {
        const id = this.nextSubId++;
        const entry: {
            destination: string;
            handler: (message: string) => void;
            stompSub?: { unsubscribe: () => void };
        } = {
            destination,
            handler,
        };

        if (this.client.connected) {
            try {
                entry.stompSub = this.client.subscribe(destination, (msg) => {
                    this.deliver(id, msg, handler);
                });
            } catch {
                // If client is not yet connected, resubscribeAll will subscribe on onConnect
            }
        }

        this.subscriptions.set(id, entry);

        return {
            unsubscribe: () => {
                const subEntry = this.subscriptions.get(id);
                if (subEntry) {
                    if (subEntry.stompSub) {
                        subEntry.stompSub.unsubscribe();
                    }
                    this.subscriptions.delete(id);
                    this.seenFrames.delete(id);
                }
            },
        };
    }

    public publish(destination: string, body: string): void {
        this.client.publish({ destination, body });
    }

    public onStatusChange(listener: (status: TransportStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public onError(listener: (error: string) => void): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    public isConnected(): boolean {
        return this.currentStatus === 'connected' && Boolean(this.client.connected);
    }
}

/**
 * In-memory adapter for deterministic packet injection and inspection during testing.
 */
export class InMemoryTransportAdapter implements GameTransport {
    private currentStatus: TransportStatus = 'disconnected';
    private subscriptions: Map<string, Set<(message: string) => void>> = new Map();
    private publishedMessages: Array<{ destination: string; body: string }> = [];
    private statusListeners: Set<(status: TransportStatus) => void> = new Set();
    private errorListeners: Set<(error: string) => void> = new Set();

    public connect(): void {
        this.setStatus('connected');
    }

    public disconnect(): void {
        this.setStatus('disconnected');
    }

    public subscribe(destination: string, handler: (message: string) => void): TransportSubscription {
        let handlers = this.subscriptions.get(destination);
        if (!handlers) {
            handlers = new Set();
            this.subscriptions.set(destination, handlers);
        }
        handlers.add(handler);

        return {
            unsubscribe: () => {
                const currentHandlers = this.subscriptions.get(destination);
                if (currentHandlers) {
                    currentHandlers.delete(handler);
                    if (currentHandlers.size === 0) {
                        this.subscriptions.delete(destination);
                    }
                }
            },
        };
    }

    public publish(destination: string, body: string): void {
        if (!this.isConnected()) throw new Error('Transport is not connected');
        this.publishedMessages.push({ destination, body });
    }

    public onStatusChange(listener: (status: TransportStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public onError(listener: (error: string) => void): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    public isConnected(): boolean {
        return this.currentStatus === 'connected';
    }

    private setStatus(status: TransportStatus): void {
        this.currentStatus = status;
        for (const listener of this.statusListeners) {
            listener(status);
        }
    }

    // ── Inspection & Simulation Helpers ───────────────────────────────────────────

    public simulateMessage(destination: string, body: unknown): void {
        if (!this.isConnected()) return;
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        const handlers = this.subscriptions.get(destination);
        if (handlers) {
            for (const handler of handlers) {
                handler(payload);
            }
        }
    }

    public simulateStatus(status: TransportStatus): void {
        this.setStatus(status);
    }

    public simulateError(errorMessage: string): void {
        for (const listener of this.errorListeners) {
            listener(errorMessage);
        }
    }

    public getPublishedMessages(destination?: string): Array<{ destination: string; body: string }> {
        if (destination) {
            return this.publishedMessages.filter((m) => m.destination === destination);
        }
        return [...this.publishedMessages];
    }

    public clearPublishedMessages(): void {
        this.publishedMessages = [];
    }

    public getSubscriptions(): Map<string, Set<(message: string) => void>> {
        return new Map(this.subscriptions);
    }
}
