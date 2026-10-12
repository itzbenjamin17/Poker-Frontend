import { useEffect, useRef } from 'react';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    isGameStatePayload,
    isPrivateStatePayload,
    isRoomDataPayload,
    mapRoomDataToRoomState,
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
 * connect/disconnect, wake-up/online reconnection, and deduplicated REST state recovery.
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
        if (gameEndedRef.current) {
            session?.cancelRecovery();
        }
    }, [gameEndResult, isGameOver, session]);

    useEffect(() => {
        roomStateRef.current = roomState;
    }, [roomState]);

    useEffect(() => {
        if (!isHydrated || !session) return;
        // Nothing to connect for - a restored review (e.g. after a page refresh
        // past server cleanup) has no live game to subscribe to.
        if (gameEndedRef.current || session.getSnapshot().isGameOver) return;

        let disposed = false;

        const isCancelled = () =>
            disposed || gameEndedRef.current || session.getSnapshot().isGameOver;

        const transport = options.transport ?? session.getTransport();
        transportRef.current = transport;
        if (transport instanceof StompTransportAdapter) {
            stompClientRef.current = transport.getClient();
        }

        const executeRecoveryStep = async (): Promise<void> => {
            let currentRoom = roomStateRef.current ?? session.getSnapshot().roomState;

            if (!currentRoom || !currentRoom.gameStarted) {
                if (typeof pokerApi.getRoomInfo === 'function') {
                    const roomData = await Promise.resolve(pokerApi.getRoomInfo(auth.roomId, auth.token));
                    if (isCancelled()) return;
                    if (isRoomDataPayload(roomData)) {
                        const updatedRoom = mapRoomDataToRoomState(roomData, auth.roomId);
                        roomStateRef.current = updatedRoom;
                        session.setRoomState(updatedRoom);
                        currentRoom = updatedRoom;
                    }
                }
            }

            if (isCancelled() || !currentRoom?.gameStarted) {
                return;
            }

            const syncTime = session.now();
            const syncRevision = session.getStateSyncRevision();

            const publicPromise = Promise.resolve(pokerApi.getGameState(auth.roomId, auth.token)).then(
                (snapshot) => {
                    if (isCancelled()) return;
                    if (
                        isGameStatePayload(snapshot) &&
                        session.getStateSyncRevision() === syncRevision &&
                        syncTime >= session.getLastStateSyncTime()
                    ) {
                        session.applyGameState(snapshot, syncTime);
                    }
                }
            );

            const privatePromise = Promise.resolve(pokerApi.getPrivateState(auth.roomId, auth.token)).then(
                (privateSnapshot) => {
                    if (isCancelled()) return;
                    if (isPrivateStatePayload(privateSnapshot)) {
                        session.applyPrivateState(privateSnapshot);
                    }
                }
            );

            await Promise.all([publicPromise, privatePromise]);
        };

        const startRecoveryWorkflow = ({ resetBudget }: { resetBudget: boolean }) => {
            if (isCancelled()) return;
            void session.recoverState(executeRecoveryStep, { resetBudget });
        };

        const unsubConnect = session.onConnect(() => {
            startRecoveryWorkflow({ resetBudget: true });
        });

        const triggerReconnect = () => {
            if (typeof transport.forceReconnect === 'function') {
                transport.forceReconnect();
            } else {
                transport.connect();
            }
        };

        const unsubManualRetry = session.onManualRetry(() => {
            if (isCancelled()) return;
            if (!transport.isConnected?.()) {
                triggerReconnect();
            }
            startRecoveryWorkflow({ resetBudget: true });
        });

        const unsubSocketError = onSocketError ? session.onSocketError(onSocketError) : undefined;

        const handleWakeup = () => {
            if (document.visibilityState !== 'visible') return;
            if (isCancelled()) return;
            if (!transport.isConnected?.()) {
                logger.log('Tab woke up and WebSocket is disconnected. Forcing reconnect...');
                triggerReconnect();
            }
            startRecoveryWorkflow({ resetBudget: false });
        };

        const handleOnline = () => {
            if (isCancelled()) return;
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

