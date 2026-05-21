import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useNotification } from '../useNotification'

describe('useNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initially returns null notification', () => {
    const { result } = renderHook(() => useNotification())
    expect(result.current.notification).toBeNull()
  })

  it('sets a notification and clears it automatically after autoDismissMs', () => {
    const { result } = renderHook(() => useNotification())

    act(() => {
      result.current.setNotification('Hello world', 2000)
    })

    expect(result.current.notification).toBe('Hello world')

    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(result.current.notification).toBe('Hello world')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.notification).toBeNull()
  })

  it('can clear notification manually and reset timers', () => {
    const { result } = renderHook(() => useNotification())

    act(() => {
      result.current.setNotification('Transient Alert', 5000)
    })
    expect(result.current.notification).toBe('Transient Alert')

    act(() => {
      result.current.clearNotification()
    })
    expect(result.current.notification).toBeNull()

    // advance time to make sure timer doesn't crash or re-clear
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.notification).toBeNull()
  })

  it('overwrites previous notification and resets timer', () => {
    const { result } = renderHook(() => useNotification())

    act(() => {
      result.current.setNotification('First Message', 3000)
    })
    expect(result.current.notification).toBe('First Message')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.notification).toBe('First Message')

    // Set new message, resetting timer to 3000
    act(() => {
      result.current.setNotification('Second Message', 3000)
    })
    expect(result.current.notification).toBe('Second Message')

    // Advance 2000 ms - should still be there because timer was reset
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.notification).toBe('Second Message')

    // Advance remaining 1000 ms - should dismiss
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.notification).toBeNull()
  })
})
