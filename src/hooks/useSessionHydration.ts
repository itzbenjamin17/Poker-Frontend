import { useCallback, useEffect } from 'react';
import { useGameContext } from '../context/GameContext';

/** React adapter for the session-owned, cancellable REST synchronization workflow. */
export function useSessionHydration() {
    const { session, isHydrated, isGameOver, recoveryFailed } = useGameContext();

    useEffect(() => {
        if (!session) return;
        return () => session.cancelRecovery();
    }, [session]);

    useEffect(() => {
        if (!session) return;
        if (isGameOver) session.setHydrated(true);
        else if (!isHydrated) void session.synchronizeSession({ resetBudget: true });
    }, [session, isHydrated, isGameOver]);

    const retryInitialLoad = useCallback(() => {
        void session?.synchronizeSession({ resetBudget: true });
    }, [session]);

    return { initialLoadFailed: Boolean(recoveryFailed && !isHydrated), retryInitialLoad };
}
