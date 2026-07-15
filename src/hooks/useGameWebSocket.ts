import { useEffect, useRef } from 'react';
import { createStompClient, pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    isGameStatePayload,
    isPrivateStatePayload,
    getErrorStatusCode,
    normalizeErrorMessage,
} from '../lib/payloads';
import type { RoomUpdate } from '../types';
import {
    HOST_LEFT,
    GAME_FINISHED_FALLBACK,
} from '../constants/strings';
import type { Client } from '@stomp/stompjs';

const ROOM_CLOSED_REDIRECT_MS = 3_000;

interface UseGameWebSocketOptions {
    onSocketError: (message: string) => void;
}

/**
 * Manages the STOMP WebSocket lifecycle: connect, subscribe, reconnect.
 * Bug fix: privateSubscribedRef is reset to false at the start of each effect run,
 * so reconnections always re-subscribe to the private channel.
 */
export function useGameWebSocket(options: UseGameWebSocketOptions) {
    const {
        auth, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, isHydrated,
    } = useGameContext();

    const { onSocketError } = options;

    const stompClientRef = useRef<Client | null>(null);
    const lastStateSyncTimeRef = useRef<number>(0);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isHydrated) return;

        const isE2EMock = typeof window !== 'undefined' && window.localStorage.getItem('poker-e2e-mock') === 'true';
        if (isE2EMock) {
            dispatch({ type: 'SET_WS_STATUS', payload: 'connected' });
            return;
        }

        const client = createStompClient(auth.token);
        stompClientRef.current = client;

        const scheduleRedirect = (message: string) => {
            const cleanMsg = normalizeErrorMessage(message);
            dispatch({ type: 'SET_NOTIFICATION', payload: cleanMsg });
            dispatch({ type: 'SET_LOADING_STATUS', payload: cleanMsg || 'Returning...' });
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            redirectTimerRef.current = setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
        };

        client.onConnect = () => {
            logger.log('Connected to WebSocket');
            dispatch({ type: 'SET_WS_STATUS', payload: 'connected' });

            const subscribeTo = (destinations: string[], handler: (body: string) => void) => {
                destinations.forEach((dest) => client.subscribe(dest, (msg) => handler(msg.body)));
            };

            // ── Private channel ───────────────────────────────────────────
            subscribeTo(['/user/queue/private'], (privBody) => {
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
            subscribeTo([`/room/${auth.roomId}`], (body) => {
                try {
                    const update = JSON.parse(body) as RoomUpdate;

                    if (update.message === 'ROOM_CLOSED') {
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
            subscribeTo([`/game/${auth.roomId}`], (body) => {
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

                if (
                    messageType === 'PLAYER_NOTIFICATION' ||
                    messageType === 'AUTO_ADVANCE_START' ||
                    messageType === 'AUTO_ADVANCE_COMPLETE'
                ) {
                    if (messageText) dispatch({ type: 'SET_NOTIFICATION', payload: normalizeErrorMessage(messageText) });
                    return;
                }

                if (messageType === 'GAME_END') {
                    dispatch({ type: 'SET_NOTIFICATION', payload: null });

                    const endMsg = normalizeErrorMessage(messageText ?? GAME_FINISHED_FALLBACK);
                    const winnerName = typeof p.winner === 'string' ? p.winner : null;
                    const winnerChips = typeof p.winnerChips === 'number' ? p.winnerChips : undefined;
                    const isForfeit = p.isForfeit === true;

                    dispatch({
                        type: 'SET_GAME_END_RESULT',
                        payload: {
                            winnerName,
                            winnerChips,
                            isForfeit,
                            message: endMsg || GAME_FINISHED_FALLBACK,
                        },
                    });
                    return;
                }

                if (!isGameStatePayload(parsed)) {
                    logger.warn('Ignoring non-game payload on game topic:', { keys: Object.keys(p) });
                    return;
                }

                lastStateSyncTimeRef.current = Date.now();
                applyIncomingGameState(parsed);
            });

            // ── Sync on connect (catch missed updates during reconnect) ───
            const syncTime = Date.now();
            void pokerApi.getGameState(auth.roomId, auth.token)
                .then((snapshot) => {
                    if (isGameStatePayload(snapshot) && syncTime >= lastStateSyncTimeRef.current) {
                        lastStateSyncTimeRef.current = syncTime;
                        applyIncomingGameState(snapshot);
                    }
                })
                .catch((err) => {
                    const code = getErrorStatusCode(err);
                    if (code === 403) {
                        scheduleRedirect('Your seat is no longer active. Returning to lobby...');
                        return;
                    }
                    if (code !== 404) logger.warn('State re-sync failed after connect:', err);
                });

            void pokerApi.getPrivateState(auth.roomId, auth.token)
                .then((privateSnapshot) => {
                    if (isPrivateStatePayload(privateSnapshot)) applyIncomingPrivateState(privateSnapshot);
                })
                .catch((err) => {
                    const code = getErrorStatusCode(err);
                    if (code !== 404) logger.warn('Private state re-sync failed after connect:', err);
                });
        };

        client.onStompError = (frame) => {
            logger.warn('STOMP error:', frame.headers['message']);
            dispatch({ type: 'SET_WS_STATUS', payload: 'reconnecting' });
        };

        client.onWebSocketClose = () => {
            logger.warn('WebSocket closed — will reconnect automatically');
            dispatch({ type: 'SET_WS_STATUS', payload: 'reconnecting' });
        };

        client.activate();

        return () => {
            clearShowdownTimers();
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            if (gameEndTimerRef.current !== null) clearTimeout(gameEndTimerRef.current);
            dispatch({ type: 'SET_WS_STATUS', payload: 'disconnected' });
            client.deactivate();
        };
    }, [
        auth.roomId, auth.playerName, auth.token,
        isHydrated, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        clearShowdownTimers, onSocketError,
    ]);

    return { stompClientRef };
}
