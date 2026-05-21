import { useCallback, useRef, useState } from 'react';

/**
 * Manages a transient notification string with automatic dismissal.
 * The ref pattern avoids stale closures in WebSocket handlers.
 */
export function useNotification() {
    const [notification, setNotificationState] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const setNotification = useCallback((message: string | null, autoDismissMs = 4000) => {
        clearTimer();
        setNotificationState(message);
        if (message !== null && autoDismissMs > 0) {
            timerRef.current = setTimeout(() => {
                setNotificationState(null);
                timerRef.current = null;
            }, autoDismissMs);
        }
    }, [clearTimer]);

    const clearNotification = useCallback(() => {
        clearTimer();
        setNotificationState(null);
    }, [clearTimer]);

    return { notification, setNotification, clearNotification };
}
