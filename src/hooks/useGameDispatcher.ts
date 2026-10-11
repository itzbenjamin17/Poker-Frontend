import { useState, useCallback, useRef } from 'react';
import { pokerApi } from '../services/api';
import { savePersistedGameEnd } from '../services/gameEndStorage';
import { useGameContext } from '../context/GameContext';
import { normalizeErrorMessage, getErrorStatusCode } from '../lib/payloads';
import { logger } from '../security/logger';
import type { PokerAction } from '../types';

export type GameCommand = 
    | { type: 'PLAY_ACTION'; action: PokerAction; amount?: number }
    | { type: 'READY' }
    | { type: 'UNREADY' }
    | { type: 'START_GAME' }
    | { type: 'CLAIM_WIN' }
    | { type: 'LEAVE_GAME' }
    | { type: 'LEAVE_REVIEW' };

export interface DispatchError {
    message: string;
}

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
                await pokerApi.startGame(auth.roomId, auth.token);
            } else if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: true });
                await pokerApi.claimWin(targetGameId, auth.token);
            } else if (command.type === 'LEAVE_GAME') {
                const logUnexpectedLeaveError = (op: string, err: unknown) => {
                    const code = getErrorStatusCode(err);
                    if (code !== 404 && code !== 403) {
                        logger.warn(`LEAVE_GAME ${op} failed:`, err);
                    }
                };
                if (gameState?.gameId) {
                    try {
                        await pokerApi.leaveGame(gameState.gameId, auth.token);
                    } catch (err) {
                        logUnexpectedLeaveError('leaveGame', err);
                    }
                }
                try {
                    await pokerApi.leaveRoom(auth.roomId, auth.token);
                } catch (err) {
                    logUnexpectedLeaveError('leaveRoom', err);
                }
                clearShowdownTimers();
                savePersistedGameEnd(auth.roomId, null);
                contextDispatch({ type: 'SET_PRIVATE', payload: null });
                onLeave?.();
            } else if (command.type === 'LEAVE_REVIEW') {
                // Fire and forget REST calls, ignore failures
                void pokerApi.leaveGame(targetGameId, auth.token)
                    .catch((err) => logger.warn('LEAVE_REVIEW leaveGame failed:', err));
                void pokerApi.leaveRoom(auth.roomId, auth.token)
                    .catch((err) => logger.warn('LEAVE_REVIEW leaveRoom failed:', err));

                clearShowdownTimers();
                savePersistedGameEnd(auth.roomId, null);
                contextDispatch({ type: 'CLEAR_GAME_STATE' });
                onLeave?.();
                return;
            }
        } catch (err) {
            if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: false });
            }
            logger.error(`Failed ${command.type}:`, err);
            const msg = normalizeErrorMessage(err instanceof Error ? err.message : 'Operation failed');
            contextDispatch({ type: 'SET_NOTIFICATION', payload: msg });
        } finally {
            setPending(command.type, false);
        }
    }, [auth.roomId, auth.token, clearShowdownTimers, contextDispatch, gameState, onLeave, session, setPending]);

    const onSocketError = useCallback((message: string) => {
        session?.handleActionError(message);
    }, [session]);

    const clearError = useCallback(() => {
        session?.clearError();
    }, [session]);

    const error: DispatchError | null = sessionError ?? session?.getSnapshot().error ?? null;

    return { dispatch, isPending, error, clearError, onSocketError };
}
