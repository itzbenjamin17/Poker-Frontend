import { useState, useCallback, useRef } from 'react';
import { pokerApi } from '../services/api';
import { savePersistedGameEnd } from '../services/gameEndStorage';
import { useGameContext } from '../context/GameContext';
import { normalizeErrorMessage } from '../lib/payloads';
import { getErrorStatusCode } from '../lib/payloads';
import { logger } from '../security/logger';
import type { ActionError, PokerAction } from '../types';

export type GameCommand = 
    | { type: 'PLAY_ACTION'; action: PokerAction; amount?: number }
    | { type: 'READY' }
    | { type: 'UNREADY' }
    | { type: 'START_GAME' }
    | { type: 'CLAIM_WIN' }
    | { type: 'LEAVE_GAME' }
    | { type: 'LEAVE_REVIEW' };

export type DispatchError = ActionError;

export function useGameDispatcher() {
    const {
        auth,
        gameState,
        session,
        pendingActions,
        error: sessionError,
        dispatch: contextDispatch,
        clearShowdownTimers,
        onLeave,
        requestLeave,
    } = useGameContext();
    
    const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
    const pendingRef = useRef<Set<string>>(new Set());

    const setPending = useCallback((type: string, isPending: boolean) => {
        const next = new Set(pendingRef.current);
        if (isPending) next.add(type);
        else next.delete(type);
        pendingRef.current = next;
        setPendingCommands(next);
    }, []);

    const isPending = useCallback(
        (type: string) =>
            Boolean(
                pendingActions?.has(type) ||
                session?.isActionPending(type) ||
                pendingCommands.has(type)
            ),
        [pendingActions, session, pendingCommands]
    );

    const dispatch = useCallback(async (command: GameCommand) => {
        if (command.type === 'PLAY_ACTION') {
            session?.playAction(command.action, command.amount);
            return;
        }
        if (command.type === 'READY') {
            session?.ready();
            return;
        }
        if (command.type === 'UNREADY') {
            session?.unready();
            return;
        }

        const targetGameId = gameState?.gameId ?? auth.roomId;

        if (pendingRef.current.has(command.type)) return;

        session?.clearError();

        // REST Commands
        try {
            setPending(command.type, true);
            
            if (command.type === 'START_GAME') {
                if (session?.isStarted()) return;
                await pokerApi.startGame(auth.roomId, auth.token);
                session?.markGameStarted();
                void session?.synchronizeSession({ resetBudget: true });
            } else if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: true });
                session?.setClaimPending(true);
                try {
                    const res = await pokerApi.claimWin(targetGameId, auth.token);
                    session?.installTerminalResult(res.data);
                } catch (claimErr) {
                    let review = null;
                    const maxRetries = 3;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        try {
                            review = await pokerApi.getReview(targetGameId, auth.token);
                            break;
                        } catch (revErr) {
                            const status = getErrorStatusCode(revErr);
                            if (status === 409 || status === 403 || status === 404) {
                                break;
                            }
                        }
                    }
                    if (review) {
                        session?.installTerminalResult(review);
                    } else {
                        contextDispatch({ type: 'SET_CLAIM_PENDING', payload: false });
                        session?.setClaimPending(false);
                        throw claimErr;
                    }
                }
            } else if (command.type === 'LEAVE_GAME') {
                session?.setPendingLeave(true);
                try {
                    if (requestLeave) {
                        const success = await requestLeave();
                        if (!success) {
                            session?.setPendingLeave(false);
                            return;
                        }
                        clearShowdownTimers();
                        contextDispatch({ type: 'SET_PRIVATE', payload: null });
                        contextDispatch({ type: 'CLEAR_GAME_STATE' });
                        savePersistedGameEnd(auth.roomId, null);
                        session?.disconnect();
                    } else {
                        try {
                            await pokerApi.leaveRoom(auth.roomId, auth.token);
                        } catch (error) {
                            if (getErrorStatusCode(error) !== 404) throw error;
                        }
                        clearShowdownTimers();
                        savePersistedGameEnd(auth.roomId, null);
                        contextDispatch({ type: 'SET_PRIVATE', payload: null });
                        session?.disconnect();
                        onLeave?.();
                    }
                } catch (leaveErr) {
                    session?.setPendingLeave(false);
                    throw leaveErr;
                }
            } else if (command.type === 'LEAVE_REVIEW') {
                clearShowdownTimers();
                session?.disconnect();
                session?.setGameEndResult(null);
                savePersistedGameEnd(auth.roomId, null);
                contextDispatch({ type: 'CLEAR_GAME_STATE' });
                onLeave?.();
                return;
            }
        } catch (err) {
            if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: false });
                session?.setClaimPending(false);
            }
            logger.error(`Failed ${command.type}:`, err);
            const msg = normalizeErrorMessage(err instanceof Error ? err.message : 'Operation failed') ?? 'Operation failed';
            contextDispatch({ type: 'SET_NOTIFICATION', payload: msg });
        } finally {
            setPending(command.type, false);
        }
    }, [auth.roomId, auth.token, clearShowdownTimers, contextDispatch, gameState, onLeave, requestLeave, session, setPending]);

    const onSocketError = useCallback((message: string) => {
        session?.handleActionError(message);
    }, [session]);

    const clearError = useCallback(() => {
        session?.clearError();
    }, [session]);

    const error: DispatchError | null = sessionError ?? session?.getSnapshot().error ?? null;

    return { dispatch, isPending, error, clearError, onSocketError };
}
