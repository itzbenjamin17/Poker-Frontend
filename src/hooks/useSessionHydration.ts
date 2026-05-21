import { useEffect, useRef } from 'react';
import { pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    isGameStatePayload,
    isPrivateStatePayload,
    getErrorStatusCode,
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
    } = useGameContext();

    const lastStateSyncTimeRef = useRef<number>(0);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let mounted = true;

        const redirectToLobby = (message: string) => {
            const cleanMsg = normalizeErrorMessage(message);
            dispatch({ type: 'SET_NOTIFICATION', payload: cleanMsg });
            dispatch({ type: 'SET_LOADING_STATUS', payload: cleanMsg || 'Returning to lobby...' });
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
            redirectTimerRef.current = setTimeout(() => {
                if (mounted) onLeave?.();
            }, ROOM_CLOSED_REDIRECT_MS);
        };

        const hydrateSession = async () => {
            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTING });

            // ── Room info ────────────────────────────────────────────────────
            try {
                const roomData = await pokerApi.getRoomInfo(auth.roomId, auth.token);
                if (!mounted) return;

                const playerStillInRoom =
                    Array.isArray(roomData.players) &&
                    roomData.players.some((p: { name?: string }) => p.name === auth.playerName);

                if (!playerStillInRoom) {
                    redirectToLobby(SESSION_SEAT_GONE);
                    return;
                }

                dispatch({
                    type: 'SET_ROOM',
                    payload: {
                        roomId: roomData.roomId,
                        roomName: roomData.roomName,
                        players: roomData.players.map((p: { name: string; isHost: boolean; joinedAt?: string }) => ({
                            name: p.name,
                            isHost: p.isHost,
                            joinedAt: p.joinedAt,
                        })),
                        maxPlayers: roomData.maxPlayers,
                        buyIn: roomData.buyIn,
                        smallBlind: roomData.smallBlind,
                        bigBlind: roomData.bigBlind,
                        canStartGame: roomData.canStartGame,
                        gameStarted: roomData.gameStarted,
                    },
                });

                if (!roomData.gameStarted) {
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
                    return;
                }
            } catch (err) {
                if (!mounted) return;
                const statusCode = getErrorStatusCode(err);
                if (statusCode === 403 || statusCode === 404) {
                    redirectToLobby(SESSION_EXPIRED);
                } else {
                    logger.error('Room info fetch error:', err);
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING });
                }
                return;
            }

            // ── Game state ───────────────────────────────────────────────────
            try {
                const fetchTime = Date.now();
                const snapshot = await pokerApi.getGameState(auth.roomId, auth.token);
                if (!mounted) return;

                if (isGameStatePayload(snapshot) && fetchTime >= lastStateSyncTimeRef.current) {
                    lastStateSyncTimeRef.current = fetchTime;
                    applyIncomingGameState(snapshot);

                    try {
                        const privateSnapshot = await pokerApi.getPrivateState(auth.roomId, auth.token);
                        if (mounted && isPrivateStatePayload(privateSnapshot)) {
                            applyIncomingPrivateState(privateSnapshot);
                        }
                    } catch (privateErr) {
                        const code = getErrorStatusCode(privateErr);
                        if (code !== 404) logger.warn('Private snapshot fetch error:', privateErr);
                    }

                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_SEAT_RESTORED });
                    return;
                }
            } catch (err) {
                if (!mounted) return;
                const statusCode = getErrorStatusCode(err);
                if (statusCode === 403) {
                    redirectToLobby(SESSION_SEAT_GONE);
                    return;
                }
                if (statusCode !== 404) {
                    logger.error('Game snapshot fetch error:', err);
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING_TABLE });
                    return;
                }
            }

            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
        };

        void hydrateSession();

        return () => {
            mounted = false;
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
        };
    }, [auth.playerName, auth.roomId, auth.token, onLeave, dispatch, applyIncomingGameState, applyIncomingPrivateState]);
}
