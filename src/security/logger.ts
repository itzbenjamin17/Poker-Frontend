/**
 * Centralized logger to gate console output in production.
 */
export const logger = {
    log: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.log(message, ...args);
        }
    },
    warn: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.warn(message, ...args);
        }
    },
    error: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.error(message, ...args);
        }
    },
    debug: (message: string, ...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.debug(message, ...args);
        }
    }
};
