import { vi } from 'vitest'

// Map to store active subscriptions in tests
export const activeSubscriptions = new Map<string, (msg: { body: string }) => void>()

export class MockStompClient {
  onConnect: () => void = () => {}
  connected = true

  activate = vi.fn(() => {
    // Simulate connection
    setTimeout(() => this.onConnect(), 0)
  })

  deactivate = vi.fn()
  
  subscribe = vi.fn((destination: string, callback: (msg: { body: string }) => void) => {
    activeSubscriptions.set(destination, callback)
    return { unsubscribe: () => activeSubscriptions.delete(destination) }
  })

  publish = vi.fn()

  // Helper for tests to simulate an incoming message
  static simulateMessage(destination: string, body: any) {
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
