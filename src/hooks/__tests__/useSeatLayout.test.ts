import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useSeatLayout } from '../useSeatLayout'

describe('useSeatLayout', () => {
    it('computes screen tier correctly for different widths', () => {
        // 1. Compact: width < 1024
        const { result: compactRes } = renderHook(() => useSeatLayout({ width: 800, height: 600 }))
        expect(compactRes.current.tableTier).toBe('compact')
        expect(compactRes.current.isCompactTable).toBe(true)
        expect(compactRes.current.isWideTable).toBe(false)

        // 2. Standard: 1024 <= width < 1280
        const { result: standardRes } = renderHook(() => useSeatLayout({ width: 1100, height: 700 }))
        expect(standardRes.current.tableTier).toBe('standard')
        expect(standardRes.current.isCompactTable).toBe(false)
        expect(standardRes.current.isWideTable).toBe(false)

        // 3. Wide: width >= 1280
        const { result: wideRes } = renderHook(() => useSeatLayout({ width: 1440, height: 900 }))
        expect(wideRes.current.tableTier).toBe('wide')
        expect(wideRes.current.isCompactTable).toBe(false)
        expect(wideRes.current.isWideTable).toBe(true)
    })

    it('computes continuous scale correctly based on width', () => {
        // 1. width >= 1024 -> scale = 1.0
        const { result: fullRes } = renderHook(() => useSeatLayout({ width: 1200, height: 800 }))
        expect(fullRes.current.scale).toBe(1.0)

        const { result: edgeFullRes } = renderHook(() => useSeatLayout({ width: 1024, height: 800 }))
        expect(edgeFullRes.current.scale).toBe(1.0)

        // 2. 512 < width < 1024 -> scale = width / 1024
        const { result: halfRes } = renderHook(() => useSeatLayout({ width: 768, height: 600 }))
        expect(halfRes.current.scale).toBe(768 / 1024)

        // 3. width <= 512 -> scale = 0.5
        const { result: clampedRes } = renderHook(() => useSeatLayout({ width: 512, height: 400 }))
        expect(clampedRes.current.scale).toBe(0.5)

        const { result: smallRes } = renderHook(() => useSeatLayout({ width: 400, height: 300 }))
        expect(smallRes.current.scale).toBe(0.5)
    })

    it('identifies mobile landscape correctly', () => {
        // Landscape mobile: compact table width, width > height, height <= 520
        const { result } = renderHook(() => useSeatLayout({ width: 900, height: 400 }))
        expect(result.current.isMobileLandscape).toBe(true)

        // Not landscape if height > 520
        const { result: tallRes } = renderHook(() => useSeatLayout({ width: 900, height: 600 }))
        expect(tallRes.current.isMobileLandscape).toBe(false)
    })

    it('always maps index 0 (local player) to bottom-center', () => {
        const { result } = renderHook(() => useSeatLayout({ width: 1100, height: 700 }))
        const pos = result.current.getSeatPosition(0, 4)
        expect(pos.left).toBe(50)
        expect(pos.top).toBe(80) // standard top
        expect(pos.cardPlacement).toBe('right')
    })

    it('maps index 1 in a heads-up game (total 2) to directly across', () => {
        const { result } = renderHook(() => useSeatLayout({ width: 1100, height: 700 }))
        const pos = result.current.getSeatPosition(1, 2)
        expect(pos.left).toBe(50)
        expect(pos.top).toBe(18) // standard top
        expect(pos.cardPlacement).toBe('right')
    })

    it('correctly retrieves static coordinates for standard counts', () => {
        const { result } = renderHook(() => useSeatLayout({ width: 1100, height: 700 }))

        // 3 players
        const pos3_1 = result.current.getSeatPosition(1, 3)
        expect(pos3_1).toEqual({ left: 18, top: 45, cardPlacement: 'below' })

        // 6 players
        const pos6_3 = result.current.getSeatPosition(3, 6)
        expect(pos6_3.left).toBe(50)
        expect(pos6_3.top).toBe(14) // standard top for index 3
    })

    it('falls back to elliptical distribution for 7+ players', () => {
        const { result } = renderHook(() => useSeatLayout({ width: 1100, height: 700 }))

        // 8 players layout should distribute index 1 through 7
        const pos1 = result.current.getSeatPosition(1, 8)
        const pos7 = result.current.getSeatPosition(7, 8)

        expect(pos1.left).not.toBeNaN()
        expect(pos1.top).not.toBeNaN()
        expect(pos7.left).not.toBeNaN()
        expect(pos7.top).not.toBeNaN()
    })
})
