import { useState, useCallback, useLayoutEffect } from 'react';

export interface ElementSize {
    width: number;
    height: number;
}

/**
 * Measures an element's border box. The first measurement and every
 * ResizeObserver update use the same box so first paint and later resizes agree.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
    const [element, setElement] = useState<T | null>(null);

    const ref = useCallback((node: T | null) => {
        setElement(node);
    }, []);

    useLayoutEffect(() => {
        if (!element) return;

        const update = (next: ElementSize) => {
            setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        };

        // Initial measurement (border box)
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
            update({ width: rect.width, height: rect.height });
        }

        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const entry = entries[0];
            const borderBox = entry.borderBoxSize?.[0];
            if (borderBox && (borderBox.inlineSize > 0 || borderBox.blockSize > 0)) {
                update({ width: borderBox.inlineSize, height: borderBox.blockSize });
                return;
            }
            const width = entry.contentRect.width || (entry.target as HTMLElement).clientWidth || 0;
            const height = entry.contentRect.height || (entry.target as HTMLElement).clientHeight || 0;
            update({ width, height });
        });

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [element]);

    return { ref, width: size.width, height: size.height };
}
