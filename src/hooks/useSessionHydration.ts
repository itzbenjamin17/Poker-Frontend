import { useCallback, useEffect, useRef, useState } from 'react';
import { MalformedResponseError, pokerApi } from '../services/api';
import { logger } from '../security/logger';
import { useGameContext } from '../context/GameContext';
import {
    decodeGameStatePayload,
    isPrivateStatePayload,
    getErrorStatusCode,
    mapRoomDataToRoomState,
    normalizeErrorMessage,
    reportRejectedGameSnapshot,
} from '../lib/payloads';
import {
    STATUS_CONNECTING,
    STATUS_CONNECTED,
    STATUS_RECONNECTING,
    STATUS_SEAT_RESTORED,
    SESSION_EXPIRED,
    SESSION_SEAT_GONE,
    STATUS_RECONNECTING_TABLE,
    ERROR_INITIAL_TABLE_LOAD,
} from '../constants/strings';

const ROOM_CLOSED_REDIRECT_MS = 3_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_HYDRATION_RETRIES = 3;

function computeHydrationBackoffMs(attempt: number): number {
    const expDelay = Math.min(
        MAX_RETRY_DELAY_MS,
        BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
    );
    const jitter = Math.abs(Math.imul(Date.now() ^ attempt, 2654435761)) % 250;
    return Math.min(MAX_RETRY_DELAY_MS, expDelay + jitter);
}

/**
 * Performs the initial REST hydration of room and game state.
 * Also triggers a redirect if the player's seat is gone.
 */
