import { useState, useCallback, useRef, useEffect } from 'react';
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
    const abortControllersRef = useRef<Set<AbortController>>(new Set());
    const isMountedRef = useRef(true);
    const sessionRef = useRef(session);
    const authRef = useRef(auth);

    useEffect(() => {
        sessionRef.current = session;
        authRef.current = auth;
    });

    useEffect(() => {
        isMountedRef.current = true;
        const activeControllers = abortControllersRef.current;
        return () => {
            isMountedRef.current = false;
            for (const controller of activeControllers) {
                controller.abort();
            }
            activeControllers.clear();
        };
    }, [session, auth]);

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

        const originatingSession = session;
        const originatingEpoch = session?.getAttachmentEpoch();
        const originatingAuth = auth;

        const isCurrent = () => {
            if (!isMountedRef.current) return false;
            if (sessionRef.current !== originatingSession) return false;
            if (authRef.current.token !== originatingAuth.token || authRef.current.roomId !== originatingAuth.roomId) {
                return false;
            }
            if (originatingSession) {
                if (!originatingSession.isAttached()) return false;
                if (originatingEpoch !== undefined && originatingSession.getAttachmentEpoch() !== originatingEpoch) {
                    return false;
                }
            }
            return true;
        };

        const controller = new AbortController();
        abortControllersRef.current.add(controller);

        // REST Commands
        try {
            setPending(command.type, true);
            
            if (command.type === 'START_GAME') {
                if (session?.isStarted()) return;
                await pokerApi.startGame(auth.roomId, auth.token, controller.signal);
                if (!isCurrent()) return;
                session?.markGameStarted();
                void session?.synchronizeSession({ resetBudget: true });
            } else if (command.type === 'CLAIM_WIN') {
                if (!session) throw new Error('Game session is unavailable');
                await session.claimWin(targetGameId);
            } else if (command.type === 'LEAVE_GAME') {
                session?.setPendingLeave(true);
                try {
                    if (requestLeave) {
                        const success = await requestLeave(originatingAuth.token);
                        if (!isCurrent()) return;
                        if (!success) {
                            session?.setPendingLeave(false);
                            return;
                        }
                        clearShowdownTimers();
                        contextDispatch({ type: 'SET_PRIVATE', payload: null });
                        contextDispatch({ type: 'CLEAR_GAME_STATE' });
                        savePersistedGameEnd(originatingAuth, null);
                        session?.disconnect();
                    } else {
                        try {
                            await pokerApi.leaveRoom(originatingAuth.roomId, originatingAuth.token, false, controller.signal);
                        } catch (error) {
                            if (getErrorStatusCode(error) !== 404) throw error;
                        }
                        if (!isCurrent()) return;
                        clearShowdownTimers();
                        savePersistedGameEnd(originatingAuth, null);
                        contextDispatch({ type: 'SET_PRIVATE', payload: null });
                        session?.disconnect();
                        onLeave?.(originatingAuth.token);
                    }
                } catch (leaveErr) {
                    if (isCurrent()) {
                        session?.setPendingLeave(false);
                    }
                    throw leaveErr;
                }
            } else if (command.type === 'LEAVE_REVIEW') {
                if (!isCurrent()) return;
                clearShowdownTimers();
                session?.disconnect();
                session?.setGameEndResult(null);
                savePersistedGameEnd(originatingAuth, null);
                contextDispatch({ type: 'CLEAR_GAME_STATE' });
                onLeave?.(originatingAuth.token);
                return;
            }
        } catch (err) {
            if (!isCurrent()) return;
            if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: false });
                session?.setClaimPending(false);
            }
            logger.error(`Failed ${command.type}:`, err);
            const msg = normalizeErrorMessage(err instanceof Error ? err.message : 'Operation failed') ?? 'Operation failed';
            contextDispatch({ type: 'SET_NOTIFICATION', payload: msg });
        } finally {
            abortControllersRef.current.delete(controller);
            if (isCurrent()) {
                setPending(command.type, false);
            }
        }
    }, [auth, clearShowdownTimers, contextDispatch, gameState, onLeave, requestLeave, session, setPending]);

    const onSocketError = useCallback((message: string) => {
        session?.handleActionError(message);
    }, [session]);

    const clearError = useCallback(() => {
        session?.clearError();
    }, [session]);

    const error: DispatchError | null = sessionError ?? session?.getSnapshot().error ?? null;

    return { dispatch, isPending, error, clearError, onSocketError };
}
