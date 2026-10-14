import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test';

export interface StompMockController {
    sendMessage: (destination: string, payload: unknown) => void;
    sendError: (message: string) => void;
    waitForSubscription: (destination: string, timeoutMs?: number) => Promise<string>;
    close: () => void;
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
    const subscriptions = new Map<string, string>(); // destination -> subId
    const subscriptionResolvers = new Map<string, (subId: string) => void>();

    await target.routeWebSocket(/.*\/ws.*/, (ws) => {
        subscriptions.clear();
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
                    subscriptions.set(destination, id);
                    const resolver = subscriptionResolvers.get(destination);
                    if (resolver) {
                        resolver(id);
                        subscriptionResolvers.delete(destination);
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
                        for (const [dest, subId] of subscriptions.entries()) {
                            if (subId === id) {
                                subscriptions.delete(dest);
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
            if (activeWs === ws) {
                activeWs = null;
                subscriptions.clear();
            }
        });
    });

    return {
        sendMessage(destination: string, payload: unknown) {
            if (!activeWs) throw new Error('No active mock WebSocket');
            const subId = subscriptions.get(destination);
            if (!subId) throw new Error(`No subscription for ${destination}`);
            const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const msgId = `msg-${messageIdCounter++}`;
            const frame = `MESSAGE\ndestination:${destination}\nsubscription:${subId}\nmessage-id:${msgId}\ncontent-type:application/json\n\n${body}\0`;
            activeWs.send(frame);
        },

        sendError(errorMessage: string) {
            if (!activeWs) throw new Error('No active mock WebSocket');
            const frame = `ERROR\nmessage:${errorMessage}\n\n${errorMessage}\0`;
            activeWs.send(frame);
        },

        async waitForSubscription(destination: string, timeoutMs = 5000): Promise<string> {
            if (subscriptions.has(destination)) {
                return subscriptions.get(destination)!;
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    subscriptionResolvers.delete(destination);
                    reject(new Error(`Timeout waiting for STOMP subscription to ${destination}`));
                }, timeoutMs);

                subscriptionResolvers.set(destination, (subId) => {
                    clearTimeout(timer);
                    resolve(subId);
                });
            });
        },

        close() {
            subscriptions.clear();
            if (activeWs) {
                activeWs.close();
                activeWs = null;
            }
        },
    };
}
