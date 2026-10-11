import { useEffect, useRef } from 'react';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { SESSION_SEAT_GONE } from '../constants/strings';
import { useGameContext } from '../context/GameContext';
import {
    isGameStatePayload,
    isPrivateStatePayload,
    getErrorStatusCode,
} from '../lib/payloads';
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
 * connect/disconnect, wake-up/online reconnection, and REST state resync on connect.
 */
export function useGameWebSocket(options: UseGameWebSocketOptions = {}) {
    const {
        auth,
        session,
        isHydrated,
        isGameOver,
        gameEndResult,
        roomState,
    } = useGameContext();

    const { onSocketError } = options;

    const transportRef = useRef<GameTransport | null>(null);
    const stompClientRef = useRef<Client | null>(null);
    const gameEndedRef = useRef(Boolean(gameEndResult) || isGameOver);
    const roomStateRef = useRef(roomState);

    // Keep refs in sync without re-triggering the main effect
    useEffect(() => {
        gameEndedRef.current = Boolean(gameEndResult) || isGameOver;
    }, [gameEndResult, isGameOver]);

    useEffect(() => {
        roomStateRef.current = roomState;
    }, [roomState]);

    useEffect(() => {
        if (!isHydrated || !session) return;
        // Nothing to connect for - a restored review (e.g. after a page refresh
        // past server cleanup) has no live game to subscribe to.
        if (gameEndedRef.current || session.getSnapshot().isGameOver) return;

        const transport = options.transport ?? session.getTransport();
        transportRef.current = transport;
        if (transport instanceof StompTransportAdapter) {
            stompClientRef.current = transport.getClient();
        }

        const unsubConnect = session.onConnect(() => {
            // Sync on connect (catch missed updates during reconnect)
            if (gameEndedRef.current || session.getSnapshot().isGameOver) return;
            const currentRoom = roomStateRef.current ?? session.getSnapshot().roomState;
            if (!currentRoom?.gameStarted) return;

            const syncTime = session.now();
            void pokerApi.getGameState(auth.roomId, auth.token)
                .then((snapshot) => {
                    if (gameEndedRef.current || session.getSnapshot().isGameOver) return;
                    if (isGameStatePayload(snapshot) && syncTime >= session.getLastStateSyncTime()) {
                        session.applyGameState(snapshot, syncTime);
                    }
                })
                .catch((err) => {
                    if (gameEndedRef.current || session.getSnapshot().isGameOver) return;
                    const code = getErrorStatusCode(err);
                    if (code === 403) {
                        session.scheduleRedirect(SESSION_SEAT_GONE);
                        return;
                    }
                    if (code !== 404) logger.warn('State re-sync failed after connect:', err);
                });

            void pokerApi.getPrivateState(auth.roomId, auth.token)
                .then((privateSnapshot) => {
                    if (gameEndedRef.current || session.getSnapshot().isGameOver) return;
                    if (isPrivateStatePayload(privateSnapshot)) {
                        session.applyPrivateState(privateSnapshot);
                    }
                })
                .catch((err) => {
                    if (gameEndedRef.current || session.getSnapshot().isGameOver) return;
                    const code = getErrorStatusCode(err);
                    if (code !== 404) logger.warn('Private state re-sync failed after connect:', err);
                });
        });

        const unsubSocketError = onSocketError ? session.onSocketError(onSocketError) : undefined;

        const triggerReconnect = () => {
            if (typeof transport.forceReconnect === 'function') {
                transport.forceReconnect();
            } else {
                transport.connect();
            }
        };

        const handleWakeup = () => {
            if (document.visibilityState === 'visible' && !transport.isConnected?.()) {
                logger.log('Tab woke up and WebSocket is disconnected. Forcing reconnect...');
                triggerReconnect();
            }
        };

        const handleOnline = () => {
            if (!transport.isConnected?.()) {
                logger.log('Browser came online. Forcing reconnect...');
                triggerReconnect();
            }
        };

        document.addEventListener('visibilitychange', handleWakeup);
        window.addEventListener('online', handleOnline);

        session.connect(options.transport);

        return () => {
            document.removeEventListener('visibilitychange', handleWakeup);
            window.removeEventListener('online', handleOnline);
            unsubConnect();
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
