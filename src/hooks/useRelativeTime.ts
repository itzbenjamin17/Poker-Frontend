import { useState, useEffect } from 'react';

/**
 * Hook to format an ISO-8601 timestamp into a human-readable relative time string.
 * Automatically updates every minute.
 * 
 * @param timestamp ISO-8601 string or null
 * @returns formatted string (e.g., "recently", "2 min ago")
 */
function calculateRelativeTime(timestamp: string | null | undefined): string {
    if (!timestamp || timestamp === 'recently') {
        return 'recently';
    }

    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 30) {
        return 'recently';
    } else if (diffSec < 60) {
        return 'just now';
    } else if (diffMin < 60) {
        return `${diffMin} min ago`;
    } else if (diffHour < 24) {
        return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
    } else {
        return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
    }
}

export function useRelativeTime(timestamp: string | null | undefined): string {
    const [relativeTime, setRelativeTime] = useState(() => calculateRelativeTime(timestamp));

    useEffect(() => {
        const update = () => {
            setRelativeTime(calculateRelativeTime(timestamp));
        };

        const interval = setInterval(update, 60000);
        
        // When timestamp changes, update state after render cycle
        // to avoid sync setState warning while keeping UI in sync.
        update();

        return () => clearInterval(interval);
    }, [timestamp]);

    return relativeTime;
}
