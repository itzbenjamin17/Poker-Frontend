import '@testing-library/jest-dom'
import { beforeAll, afterEach, afterAll } from 'vitest'
import { server } from './mocks/server'
import { activeSubscriptions } from './mocks/stomp'

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers()
  activeSubscriptions.clear()
})

// Close MSW server after all tests
afterAll(() => server.close())
