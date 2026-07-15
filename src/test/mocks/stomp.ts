import { vi } from 'vitest'

// Map to store active subscriptions in tests
export const activeSubscriptions = new Map<string, (msg: { body: string }) => void>()

export class MockStompClient {
  static activeInstance: MockStompClient | null = null;
  onConnect: () => void = () => {}
  onWebSocketClose: () => void = () => {}
  onStompError: (frame: { headers: Record<string, string> }) => void = () => {}
  connected = true

  activate() {
    MockStompClient.activeInstance = this;
    setTimeout(() => this.onConnect(), 0);
  }

  deactivate() {
    if (MockStompClient.activeInstance === this) {
      MockStompClient.activeInstance = null;
    }
  }
  
  subscribe(destination: string, callback: (msg: { body: string }) => void) {
    activeSubscriptions.set(destination, callback);
    return { unsubscribe: () => activeSubscriptions.delete(destination) };
  }

  publish() {}

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

  // Helper for tests to simulate an incoming message
  static simulateMessage(destination: string, body: unknown) {
    const callback = activeSubscriptions.get(destination)
    if (callback) {
      callback({ body: JSON.stringify(body) })
    }
  }

  // Helper to wait until a subscription exists
  static async waitForSubscription(destination: string) {
    const start = Date.now()
    while (!activeSubscriptions.has(destination)) {
      if (Date.now() - start > 2000) {
        throw new Error(`Timeout waiting for subscription to ${destination}`)
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

vi.mock('@stomp/stompjs', () => {
  return {
    Client: MockStompClient
  }
})
