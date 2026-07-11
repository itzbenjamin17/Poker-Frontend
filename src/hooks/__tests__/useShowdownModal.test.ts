import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useShowdownModal } from '../useShowdownModal';

describe('useShowdownModal', () => {
    beforeEach(() => {
        vi.stubGlobal('innerWidth', 1000);
        vi.stubGlobal('innerHeight', 800);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('manages and resets layout state', () => {
        const { result } = renderHook(() => useShowdownModal());

        expect(result.current.layout).toBeNull();

        act(() => {
            result.current.setLayout({ x: 100, y: 100, width: 300, height: 200 });
        });

        expect(result.current.layout).toEqual({ x: 100, y: 100, width: 300, height: 200 });

        act(() => {
            result.current.resetLayout();
        });

        expect(result.current.layout).toBeNull();
    });

    it('handles window resize by clamping current layout', () => {
        const { result } = renderHook(() => useShowdownModal());

        act(() => {
            result.current.setLayout({ x: 900, y: 700, width: 300, height: 200 });
        });

        // Resize window to be smaller
        vi.stubGlobal('innerWidth', 500);
        vi.stubGlobal('innerHeight', 400);

        act(() => {
            result.current.onWindowResize();
        });

        // Clamped: width capped at MAX_WIDTH_PX (520) but also at innerWidth-24 (476)
        // x must fit within innerWidth - width - 12
        expect(result.current.layout?.width).toBeLessThanOrEqual(476);
        expect(result.current.layout?.height).toBeLessThanOrEqual(376);
    });

    it('manages drag pointer down interaction', () => {
        const { result } = renderHook(() => useShowdownModal());

        // Setup mock div element and event
        const mockSetPointerCapture = vi.fn();
        const mockPointerEvent = {
            pointerType: 'mouse',
            button: 0,
            pointerId: 1,
            clientX: 150,
            clientY: 150,
            currentTarget: {
                setPointerCapture: mockSetPointerCapture,
            },
            preventDefault: vi.fn(),
        } as unknown as import('react').PointerEvent<HTMLDivElement>;

        // Mock getBoundingClientRect on modalRef
        const mockModalDiv = {
            getBoundingClientRect: () => ({
                left: 100,
                top: 100,
                width: 300,
                height: 200,
            }),
        } as unknown as HTMLDivElement;

        result.current.modalRef.current = mockModalDiv;

        act(() => {
            result.current.onDragPointerDown(mockPointerEvent);
        });

        expect(mockSetPointerCapture).toHaveBeenCalledWith(1);
    });
});
