import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Reports whether a single-line element's text overflows its box. Re-checks on
 * resize and whenever `text` changes (ResizeObserver only sees size changes).
 */
export function useIsTruncated<T extends HTMLElement = HTMLElement>(text: string | undefined) {
    const [element, setElement] = useState<T | null>(null);
    const [truncated, setTruncated] = useState(false);

    const ref = useCallback((node: T | null) => {
        setElement(node);
    }, []);

    useLayoutEffect(() => {
        if (!element) return;
        const check = () => setTruncated(element.scrollWidth > element.clientWidth);
        check();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(check);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, text]);

    return { ref, truncated };
}
