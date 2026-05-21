import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRelativeTime } from '../useRelativeTime'

describe('useRelativeTime', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns recently for null or undefined timestamps', () => {
        const { result } = renderHook(() => useRelativeTime(null))
        expect(result.current).toBe('recently')

        const { result: undefRes } = renderHook(() => useRelativeTime(undefined))
        expect(undefRes.current).toBe('recently')
    })

    it('formats diffs of less than 30s as recently', () => {
        const past = new Date(Date.now() - 10000).toISOString() // 10s ago
        const { result } = renderHook(() => useRelativeTime(past))
        expect(result.current).toBe('recently')
    })

    it('formats diffs between 30s and 60s as just now', () => {
        const past = new Date(Date.now() - 45000).toISOString() // 45s ago
        const { result } = renderHook(() => useRelativeTime(past))
        expect(result.current).toBe('just now')
    })

    it('formats minutes ago correctly', () => {
        const past = new Date(Date.now() - 5 * 60000).toISOString() // 5m ago
        const { result } = renderHook(() => useRelativeTime(past))
        expect(result.current).toBe('5 min ago')
    })

    it('formats hours ago correctly', () => {
        const past1 = new Date(Date.now() - 1 * 60 * 60000).toISOString() // 1h ago
        const { result: res1 } = renderHook(() => useRelativeTime(past1))
        expect(res1.current).toBe('1 hour ago')

        const past2 = new Date(Date.now() - 3 * 60 * 60000).toISOString() // 3h ago
        const { result: res2 } = renderHook(() => useRelativeTime(past2))
        expect(res2.current).toBe('3 hours ago')
    })

    it('formats days ago correctly', () => {
        const past1 = new Date(Date.now() - 25 * 60 * 60000).toISOString() // 1d ago
        const { result: res1 } = renderHook(() => useRelativeTime(past1))
        expect(res1.current).toBe('1 day ago')

        const past2 = new Date(Date.now() - 48 * 60 * 60000).toISOString() // 2d ago
        const { result: res2 } = renderHook(() => useRelativeTime(past2))
        expect(res2.current).toBe('2 days ago')
    })

    it('updates automatically over time', () => {
        const past = new Date(Date.now() - 20000).toISOString() // 20s ago
        const { result } = renderHook(() => useRelativeTime(past))
        expect(result.current).toBe('recently')

        // Advance by a minute
        act(() => {
            vi.advanceTimersByTime(60000)
        })

        // Now it's 80s ago, should say min ago
        expect(result.current).toBe('1 min ago')
    })
})
