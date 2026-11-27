import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test';

export interface StompMockController {
    sendMessage: (destination: string, payload: unknown) => void;
    sendError: (message: string) => void;
    waitForSubscription: (destination: string, timeoutMs?: number) => Promise<string>;
    close: () => void;
}

interface SubscriptionWaiter {
    resolve: (subId: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Intercepts browser STOMP WebSocket connections via Playwright native routeWebSocket.
 * Eliminates the need for any in-app backdoor flags.
 */
export async function setupStompWebSocketMock(
    target: Page | BrowserContext,
): Promise<StompMockController> {
    let activeWs: WebSocketRoute | null = null;
    let messageIdCounter = 1;
    const openSockets = new Set<WebSocketRoute>();
    const socketSubscriptions = new Map<WebSocketRoute, Map<string, string>>();
    const subscriptionWaiters = new Map<string, SubscriptionWaiter[]>();

    const findSubscription = (destination: string): { ws: WebSocketRoute; subId: string } | null => {
        if (activeWs && openSockets.has(activeWs)) {
            const activeSubId = socketSubscriptions.get(activeWs)?.get(destination);
            if (activeSubId) {
                return { ws: activeWs, subId: activeSubId };
            }
        }
        for (const ws of openSockets) {
            const subId = socketSubscriptions.get(ws)?.get(destination);
            if (subId) {
                return { ws, subId };
            }
        }
        return null;
    };

    const removeWaiter = (destination: string, waiter: SubscriptionWaiter) => {
        const waiters = subscriptionWaiters.get(destination);
        if (!waiters) return;
        const nextWaiters = waiters.filter((entry) => entry !== waiter);
        if (nextWaiters.length === 0) {
            subscriptionWaiters.delete(destination);
        } else {
            subscriptionWaiters.set(destination, nextWaiters);
        }
    };

    await target.routeWebSocket(/.*\/ws.*/, (ws) => {
        openSockets.add(ws);
        const wsSubs = new Map<string, string>();
        socketSubscriptions.set(ws, wsSubs);
        activeWs = ws;

        ws.onMessage((message) => {
            const raw = typeof message === 'string' ? message : message.toString('utf-8');

            // Heartbeat ping (single \n or \r\n)
            if (raw === '\n' || raw === '\r\n') {
                return;
            }

            // STOMP CONNECT frame
            if (raw.startsWith('CONNECT') || raw.startsWith('STOMP')) {
                ws.send('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');
                return;
            }

            // STOMP SUBSCRIBE frame
            if (raw.startsWith('SUBSCRIBE')) {
                const lines = raw.split(/\r?\n/);
                let id = '';
                let destination = '';
                for (const line of lines) {
                    if (line.startsWith('id:')) {
                        id = line.substring(3).trim();
                    } else if (line.startsWith('destination:')) {
                        destination = line.substring(12).trim();
                    }
                }
                if (destination && id) {
                    wsSubs.set(destination, id);
                    const waiters = subscriptionWaiters.get(destination);
                    if (waiters) {
                        subscriptionWaiters.delete(destination);
                        for (const waiter of waiters) {
                            clearTimeout(waiter.timer);
                            waiter.resolve(id);
                        }
                    }
                }
                return;
            }

            // STOMP UNSUBSCRIBE frame
            if (raw.startsWith('UNSUBSCRIBE')) {
                const lines = raw.split(/\r?\n/);
                for (const line of lines) {
                    if (line.startsWith('id:')) {
                        const id = line.substring(3).trim();
                        for (const [dest, subId] of wsSubs.entries()) {
                            if (subId === id) {
                                wsSubs.delete(dest);
                                break;
                            }
                        }
                    }
                }
                return;
            }

            // STOMP DISCONNECT frame
            if (raw.startsWith('DISCONNECT')) {
                return;
            }
        });

        ws.onClose(() => {
            openSockets.delete(ws);
            socketSubscriptions.delete(ws);
            if (activeWs === ws) {
                activeWs = Array.from(openSockets).pop() ?? null;
            }
        });
    });

    return {
        sendMessage(destination: string, payload: unknown) {
            if (openSockets.size === 0) throw new Error('No active mock WebSocket');
            const match = findSubscription(destination);
            if (!match) throw new Error(`No subscription for ${destination}`);
            const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const msgId = `msg-${messageIdCounter++}`;
            const frame = `MESSAGE\ndestination:${destination}\nsubscription:${match.subId}\nmessage-id:${msgId}\ncontent-type:application/json\n\n${body}\0`;
            match.ws.send(frame);
        },

        sendError(errorMessage: string) {
            if (!activeWs) throw new Error('No active mock WebSocket');
            const frame = `ERROR\nmessage:${errorMessage}\n\n${errorMessage}\0`;
            activeWs.send(frame);
        },

        async waitForSubscription(destination: string, timeoutMs = 5000): Promise<string> {
            const existing = findSubscription(destination);
            if (existing) {
                return existing.subId;
            }
            return new Promise((resolve, reject) => {
                const waiter: SubscriptionWaiter = {
                    resolve,
                    reject,
                    timer: setTimeout(() => {
                        removeWaiter(destination, waiter);
                        reject(new Error(`Timeout waiting for STOMP subscription to ${destination}`));
                    }, timeoutMs),
                };

                const existingWaiters = subscriptionWaiters.get(destination) ?? [];
                existingWaiters.push(waiter);
                subscriptionWaiters.set(destination, existingWaiters);
            });
        },

        close() {
            for (const [, waiters] of subscriptionWaiters.entries()) {
                for (const waiter of waiters) {
                    clearTimeout(waiter.timer);
                    waiter.reject(new Error('STOMP mock closed before subscription completed'));
                }
            }
            subscriptionWaiters.clear();
            for (const ws of openSockets) {
                ws.close();
            }
            openSockets.clear();
            socketSubscriptions.clear();
            activeWs = null;
        },
    };
}