export function useSessionHydration() {
    const {
        auth, onLeave, dispatch,
        applyIncomingGameState, applyIncomingPrivateState,
        gameEndResult, gameState, session,
    } = useGameContext();

    const lastStateSyncTimeRef = useRef<number>(0);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onLeaveRef = useRef(onLeave);
    const gameStateRef = useRef(gameState);
    const attemptRef = useRef(0);
    const [attempt, setAttempt] = useState(0);
    const [initialLoadFailed, setInitialLoadFailed] = useState(false);

    const retryInitialLoad = useCallback(() => {
        // Invalidate immediately, including before React cleans up the old effect.
        attemptRef.current += 1;
        setInitialLoadFailed(false);
        setAttempt(value => value + 1);
    }, []);

    useEffect(() => {
        onLeaveRef.current = onLeave;
    }, [onLeave]);

    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        let mounted = true;
        const generation = ++attemptRef.current;
        const isCurrent = () => mounted && generation === attemptRef.current;
        const failInitialLoad = () => {
            if (gameStateRef.current) {
                dispatch({ type: 'SET_HYDRATED', payload: true });
                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
            } else {
                setInitialLoadFailed(true);
                dispatch({ type: 'SET_LOADING_STATUS', payload: ERROR_INITIAL_TABLE_LOAD });
            }
        };

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
                if (mounted && generation === attemptRef.current) onLeaveRef.current?.();
            }, ROOM_CLOSED_REDIRECT_MS);
        };

        const handleTerminalReview = async (originalStatus: number): Promise<boolean> => {
            try {
                if (typeof pokerApi.getReview !== 'function') {
                    if (originalStatus === 403) {
                        redirectToLobby(SESSION_SEAT_GONE);
                    } else {
                        redirectToLobby(SESSION_EXPIRED);
                    }
                    return false;
                }
                const review = await pokerApi.getReview(auth.roomId, auth.token);
                if (!isCurrent()) return false;
                if (session) {
                    session.installTerminalResult(review);
                }
                dispatch({ type: 'INSTALL_TERMINAL_RESULT', payload: review });
                dispatch({ type: 'SET_HYDRATED', payload: true });
                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTED });
                return true;
            } catch (reviewErr) {
                if (!isCurrent()) return false;
                const reviewStatus = getErrorStatusCode(reviewErr);
                if (reviewStatus === 403) {
                    redirectToLobby(SESSION_SEAT_GONE);
                    return false;
                }
                if (reviewStatus === 404 || reviewStatus === 409) {
                    if (originalStatus === 403) {
                        redirectToLobby(SESSION_SEAT_GONE);
                    } else {
                        redirectToLobby(SESSION_EXPIRED);
                    }
                    return false;
                }
                throw reviewErr;
            }
        };

        const hydrateSession = async () => {
            let retryCount = 0;
            try {
                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_CONNECTING });

                // ── Room info ────────────────────────────────────────────────────
                let roomData = null;
                while (!roomData && isCurrent()) {
                    try {
                        try {
                            roomData = await pokerApi.getRoomInfo(auth.roomId, auth.token);
                        } catch (fetchErr) {
                            if (!isCurrent()) return;
                            const statusCode = getErrorStatusCode(fetchErr);
                            if (statusCode === 403 || statusCode === 404) {
                                const installed = await handleTerminalReview(statusCode);
                                if (!isCurrent()) return;
                                if (installed) return;
                                return;
                            }
                            throw fetchErr;
                        }
                    } catch (err) {
                        if (!isCurrent()) return;
                        if (retryCount < MAX_HYDRATION_RETRIES) {
                            retryCount += 1;
                            logger.error('Room info fetch error, retrying:', err);
                            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING });
                            const delayMs = computeHydrationBackoffMs(retryCount);
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        } else {
                            failInitialLoad();
                            return;
                        }
                    }
                }

                if (!isCurrent() || !roomData) return;

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
                let snapshot: unknown;
                let fetched = false;
                let fetchTime = 0;
                while (!fetched && isCurrent()) {
                    try {
                        try {
                            fetchTime = Date.now();
                            snapshot = await pokerApi.getGameState(auth.roomId, auth.token);
                            fetched = true;
                        } catch (fetchErr) {
                            if (!isCurrent()) return;
                            const statusCode = getErrorStatusCode(fetchErr);
                            if (statusCode === 403 || statusCode === 404) {
                                const installed = await handleTerminalReview(statusCode);
                                if (!isCurrent()) return;
                                if (installed) return;
                                return;
                            }
                            throw fetchErr;
                        }
                    } catch (err) {
                        if (!isCurrent()) return;
                        if (err instanceof MalformedResponseError) {
                            reportRejectedGameSnapshot('initial REST game snapshot', {
                                path: '$', expected: 'object', receivedType: err.receivedType,
                            });
                            failInitialLoad();
                            return;
                        }
                        if (retryCount < MAX_HYDRATION_RETRIES) {
                            retryCount += 1;
                            logger.error('Game snapshot fetch error, retrying:', err);
                            dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING_TABLE });
                            const delayMs = computeHydrationBackoffMs(retryCount);
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        } else {
                            failInitialLoad();
                            return;
                        }
                    }
                }

                if (!isCurrent()) return;

                const decodedSnapshot = decodeGameStatePayload(snapshot, 'initial REST game snapshot');
                if (decodedSnapshot && fetchTime >= lastStateSyncTimeRef.current) {
                    lastStateSyncTimeRef.current = fetchTime;
                    applyIncomingGameState(decodedSnapshot);

                    let privateSnapshot: unknown = null;
                    let privateFetched = false;
                    while (!privateFetched && isCurrent()) {
                        try {
                            try {
                                privateSnapshot = await pokerApi.getPrivateState(auth.roomId, auth.token);
                                privateFetched = true;
                            } catch (privateErr) {
                                if (!isCurrent()) return;
                                const code = getErrorStatusCode(privateErr);
                                if (code === 403 || code === 404) {
                                    const installed = await handleTerminalReview(code);
                                    if (!isCurrent()) return;
                                    if (installed) return;
                                    return;
                                }
                                throw privateErr;
                            }
                        } catch (err) {
                            if (!isCurrent()) return;
                            if (retryCount < MAX_HYDRATION_RETRIES) {
                                retryCount += 1;
                                logger.error('Private snapshot fetch error, retrying:', err);
                                dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_RECONNECTING_TABLE });
                                const delayMs = computeHydrationBackoffMs(retryCount);
                                await new Promise(resolve => setTimeout(resolve, delayMs));
                            } else {
                                failInitialLoad();
                                return;
                            }
                        }
                    }

                    if (!isCurrent()) return;

                    if (isPrivateStatePayload(privateSnapshot)) {
                        applyIncomingPrivateState(privateSnapshot);
                    }

                    dispatch({ type: 'SET_HYDRATED', payload: true });
                    dispatch({ type: 'SET_LOADING_STATUS', payload: STATUS_SEAT_RESTORED });
                    return;
                }

                failInitialLoad();
            } finally {
                // complete
            }
        };

        void hydrateSession();

        return () => {
            mounted = false;
            if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
        };
    }, [auth.playerName, auth.roomId, auth.token, dispatch, applyIncomingGameState, applyIncomingPrivateState, gameEndResult, attempt, session]);

    return { initialLoadFailed, retryInitialLoad };
}
