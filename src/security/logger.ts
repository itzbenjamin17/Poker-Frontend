const SENSITIVE_KEYS = new Set(['token', 'password', 'authorization', 'holecards']);

function redactString(value: string): string {
    if (value.includes('/user/queue/private')) {
        return '[STOMP /user/queue/private frame redacted]';
    }
    return value
        .replace(/Bearer\s+[^\s\n\r"']+/gi, 'Bearer [REDACTED]')
        .replace(/"holeCards"\s*:\s*\[[^\]]*\]/gi, '"holeCards":"[REDACTED]"');
}

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') {
        return redactString(value);
    }
    if (!value || typeof value !== 'object' || value instanceof Error) {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, seen));
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            result[key] = '[REDACTED]';
        } else {
            result[key] = redactValue(val, seen);
        }
    }
    return result;
}

function formatArgs(message: string, args: unknown[]): [string, ...unknown[]] {
    return [redactString(message), ...args.map((arg) => redactValue(arg))];
}

/**
 * Centralized logger to gate console output in production and redact sensitive fields.
 */
export const logger = {
    log: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.log(...formatArgs(message, args));
        }
    },
    warn: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.warn(...formatArgs(message, args));
        }
    },
    error: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.error(...formatArgs(message, args));
        }
    },
    debug: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_STOMP === 'true') {
            console.debug(...formatArgs(message, args));
        }
    },
};
