import { useState, useCallback, useRef, useEffect } from 'react';
import { pokerApi } from '../services/api';
import { useGameContext } from '../context/GameContext';
import { normalizeErrorMessage } from '../lib/payloads';
import { logger } from '../security/logger';

export type GameCommand = 
    | { type: 'PLAY_ACTION'; action: string; amount?: number }
    | { type: 'READY' }
    | { type: 'START_GAME' }
    | { type: 'CLAIM_WIN' }
    | { type: 'LEAVE_GAME' };

export interface PublisherAdapter {
    publish: (destination: string, body: string) => void;
    isConnected: () => boolean;
}

export interface DispatchError {
    message: string;
}

export function useGameDispatcher(publisher: PublisherAdapter) {
    const { auth, gameState, dispatch: contextDispatch, clearShowdownTimers, onLeave } = useGameContext();
    
    const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
    const pendingRef = useRef<Set<string>>(new Set());
    const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [error, setError] = useState<DispatchError | null>(null);

    // Reset pending state when gameState changes
    useEffect(() => {
        pendingRef.current = new Set();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPendingCommands(new Set());
        if (actionTimeoutRef.current !== null) {
            clearTimeout(actionTimeoutRef.current);
            actionTimeoutRef.current = null;
        }
    }, [gameState]);

    useEffect(() => {
        return () => {
            if (actionTimeoutRef.current !== null) clearTimeout(actionTimeoutRef.current);
        };
    }, []);

    const setPending = useCallback((type: string, isPending: boolean) => {
        const next = new Set(pendingRef.current);
        if (isPending) next.add(type);
        else next.delete(type);
        pendingRef.current = next;
        setPendingCommands(next);
    }, []);

    const isPending = useCallback((type: string) => pendingCommands.has(type), [pendingCommands]);

    const dispatch = useCallback(async (command: GameCommand) => {
        const targetGameId = gameState?.gameId ?? auth.roomId;

        if (pendingRef.current.has(command.type)) return;

        setError(null);

        if (command.type === 'PLAY_ACTION' || command.type === 'READY') {
            if (!publisher.isConnected()) {
                contextDispatch({ type: 'SET_NOTIFICATION', payload: 'Waiting for connection...' });
                return;
            }

            try {
                setPending(command.type, true);
                actionTimeoutRef.current = setTimeout(() => {
                    setPending(command.type, false);
                }, 3000);

                if (command.type === 'PLAY_ACTION') {
                    publisher.publish(
                        `/app/${encodeURIComponent(targetGameId)}/action`,
                        JSON.stringify({ action: command.action, amount: command.amount || 0 })
                    );
                } else if (command.type === 'READY') {
                    publisher.publish(
                        `/app/${encodeURIComponent(targetGameId)}/ready`,
                        '{}'
                    );
                }
            } catch (err) {
                setPending(command.type, false);
                if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);
                logger.error(`Failed to publish ${command.type}:`, err);
                contextDispatch({ type: 'SET_NOTIFICATION', payload: 'System malfunction' });
            }
            return;
        }

        // REST Commands
        try {
            setPending(command.type, true);
            
            if (command.type === 'START_GAME') {
                await pokerApi.startGame(auth.roomId, auth.token);
            } else if (command.type === 'CLAIM_WIN') {
                contextDispatch({ type: 'SET_CLAIM_PENDING', payload: true });
                await pokerApi.claimWin(targetGameId, auth.token);
            } else if (command.type === 'LEAVE_GAME') {
                if (gameState?.gameId) {
                    await pokerApi.leaveGame(gameState.gameId, auth.token);
                }
                await pokerApi.leaveRoom(auth.roomId, auth.token);
                clearShowdownTimers();
                contextDispatch({ type: 'SET_PRIVATE', payload: null });
                onLeave?.();
            }
        } catch (err) {
            setPending(command.type, false);
            logger.error(`Failed ${command.type}:`, err);
            const msg = normalizeErrorMessage(err instanceof Error ? err.message : 'Operation failed');
            contextDispatch({ type: 'SET_NOTIFICATION', payload: msg });
        }
    }, [auth.roomId, auth.token, clearShowdownTimers, contextDispatch, gameState, onLeave, publisher, setPending]);

    const onSocketError = useCallback((message: string) => {
        setPending('PLAY_ACTION', false);
        setPending('READY', false);
        if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);

        const normalized = normalizeErrorMessage(message);
        const isBetRaiseError = /bet|raise|insufficient|amount|chip/i.test(message);
        
        if (isBetRaiseError) {
            setError({ message: normalized });
            contextDispatch({ type: 'SET_NOTIFICATION', payload: 'Invalid bet amount' });
        } else {
            contextDispatch({ type: 'SET_NOTIFICATION', payload: normalized });
        }
    }, [contextDispatch, setPending]);

    const clearError = useCallback(() => setError(null), []);

    return { dispatch, isPending, error, clearError, onSocketError };
}
