import { useEffect, useRef } from 'react';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    decodeGameStatePayload,
    isPrivateStatePayload,
    getErrorStatusCode,
    mapRoomDataToRoomState,
    normalizeErrorMessage,
} from '../lib/payloads';
import {
    STATUS_CONNECTING,
    STATUS_CONNECTED,
    STATUS_RECONNECTING,
    STATUS_SEAT_RESTORED,
    SESSION_EXPIRED,
    SESSION_SEAT_GONE,
    STATUS_RECONNECTING_TABLE,
} from '../constants/strings';

const ROOM_CLOSED_REDIRECT_MS = 3_000;

/**
 * Performs the initial REST hydration of room and game state.
 * Also triggers a redirect if the player's seat is gone.
 */
export function useSessionHydration() {
    const {
        auth, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        gameEndResult,
    } = useGameContext();

    const lastStateSyncTimeRef = useRef<number>(0);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onLeaveRef = useRef(onLeave);

    useEffect(() => {
        onLeaveRef.current = onLeave;
    }, [onLeave]);

    useEffect(() => {
        let mounted = true;
        let hasTimedOut = false;

        // A game-end result already present (e.g. restored from localStorage
        // after a refresh during the post-game review) means there is nothing
        // left to hydrate, and the room/game may already be gone server-side.
        // Skip REST hydration entirely so we never 404/403 our way back to
        // the lobby out from under the reviewing player.
        if (gameEndResult) {
            dispatch({ type: 'SET_HYDRATED', payload: true });
            return () => {
                mounted = false;
            };
        }

        const redirectToLobby = (message: string) => {
            const cleanMsg = normalizeErrorMessage(message);
            dispatch({ type: 'SET_NOTIFICATION', payload: cleanMsg });
            dispatch({ type: 'SET_LOADING_STATUS', payload: cleanMsg || 'Returning to lobby...' });
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            redirectTimerRef.current = setTimeout(() => {
                if (mounted) onLeaveRef.current?.();
            }, ROOM_CLOSED_REDIRECT_MS);
        };

        const timeoutId = setTimeout(() => {
            if (mounted) {
                logger.error('Session hydration timed out.');
                hasTimedOut = true;
                redirectToLobby(SESSION_EXPIRED);
            }
        }, 120_000);

        const hydrateSession = async () => {
            try {
                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTING });

                // ── Room info ────────────────────────────────────────────────────
                let roomData = null;
                while (!roomData && !hasTimedOut && mounted) {
                    try {
                        roomData = await pokerApi.getRoomInfo(auth.roomId, auth.token);
                    } catch (err) {
                        if (!mounted || hasTimedOut) return;
                        const statusCode = getErrorStatusCode(err);
                        if (statusCode === 403 || statusCode === 404) {
                            redirectToLobby(SESSION_EXPIRED);
                            return;
                        } else {
                            logger.error('Room info fetch error, retrying:', err);
                            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING });
                            await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                    }
                }

                if (!mounted || hasTimedOut || !roomData) return;

                const playerStillInRoom =
                    Array.isArray(roomData.players) &&
                    roomData.players.some((p: { name?: string }) => p.name === auth.playerName);

                if (!playerStillInRoom) {
                    redirectToLobby(SESSION_SEAT_GONE);
                    return;
                }

                dispatch({
                    type: 'SET_ROOM',
                    payload: mapRoomDataToRoomState(roomData, auth.roomId),
                });

                if (!roomData.gameStarted) {
                    dispatch({ type: 'SET_HYDRATED', payload: true });
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
                    return;
                }

                // ── Game state ───────────────────────────────────────────────────
                let snapshot = null;
                let fetchTime = 0;
                while (!snapshot && !hasTimedOut && mounted) {
                    try {
                        fetchTime = Date.now();
                        snapshot = await pokerApi.getGameState(auth.roomId, auth.token);
                    } catch (err) {
                        if (!mounted || hasTimedOut) return;
                        const statusCode = getErrorStatusCode(err);
                        if (statusCode === 403) {
                            redirectToLobby(SESSION_SEAT_GONE);
                            return;
                        }
                        if (statusCode === 404) {
                            redirectToLobby(SESSION_EXPIRED);
                            return;
                        } else {
                            logger.error('Game snapshot fetch error, retrying:', err);
                            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING_TABLE });
                            await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                    }
                }

                if (!mounted || hasTimedOut) return;

                const decodedSnapshot = decodeGameStatePayload(snapshot, 'initial REST game snapshot');
                if (decodedSnapshot && fetchTime >= lastStateSyncTimeRef.current) {
                    lastStateSyncTimeRef.current = fetchTime;
                    applyIncomingGameState(decodedSnapshot);

                    try {
                        const privateSnapshot = await pokerApi.getPrivateState(auth.roomId, auth.token);
                        if (mounted && !hasTimedOut && isPrivateStatePayload(privateSnapshot)) {
                            applyIncomingPrivateState(privateSnapshot);
                        }
                    } catch (privateErr) {
                        const code = getErrorStatusCode(privateErr);
                        if (code !== 404) logger.warn('Private snapshot fetch error:', privateErr);
                    }

                    if (!mounted || hasTimedOut) return;

                    dispatch({ type: 'SET_HYDRATED', payload: true });
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_SEAT_RESTORED });
                    return;
                }

                dispatch({ type: 'SET_HYDRATED', payload: true });
                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
            } finally {
                clearTimeout(timeoutId);
            }
        };

        void hydrateSession();

        return () => {
            mounted = false;
            clearTimeout(timeoutId);
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
        };
    }, [auth.playerName, auth.roomId, auth.token, dispatch, applyIncomingGameState, applyIncomingPrivateState, gameEndResult]);
}
