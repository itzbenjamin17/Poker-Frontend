import { useEffect, useRef } from 'react';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import type { Client } from '@stomp/stompjs';
import {
    StompTransportAdapter,
    type GameTransport,
} from '../services/transport';

export interface UseGameWebSocketOptions {
    onSocketError?: (message: string) => void;
    transport?: GameTransport;
}

/**
 * Manages the real-time communication lifecycle via GameSession and GameTransport:
 * connect/disconnect, wake-up/online reconnection, and deduplicated REST state recovery.
 */
export function useGameWebSocket(options: UseGameWebSocketOptions = {}) {
    const {
        auth,
        session,
        isHydrated,
        isGameOver,
        gameEndResult,
    } = useGameContext();

    const { onSocketError } = options;

    const transportRef = useRef<GameTransport | null>(null);
    const stompClientRef = useRef<Client | null>(null);
    const gameEndedRef = useRef(Boolean(gameEndResult) || isGameOver);

    // Keep refs in sync without re-triggering the main effect
    useEffect(() => {
        gameEndedRef.current = Boolean(gameEndResult) || isGameOver;
        if (gameEndedRef.current) {
            session?.cancelRecovery();
        }
    }, [gameEndResult, isGameOver, session]);

    useEffect(() => {
        if (!isHydrated || !session) return;
        // Nothing to connect for - a restored review (e.g. after a page refresh
        // past server cleanup) has no live game to subscribe to.
        if (gameEndedRef.current || session.getSnapshot().isGameOver) return;

        let disposed = false;

        const isCancelled = () =>
            disposed || gameEndedRef.current || session.getSnapshot().isGameOver || !session.hasLifecyclePermission();

        const transport = options.transport ?? session.getTransport();
        transportRef.current = transport;
        if (transport instanceof StompTransportAdapter) {
            stompClientRef.current = transport.getClient();
        }

        let inFlightRecovery: Promise<void> | null = null;

        const startRecoveryWorkflow = ({ resetBudget }: { resetBudget: boolean }) => {
            if (isCancelled() || !session.hasLifecyclePermission()) return;
            if (inFlightRecovery) return;
            if (!resetBudget && session.hasPendingRecoveryTimer()) return;
            inFlightRecovery = session.synchronizeSession({ resetBudget }).finally(() => {
                inFlightRecovery = null;
            });
        };

        const unsubConnect = session.onConnect(() => {
            if (isCancelled() || !session.hasLifecyclePermission()) return;
            startRecoveryWorkflow({ resetBudget: true });
        });

        const triggerReconnect = () => {
            if (!session.hasLifecyclePermission()) return;
            if (typeof transport.forceReconnect === 'function') {
                transport.forceReconnect();
            } else {
                transport.connect();
            }
        };

        const unsubManualRetry = session.onManualRetry(() => {
            if (isCancelled() || !session.hasLifecyclePermission()) return;
            if (!transport.isConnected?.()) {
                triggerReconnect();
            }
            startRecoveryWorkflow({ resetBudget: true });
        });

        const unsubSocketError = onSocketError ? session.onSocketError(onSocketError) : undefined;

        const handleWakeup = () => {
            if (document.visibilityState !== 'visible') return;
            if (isCancelled() || !session.hasLifecyclePermission()) return;
            if (!transport.isConnected?.()) {
                logger.log('Tab woke up and WebSocket is disconnected. Forcing reconnect...');
                triggerReconnect();
            }
            startRecoveryWorkflow({ resetBudget: false });
        };

        const handleOnline = () => {
            if (isCancelled() || !session.hasLifecyclePermission()) return;
            if (!transport.isConnected?.()) {
                logger.log('Browser came online. Forcing reconnect...');
                triggerReconnect();
            }
            startRecoveryWorkflow({ resetBudget: false });
        };

        document.addEventListener('visibilitychange', handleWakeup);
        window.addEventListener('online', handleOnline);

        session.connect(options.transport);

        return () => {
            disposed = true;
            session.cancelRecovery();
            document.removeEventListener('visibilitychange', handleWakeup);
            window.removeEventListener('online', handleOnline);
            unsubConnect();
            unsubManualRetry();
            unsubSocketError?.();
            session.disconnect();
        };
    }, [
        auth.roomId,
        auth.token,
        isHydrated,
        session,
        onSocketError,
        options.transport,
    ]);

    return { stompClientRef, transportRef };
}

