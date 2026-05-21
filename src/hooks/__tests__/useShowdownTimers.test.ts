import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useShowdownTimers } from '../useShowdownTimers';
import type { GameState } from '../../types';

describe('useShowdownTimers', () => {
    const setShowdown = vi.fn();
    const setShowdownResult = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('schedules timers to clear showdown when phase is SHOWDOWN', () => {
        const { result } = renderHook(() => useShowdownTimers(setShowdown, setShowdownResult));

        const mockGameState = {
            phase: 'SHOWDOWN',
            isReadyCountdownActive: false,
        } as GameState;

        act(() => {
            result.current.scheduleShowdownHide(mockGameState);
        });

        // Advance timers to trigger hiding showdown
        act(() => {
            vi.advanceTimersByTime(45000);
        });

        expect(setShowdown).toHaveBeenCalledWith(null);
        expect(setShowdownResult).toHaveBeenCalledWith(null);
    });

    it('schedules timers with deadline delay if readyCountdown is active', () => {
        const { result } = renderHook(() => useShowdownTimers(setShowdown, setShowdownResult));

        const deadline = Date.now() + 5000;
        const mockGameState = {
            phase: 'SHOWDOWN',
            isReadyCountdownActive: true,
            readyCountdownDeadlineEpochMs: deadline,
        } as GameState;

        act(() => {
            result.current.scheduleShowdownHide(mockGameState);
        });

        // Before 5000ms: should not have fired yet
        act(() => {
            vi.advanceTimersByTime(4000);
        });
        expect(setShowdown).not.toHaveBeenCalled();

        // After 5000ms: should have fired
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(setShowdown).toHaveBeenCalledWith(null);
    });

    it('clearShowdownTimers cancels active timers', () => {
        const { result } = renderHook(() => useShowdownTimers(setShowdown, setShowdownResult));

        const mockGameState = {
            phase: 'SHOWDOWN',
            isReadyCountdownActive: false,
        } as GameState;

        act(() => {
            result.current.scheduleShowdownHide(mockGameState);
        });

        act(() => {
            result.current.clearShowdownTimers();
        });

        act(() => {
            vi.advanceTimersByTime(45000);
        });

        expect(setShowdown).not.toHaveBeenCalled();
    });
});
