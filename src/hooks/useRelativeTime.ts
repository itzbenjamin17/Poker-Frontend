import { useState, useEffect } from 'react';

/**
 * Hook to format an ISO-8601 timestamp into a human-readable relative time string.
 * Automatically updates every minute.
 * 
 * @param timestamp ISO-8601 string or null
 * @returns formatted string (e.g., "recently", "2 min ago")
 */
export function useRelativeTime(timestamp: string | null | undefined): string {
    const [relativeTime, setRelativeTime] = useState('recently');

    useEffect(() => {
        if (!timestamp || timestamp === 'recently') {
            setRelativeTime('recently');
            return;
        }

        const update = () => {
            const now = new Date();
            const then = new Date(timestamp);
            const diffMs = now.getTime() - then.getTime();
            const diffSec = Math.floor(diffMs / 1000);
            const diffMin = Math.floor(diffSec / 60);
            const diffHour = Math.floor(diffMin / 60);
            const diffDay = Math.floor(diffHour / 24);

            if (diffSec < 30) {
                setRelativeTime('recently');
            } else if (diffSec < 60) {
                setRelativeTime('just now');
            } else if (diffMin < 60) {
                setRelativeTime(`${diffMin} min ago`);
            } else if (diffHour < 24) {
                setRelativeTime(`${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`);
            } else {
                setRelativeTime(`${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`);
            }
        };

        update();
        const interval = setInterval(update, 60000);
        return () => clearInterval(interval);
    }, [timestamp]);

    return relativeTime;
}
