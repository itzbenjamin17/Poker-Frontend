import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useElementSize } from '../useElementSize';

describe('useElementSize', () => {
    let originalResizeObserver: typeof ResizeObserver | undefined;

    beforeEach(() => {
        originalResizeObserver = globalThis.ResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
        vi.restoreAllMocks();
    });

    it('returns initial size 0x0 before element is attached', () => {
        const { result } = renderHook(() => useElementSize<HTMLDivElement>());
        expect(result.current.width).toBe(0);
        expect(result.current.height).toBe(0);
        expect(typeof result.current.ref).toBe('function');
    });

    it('measures initial bounding rect when element node is attached', () => {
        const { result } = renderHook(() => useElementSize<HTMLDivElement>());

        const mockElement = document.createElement('div');
        vi.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({
            width: 800,
            height: 400,
            top: 0,
            left: 0,
            bottom: 400,
            right: 800,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        act(() => {
            result.current.ref(mockElement);
        });

        expect(result.current.width).toBe(800);
        expect(result.current.height).toBe(400);
    });

    it('updates size when ResizeObserver callback fires', () => {
        let observerCallback: ResizeObserverCallback | null = null;
        const observeMock = vi.fn();
        const disconnectMock = vi.fn();

        class TestResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                observerCallback = callback;
            }
            observe = observeMock;
            unobserve = vi.fn();
            disconnect = disconnectMock;
        }

        globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

        const { result, unmount } = renderHook(() => useElementSize<HTMLDivElement>());
        const mockElement = document.createElement('div');

        act(() => {
            result.current.ref(mockElement);
        });

        expect(observeMock).toHaveBeenCalledWith(mockElement, { box: 'border-box' });

        // Fire observer callback
        act(() => {
            if (observerCallback) {
                observerCallback(
                    [
                        {
                            target: mockElement,
                            contentRect: {
                                width: 1024,
                                height: 512,
                                top: 0,
                                left: 0,
                                bottom: 512,
                                right: 1024,
                                x: 0,
                                y: 0,
                                toJSON: () => {},
                            },
                        } as unknown as ResizeObserverEntry,
                    ],
                    {} as ResizeObserver
                );
            }
        });

        expect(result.current.width).toBe(1024);
        expect(result.current.height).toBe(512);

        unmount();
        expect(disconnectMock).toHaveBeenCalled();
    });

    it('works defensively when ResizeObserver is undefined', () => {
        // @ts-expect-error test undefined ResizeObserver
        delete globalThis.ResizeObserver;

        const { result } = renderHook(() => useElementSize<HTMLDivElement>());
        const mockElement = document.createElement('div');
        vi.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({
            width: 600,
            height: 300,
            top: 0,
            left: 0,
            bottom: 300,
            right: 600,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        expect(() => {
            act(() => {
                result.current.ref(mockElement);
            });
        }).not.toThrow();

        expect(result.current.width).toBe(600);
        expect(result.current.height).toBe(300);
    });
});
