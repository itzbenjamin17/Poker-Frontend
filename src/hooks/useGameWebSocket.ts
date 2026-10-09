import { useEffect, useRef } from 'react';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    isGameStatePayload,
    isGameEndPayload,
    isPrivateStatePayload,
    getErrorStatusCode,
    normalizeErrorMessage,
} from '../lib/payloads';
import type { RoomUpdate, GameState } from '../types';
import {
    HOST_LEFT,
    GAME_FINISHED_FALLBACK,
} from '../constants/strings';
import type { Client } from '@stomp/stompjs';
import {
    StompTransportAdapter,
    type GameTransport,
} from '../services/transport';

const ROOM_CLOSED_REDIRECT_MS = 3_000;

export interface UseGameWebSocketOptions {
    onSocketError: (message: string) => void;
    transport?: GameTransport;
}

/**
 * Manages the real-time communication lifecycle via GameTransport: connect, subscribe, reconnect.
 */
export function useGameWebSocket(options: UseGameWebSocketOptions) {
    const {
        auth, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, isHydrated,
        gameEndResult,
        roomState,
    } = useGameContext();

    const { onSocketError } = options;

    const transportRef = useRef<GameTransport | null>(null);
    const stompClientRef = useRef<Client | null>(null);
    const lastStateSyncTimeRef = useRef<number>(0);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameEndedRef = useRef(Boolean(gameEndResult));
    const roomStateRef = useRef(roomState);

    // Keep refs in sync without re-triggering the main effect
    useEffect(() => {
        if (gameEndResult) gameEndedRef.current = true;
        else if (!gameEndResult) gameEndedRef.current = false;
    }, [gameEndResult]);

    useEffect(() => {
        roomStateRef.current = roomState;
    }, [roomState]);

    useEffect(() => {
        if (!isHydrated) return;
        // Nothing to connect for - a restored review (e.g. after a page refresh
        // past server cleanup) has no live game to subscribe to.
        if (gameEndedRef.current) return;

        const transport = options.transport ?? new StompTransportAdapter(auth.token);
        transportRef.current = transport;
        if (transport instanceof StompTransportAdapter) {
            stompClientRef.current = transport.getClient();
        }

        const scheduleRedirect = (message: string) => {
            if (gameEndedRef.current) return;
            const cleanMsg = normalizeErrorMessage(message);
            dispatch({ type: 'SET_NOTIFICATION', payload: cleanMsg });
            dispatch({ type: 'SET_LOADING_STATUS', payload: cleanMsg || 'Returning...' });
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            redirectTimerRef.current = setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
        };

        const unsubStatus = transport.onStatusChange((status) => {
            if (gameEndedRef.current && status === 'reconnecting') return;
            dispatch({ type: 'SET_WS_STATUS', payload: status });

            if (status === 'connected') {
                // Sync on connect (catch missed updates during reconnect)
                if (gameEndedRef.current) return;
                if (!roomStateRef.current?.gameStarted) return;

                const syncTime = Date.now();
                void pokerApi.getGameState(auth.roomId, auth.token)
                    .then((snapshot) => {
                        if (gameEndedRef.current) return;
                        if (isGameStatePayload(snapshot) && syncTime >= lastStateSyncTimeRef.current) {
                            lastStateSyncTimeRef.current = syncTime;
                            applyIncomingGameState(snapshot);
                        }
                    })
                    .catch((err) => {
                        if (gameEndedRef.current) return;
                        const code = getErrorStatusCode(err);
                        if (code === 403) {
                            scheduleRedirect('Your seat is no longer active. Returning to lobby...');
                            return;
                        }
                        if (code !== 404) logger.warn('State re-sync failed after connect:', err);
                    });

                void pokerApi.getPrivateState(auth.roomId, auth.token)
                    .then((privateSnapshot) => {
                        if (gameEndedRef.current) return;
                        if (isPrivateStatePayload(privateSnapshot)) applyIncomingPrivateState(privateSnapshot);
                    })
                    .catch((err) => {
                        if (gameEndedRef.current) return;
                        const code = getErrorStatusCode(err);
                        if (code !== 404) logger.warn('Private state re-sync failed after connect:', err);
                    });
            }
        });

        const unsubError = transport.onError?.((errorMsg) => {
            if (gameEndedRef.current) return;
            dispatch({ type: 'SET_WS_STATUS', payload: 'reconnecting' });
            onSocketError(errorMsg);
        });

        // ── Private channel ───────────────────────────────────────────
        const subPrivate = transport.subscribe('/user/queue/private', (privBody) => {
            try {
                const parsed = JSON.parse(privBody);

                if (parsed.type === 'ACTION_ERROR' && typeof parsed.message === 'string') {
                    onSocketError(parsed.message);
                    return;
                }

                if (isPrivateStatePayload(parsed)) {
                    applyIncomingPrivateState(parsed);
                }
            } catch (err) {
                logger.warn('Ignoring malformed private payload:', privBody, err);
            }
        });

        // ── Room updates ──────────────────────────────────────────────
        const subRoom = transport.subscribe(`/room/${auth.roomId}`, (body) => {
            try {
                const update = JSON.parse(body) as RoomUpdate;

                if (update.message === 'ROOM_CLOSED') {
                    if (gameEndedRef.current) return;
                    dispatch({ type: 'SET_NOTIFICATION', payload: HOST_LEFT });
                    dispatch({ type: 'SET_LOADING_STATUS', payload: HOST_LEFT });
                    dispatch({ type: 'SET_ROOM', payload: null });
                    if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
                    redirectTimerRef.current = setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
                    return;
                }

                if (
                    update.message === 'ROOM_CREATED' ||
                    update.message === 'PLAYER_JOINED' ||
                    update.message === 'PLAYER_LEFT'
                ) {
                    dispatch({
                        type: 'SET_ROOM',
                        payload: {
                            roomId: update.data.roomId ?? auth.roomId,
                            roomName: update.data.roomName,
                            players: update.data.players,
                            maxPlayers: update.data.maxPlayers,
                            buyIn: update.data.buyIn,
                            smallBlind: update.data.smallBlind,
                            bigBlind: update.data.bigBlind,
                            canStartGame: update.data.canStartGame,
                            gameStarted: update.data.gameStarted,
                        },
                    });
                }
            } catch (err) {
                logger.warn('Ignoring malformed room update payload:', body, err);
            }
        });

        // ── Game state ────────────────────────────────────────────────
        const subGame = transport.subscribe(`/game/${auth.roomId}`, (body) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(body);
            } catch (err) {
                logger.warn('Ignoring malformed game payload:', body, err);
                return;
            }

            if (!parsed || typeof parsed !== 'object') return;
            const p = parsed as Record<string, unknown>;

            const messageType = typeof p.type === 'string' ? p.type : null;
            const messageText = typeof p.message === 'string' ? p.message : null;

            if (isGameEndPayload(parsed)) {
                if (gameEndedRef.current) return;
                gameEndedRef.current = true;
                if (redirectTimerRef.current !== null) {
                    clearTimeout(redirectTimerRef.current);
                    redirectTimerRef.current = null;
                }

                dispatch({ type: 'SET_NOTIFICATION', payload: null });

                const endMsg = normalizeErrorMessage(parsed.message ?? GAME_FINISHED_FALLBACK);
                const winnerName = typeof parsed.winner === 'string' ? parsed.winner : null;
                const winnerChips = typeof parsed.winnerChips === 'number' ? parsed.winnerChips : undefined;
                const isForfeit = parsed.isForfeit === true;

                let finalGameState: GameState | undefined = undefined;
                if (parsed.finalState && isGameStatePayload(parsed.finalState)) {
                    finalGameState = {
                        ...parsed.finalState,
                        gameId: parsed.finalState.gameId ?? auth.roomId,
                        claimWinAvailable: parsed.finalState.claimWinAvailable ?? undefined,
                        claimWinPlayerName: parsed.finalState.claimWinPlayerName ?? undefined,
                        uncalledAmount: parsed.finalState.uncalledAmount ?? undefined,
                        pots: parsed.finalState.pots ?? undefined,
                        isReadyCountdownActive: parsed.finalState.isReadyCountdownActive ?? undefined,
                        readyCountdownDeadlineEpochMs: parsed.finalState.readyCountdownDeadlineEpochMs ?? undefined,
                    };
                }

                dispatch({
                    type: 'SET_GAME_END_RESULT',
                    payload: {
                        winnerName,
                        winnerChips,
                        isForfeit,
                        message: endMsg || GAME_FINISHED_FALLBACK,
                        finalState: finalGameState,
                    },
                });
                return;
            }

            if (
                messageType === 'PLAYER_NOTIFICATION' ||
                messageType === 'AUTO_ADVANCE_START' ||
                messageType === 'AUTO_ADVANCE_COMPLETE'
            ) {
                if (messageText) dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(messageText) });
                return;
            }

            if (!isGameStatePayload(parsed)) {
                logger.warn('Ignoring non-game payload on game topic:', { keys: Object.keys(p) });
                return;
            }

            if (gameEndedRef.current) return;

            lastStateSyncTimeRef.current = Date.now();
            applyIncomingGameState(parsed);
        });

        const handleWakeup = () => {
            if (document.visibilityState === 'visible' && !transport.isConnected?.()) {
                logger.log('Tab woke up and WebSocket is disconnected. Forcing reconnect...');
                if (typeof (transport as unknown as { forceReconnect?: () => void }).forceReconnect === 'function') {
                    (transport as unknown as { forceReconnect: () => void }).forceReconnect();
                } else {
                    transport.connect();
                }
            }
        };

        const handleOnline = () => {
            if (!transport.isConnected?.()) {
                logger.log('Browser came online. Forcing reconnect...');
                if (typeof (transport as unknown as { forceReconnect?: () => void }).forceReconnect === 'function') {
                    (transport as unknown as { forceReconnect: () => void }).forceReconnect();
                } else {
                    transport.connect();
                }
            }
        };

        document.addEventListener('visibilitychange', handleWakeup);
        window.addEventListener('online', handleOnline);

        transport.connect();

        return () => {
            document.removeEventListener('visibilitychange', handleWakeup);
            window.removeEventListener('online', handleOnline);
            clearShowdownTimers();
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            unsubStatus();
            unsubError?.();
            subPrivate.unsubscribe();
            subRoom.unsubscribe();
            subGame.unsubscribe();
            dispatch({ type: 'SET_WS_STATUS', payload: 'disconnected' });
            transport.disconnect();
        };
    }, [
        auth.roomId, auth.playerName, auth.token,
        isHydrated, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, onSocketError,
        options.transport,
    ]);

    return { stompClientRef, transportRef };
}
