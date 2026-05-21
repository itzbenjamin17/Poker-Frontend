import { useCallback, useRef } from 'react';
import type { GameState } from '../types';

const SHOWDOWN_FALLBACK_HIDE_MS = 45_000;

export function useShowdownTimers(
    setShowdown: (v: GameState | null) => void,
    setShowdownResult: (v: GameState | null) => void,
) {
    const showdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showdownResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearShowdownTimers = useCallback(() => {
        if (showdownTimerRef.current !== null) {
            clearTimeout(showdownTimerRef.current);
            showdownTimerRef.current = null;
        }
        if (showdownResultTimerRef.current !== null) {
            clearTimeout(showdownResultTimerRef.current);
            showdownResultTimerRef.current = null;
        }
    }, []);

    const scheduleShowdownHide = useCallback((state: GameState) => {
        clearShowdownTimers();

        const deadlineMs =
            state.phase === 'SHOWDOWN' &&
            Boolean(state.isReadyCountdownActive) &&
            typeof state.readyCountdownDeadlineEpochMs === 'number'
                ? state.readyCountdownDeadlineEpochMs
                : undefined;

        const delay = deadlineMs !== undefined
            ? Math.max(0, deadlineMs - Date.now()) || 250
            : state.phase === 'SHOWDOWN'
                ? SHOWDOWN_FALLBACK_HIDE_MS
                : null;

        if (delay === null) return;

        showdownTimerRef.current = setTimeout(() => setShowdown(null), delay);
        showdownResultTimerRef.current = setTimeout(() => setShowdownResult(null), delay);
    }, [clearShowdownTimers, setShowdown, setShowdownResult]);

    return { clearShowdownTimers, scheduleShowdownHide };
}
