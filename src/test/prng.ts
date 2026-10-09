/**
 * Small deterministic PRNG (mulberry32) for property-style tests. Returns a function that yields
 * floats in [0, 1). Tests print the seed they used, so a failing case is reproducible.
 */
export function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Uniform float in [min, max). */
export function randomBetween(random: () => number, min: number, max: number): number {
    return min + random() * (max - min);
}

/** Uniform integer in [min, max] (inclusive). */
export function randomInt(random: () => number, min: number, max: number): number {
    return Math.floor(randomBetween(random, min, max + 1));
}
