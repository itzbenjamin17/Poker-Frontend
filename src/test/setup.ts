import '@testing-library/jest-dom'
import { beforeAll, afterEach, afterAll } from 'vitest'
import { activeSubscriptions } from './mocks/stomp'

import.meta.env.VITE_API_BASE_URL = '/api';
import.meta.env.VITE_WS_URL = 'ws://localhost:8080/ws';

if (typeof window !== 'undefined') {
  const { server } = await import('./mocks/server');

  // Start MSW server before all tests
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

  // Reset handlers after each test to ensure test isolation
  afterEach(() => {
    server.resetHandlers()
    activeSubscriptions.clear()
  })

  // Close MSW server after all tests
  afterAll(() => server.close())

  // Global ResizeObserver mock for jsdom test runner
  if (typeof window.ResizeObserver === 'undefined') {
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(_target: Element) { void _target; }
      unobserve(_target: Element) { void _target; }
      disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }
} else {
  afterEach(() => {
    activeSubscriptions.clear()
  })
}

