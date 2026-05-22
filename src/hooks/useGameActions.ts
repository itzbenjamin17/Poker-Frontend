import { useCallback, useRef, useState, useEffect } from 'react';
import { useGameContext } from '../context/GameContext';
import { normalizeErrorMessage } from '../lib/payloads';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import {
    STATUS_WAITING_CONNECTION,
    STATUS_SYSTEM_MALFUNCTION,
    FAILED_LEAVE,
    FAILED_START,
    RAISE_ERROR_FORBIDDEN_BET,
} from '../constants/strings';

const ROOM_CLOSED_REDIRECT_MS = 3_000;

/**
 * All game action handlers: fold/check/call/raise, ready, start, claimWin, leave.
 */
export function useGameActions(
    stompClientRef: React.RefObject<import('@stomp/stompjs').Client | null>,
    setRaiseAmount: (v: string) => void,
    setRaiseError: (v: string | null) => void,
) {
    const { auth, onLeave, gameState, dispatch, clearShowdownTimers } = useGameContext();
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isActionPending, setIsActionPending] = useState(false);
    const isActionPendingRef = useRef(false);
    const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Reset pending state when gameState changes
    useEffect(() => {
        isActionPendingRef.current = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsActionPending(false);
        if (actionTimeoutRef.current !== null) {
            clearTimeout(actionTimeoutRef.current);
            actionTimeoutRef.current = null;
        }
    }, [gameState]);

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (actionTimeoutRef.current !== null) {
                clearTimeout(actionTimeoutRef.current);
            }
        };
    }, []);

    const handleAction = useCallback((action: string, amount = 0) => {
        if (isActionPendingRef.current) return;

        const targetGameId = gameState?.gameId ?? auth.roomId;

        if (!stompClientRef.current?.connected) {
            logger.warn('STOMP client not connected, action deferred');
            dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(STATUS_WAITING_CONNECTION) });
            return;
        }

        try {
            isActionPendingRef.current = true;
            setIsActionPending(true);
            actionTimeoutRef.current = setTimeout(() => {
                isActionPendingRef.current = false;
                setIsActionPending(false);
            }, 3_000);

            stompClientRef.current.publish({
                destination: `/app/${targetGameId}/action`,
                body: JSON.stringify({ action, amount }),
            });
            setRaiseAmount('');
            setRaiseError(null);
        } catch (err) {
            isActionPendingRef.current = false;
            setIsActionPending(false);
            if (actionTimeoutRef.current !== null) {
                clearTimeout(actionTimeoutRef.current);
                actionTimeoutRef.current = null;
            }
            logger.error('Failed to publish action:', err);
            dispatch({ type: 'SET_NOTIFICATION', payload: STATUS_SYSTEM_MALFUNCTION });
        }
    }, [auth.roomId, dispatch, gameState, setRaiseAmount, setRaiseError, stompClientRef]);

    const handleReady = useCallback(() => {
        if (isActionPendingRef.current) return;

        const targetGameId = gameState?.gameId ?? auth.roomId;

        if (!stompClientRef.current?.connected) {
            dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(STATUS_WAITING_CONNECTION) });
            return;
        }

        try {
            isActionPendingRef.current = true;
            setIsActionPending(true);
            actionTimeoutRef.current = setTimeout(() => {
                isActionPendingRef.current = false;
                setIsActionPending(false);
            }, 3_000);

            stompClientRef.current.publish({
                destination: `/app/${targetGameId}/ready`,
                body: '{}',
            });
        } catch (err) {
            isActionPendingRef.current = false;
            setIsActionPending(false);
            if (actionTimeoutRef.current !== null) {
                clearTimeout(actionTimeoutRef.current);
                actionTimeoutRef.current = null;
            }
            logger.error('Failed to publish ready:', err);
            dispatch({ type: 'SET_NOTIFICATION', payload: STATUS_SYSTEM_MALFUNCTION });
        }
    }, [auth.roomId, dispatch, gameState, stompClientRef]);

    const handleStartGame = useCallback(async () => {
        if (isActionPendingRef.current) return;
        try {
            isActionPendingRef.current = true;
            setIsActionPending(true);
            actionTimeoutRef.current = setTimeout(() => {
                isActionPendingRef.current = false;
                setIsActionPending(false);
            }, 3_000);

            await pokerApi.startGame(auth.roomId, auth.token);
        } catch (err) {
            isActionPendingRef.current = false;
            setIsActionPending(false);
            if (actionTimeoutRef.current !== null) {
                clearTimeout(actionTimeoutRef.current);
                actionTimeoutRef.current = null;
            }
            logger.error('Failed to start game:', err);
            const rawMsg = err instanceof Error ? err.message : FAILED_START;
            dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(rawMsg) });
        }
    }, [auth.roomId, auth.token, dispatch]);

    const handleClaimWin = useCallback(async () => {
        const activeGameId = gameState?.gameId ?? auth.roomId;
        try {
            dispatch({ type: 'SET_CLAIM_PENDING', payload: true });
            await pokerApi.claimWin(activeGameId, auth.token);
            // claimPending stays true until GAME_END clears it
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Claim win failed.';
            dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(message) });
            dispatch({ type: 'SET_CLAIM_PENDING', payload: false });
        }
    }, [auth.roomId, auth.token, dispatch, gameState]);

    const handleLeaveGame = useCallback(async () => {
        try {
            clearShowdownTimers();
            dispatch({ type: 'SET_PRIVATE', payload: null });
            if (gameState?.gameId) {
                await pokerApi.leaveGame(gameState.gameId, auth.token);
            }
            await pokerApi.leaveRoom(auth.roomId, auth.token);
            onLeave?.();
        } catch {
            dispatch({ type: 'SET_NOTIFICATION', payload: FAILED_LEAVE });
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            redirectTimerRef.current = setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
        }
    }, [auth.roomId, auth.token, clearShowdownTimers, dispatch, gameState, onLeave]);

    // Exposed to WebSocket hook for raise-error feedback
    const handleRaiseError = useCallback((message: string) => {
        isActionPendingRef.current = false;
        setIsActionPending(false);
        if (actionTimeoutRef.current !== null) {
            clearTimeout(actionTimeoutRef.current);
            actionTimeoutRef.current = null;
        }

        const normalized = normalizeErrorMessage(message);
        const isBetRaiseError = /bet|raise|insufficient|amount|chip/i.test(message);
        if (isBetRaiseError) {
            setRaiseError(normalized);
            dispatch({ type: 'SET_NOTIFICATION', payload: RAISE_ERROR_FORBIDDEN_BET });
        } else {
            dispatch({ type: 'SET_NOTIFICATION', payload: normalized });
        }
    }, [dispatch, setRaiseError]);

    return {
        handleAction,
        handleReady,
        handleStartGame,
        handleClaimWin,
        handleLeaveGame,
        handleRaiseError,
        isActionPending,
    };
}
