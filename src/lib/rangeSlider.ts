import type { CSSProperties } from 'react';

/**
 * Inline custom properties for a `.range-slider` input (see index.css).
 * WebKit/Blink have no pseudo-element for the filled part of the track, so the
 * fill is drawn from these values. They are set from props rather than typed
 * `attr()`, which Safari does not support.
 */
export function rangeSliderStyle(value: number, min: number, max: number): CSSProperties {
    // An empty range (min === max) would divide by zero in the fill calculation.
    const safeMax = max > min ? max : min + 1;
    return {
        '--control-value': value,
        '--attr-min': min,
        '--attr-max': safeMax,
    } as CSSProperties;
}
