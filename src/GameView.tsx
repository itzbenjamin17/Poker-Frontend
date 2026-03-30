import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client } from '@stomp/stompjs';
import { createStompClient, pokerApi } from './services/api';
import { type GameState, type RoomUpdate, cn, type AuthResponse } from './types';
import { Button, Card } from './components/UI';
import { PlayerPod, CardUI } from './components/GameUI';
import { Info, Play, Coins } from 'lucide-react';

type GameViewProps = {
    auth: AuthResponse;
    onLeave?: () => void;
};

export default function GameView({ auth, onLeave }: GameViewProps) {
    const SHOWDOWN_DISPLAY_MS = 5000;
    const GAME_END_DISPLAY_MS = 7000;
    const ROOM_CLOSED_REDIRECT_MS = 3000;

    type IncomingGameStatePayload = Omit<GameState, 'gameId' | 'claimWinAvailable' | 'claimWinPlayerName' | 'uncalledAmount' | 'pots'> & {
        gameId?: string;
        claimWinAvailable?: boolean | null;
        claimWinPlayerName?: string | null;
        uncalledAmount?: number | null;
        pots?: number[] | null;
    };

    type IncomingPrivateStatePayload = {
        playerId?: string;
        holeCards?: string[] | null;
    };

    const isObject = useCallback((value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null, []);

    const isGameStatePayload = useCallback((
        value: unknown,
    ): value is IncomingGameStatePayload => {
        if (!isObject(value)) {
            return false;
        }

        return (typeof value.gameId === 'string' || value.gameId === undefined)
            && typeof value.phase === 'string'
            && Array.isArray(value.players)
            && Array.isArray(value.communityCards)
            && typeof value.pot === 'number'
            && (value.claimWinAvailable == null || typeof value.claimWinAvailable === 'boolean')
            && (value.claimWinPlayerName == null || typeof value.claimWinPlayerName === 'string')
            && (value.uncalledAmount == null || typeof value.uncalledAmount === 'number')
            && (value.pots == null
                || (Array.isArray(value.pots) && value.pots.every((pot) => typeof pot === 'number')));
    }, [isObject]);

    const getErrorStatusCode = useCallback((error: unknown): number | undefined => {
        if (!isObject(error)) {
            return undefined;
        }

        return typeof error.status === 'number' ? error.status : undefined;
    }, [isObject]);

    const isPrivateStatePayload = useCallback((value: unknown): value is IncomingPrivateStatePayload => {
        if (!isObject(value)) {
            return false;
        }

        return (typeof value.playerId === 'string' || value.playerId === undefined)
            && (value.holeCards == null
                || (Array.isArray(value.holeCards) && value.holeCards.every((card) => typeof card === 'string')));
    }, [isObject]);

    const normalizeErrorMessage = useCallback((message: string | null): string | null => {
        if (!message) return null;

        const msg = message.trim();

        // Handle Jackson / Technical errors that leak to the UI
        if (msg.includes('Cannot deserialize') || msg.includes('JSON parse error') || msg.includes('Unexpected character') || msg.includes('HttpMessageNotReadable')) {
            return 'Invalid request format. Please try again.';
        }

        if (msg.includes('Internal Server Error') || msg.includes('500')) {
            return 'Technical difficulties.';
        }

        if (msg.includes('java.lang') || msg.includes('org.springframework')) {
            return 'A system error occurred. Please try again.';
        }

        // Enforce hard truncation for UI safety
        const MAX_LENGTH = 80;
        if (msg.length > MAX_LENGTH) {
            return msg.substring(0, MAX_LENGTH - 3) + '...';
        }

        return msg;
    }, []);


    const [roomState, setRoomState] = useState<RoomUpdate['data'] | null>(() => ({
        roomId: auth.roomId,
        roomName: auth.roomId,
        players: [{ name: auth.playerName, isHost: false }],
        gameStarted: false,
    }));

    const [gameState, setGameState] = useState<GameState | null>(null);
    const [privateState, setPrivateState] = useState<{ holeCards: string[] } | null>(null);
    const [showdown, setShowdown] = useState<GameState | null>(null);
    const [showdownResult, setShowdownResult] = useState<GameState | null>(null);
    const [notification, setNotification] = useState<string | null>(null);
    const [loadingStatus, setLoadingStatus] = useState<string>('Connecting to Vault...');
    const [myPlayerId, setMyPlayerId] = useState<string | null>(auth.playerId || null);
    const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth);
    const [raiseAmount, setRaiseAmount] = useState<string>('');
    const [raiseError, setRaiseError] = useState<string | null>(null);
    const [claimPending, setClaimPending] = useState(false);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    const stompClientRef = useRef<Client | null>(null);
    const privateSubscribedByName = useRef(false);
    const privateSubscribedPlayerName = useRef<string | null>(null);
    const gameIdRef = useRef<string | null>(null);
    const showdownTimerRef = useRef<number | null>(null);
    const showdownResultTimerRef = useRef<number | null>(null);
    const lastStateSyncTime = useRef<number>(0);

    const isCompactTable = windowWidth < 1024;
    const isWideTable = windowWidth >= 1280;

    type TableTier = 'compact' | 'standard' | 'wide';
    const tableTier: TableTier = isCompactTable ? 'compact' : (isWideTable ? 'wide' : 'standard');

    type SeatPosition = {
        left: number;
        top: number;
        cardPlacement: 'left' | 'right' | 'below';
    };

    const getSeatPosition = (index: number, total: number, tier: TableTier): SeatPosition => {
        // Local player always at bottom-center
        if (index === 0) {
            return {
                left: 50,
                top: tier === 'wide' ? 82 : tier === 'standard' ? 80 : 78,
                cardPlacement: 'right',
            };
        }

        // Heads-up: opponent directly across
        if (total === 2) {
            return {
                left: 50,
                top: tier === 'wide' ? 16 : tier === 'standard' ? 18 : 20,
                cardPlacement: 'right',
            };
        }

        // Predefined seat layouts for common player counts (3-6 players, index 1..N-1)
        const seatLayouts: Record<number, { left: number; top: number; cardPlacement: SeatPosition['cardPlacement'] }[]> = {
            3: [
                { left: 18, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 46, cardPlacement: 'below' },
                { left: 82, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 46, cardPlacement: 'below' },
            ],
            4: [
                { left: 15, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 48, cardPlacement: 'below' },
                { left: 50, top: tier === 'wide' ? 14 : tier === 'standard' ? 16 : 18, cardPlacement: 'right' },
                { left: 85, top: tier === 'wide' ? 45 : tier === 'standard' ? 45 : 48, cardPlacement: 'below' },
            ],
            5: [
                { left: 14, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                { left: 28, top: tier === 'wide' ? 18 : tier === 'standard' ? 20 : 22, cardPlacement: 'right' },
                { left: 72, top: tier === 'wide' ? 18 : tier === 'standard' ? 20 : 22, cardPlacement: 'left' },
                { left: 86, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
            ],
            6: [
                { left: 12, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
                { left: 24, top: tier === 'wide' ? 19 : tier === 'standard' ? 20 : 22, cardPlacement: 'right' },
                { left: 50, top: tier === 'wide' ? 12 : tier === 'standard' ? 14 : 16, cardPlacement: 'right' },
                { left: 76, top: tier === 'wide' ? 19 : tier === 'standard' ? 20 : 22, cardPlacement: 'left' },
                { left: 88, top: tier === 'wide' ? 50 : tier === 'standard' ? 50 : 52, cardPlacement: 'below' },
            ],
        };

        const layout = seatLayouts[total];
        if (layout && index - 1 < layout.length) {
            const seat = layout[index - 1];
            return {
                left: seat.left,
                top: seat.top,
                cardPlacement: seat.cardPlacement,
            };
        }

        // Fallback: elliptical distribution for 7+ players
        const others = total - 1;
        const t = (index - 1) / Math.max(1, others - 1);
        // Sweep from ~200° to ~340° (upper arc, left-to-right)
        const angleDegrees = 200 + t * 140;
        const angle = (angleDegrees * Math.PI) / 180;
        const centerY = tier === 'wide' ? 44 : tier === 'standard' ? 45 : 47;
        const radiusX = tier === 'wide' ? 40 : tier === 'standard' ? 38 : 35;
        const radiusY = tier === 'wide' ? 30 : tier === 'standard' ? 28 : 26;
        const left = Math.max(10, Math.min(90, 50 + radiusX * Math.cos(angle)));
        const top = Math.max(12, Math.min(70, centerY + radiusY * Math.sin(angle)));

        let cardPlacement: SeatPosition['cardPlacement'];
        if (top < 30 && left < 50) cardPlacement = 'right';
        else if (top < 30 && left >= 50) cardPlacement = 'left';
        else if (left < 35) cardPlacement = 'below';
        else if (left > 65) cardPlacement = 'below';
        else cardPlacement = 'right';

        return {
            left,
            top,
            cardPlacement,
        };
    };

    useEffect(() => {
        gameIdRef.current = gameState?.gameId ?? null;
    }, [gameState?.gameId]);

    useEffect(() => {
        const onResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        const hasDisconnectedPlayers = Boolean(gameState?.players.some((player) => player.status === 'DISCONNECTED'));
        if (!hasDisconnectedPlayers) {
            return;
        }

        setNowMs(Date.now());
        const intervalId = window.setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(intervalId);
    }, [gameState]);

    const clearShowdownTimers = useCallback(() => {
        if (showdownTimerRef.current !== null) {
            window.clearTimeout(showdownTimerRef.current);
            showdownTimerRef.current = null;
        }

        if (showdownResultTimerRef.current !== null) {
            window.clearTimeout(showdownResultTimerRef.current);
            showdownResultTimerRef.current = null;
        }
    }, []);

    const applyIncomingGameState = useCallback((payload: IncomingGameStatePayload) => {
        const data: GameState = {
            ...payload,
            gameId: payload.gameId ?? auth.roomId,
            claimWinAvailable: payload.claimWinAvailable ?? undefined,
            claimWinPlayerName: payload.claimWinPlayerName ?? undefined,
            uncalledAmount: payload.uncalledAmount ?? undefined,
            pots: payload.pots ?? undefined,
        };

        setGameState(data);
        setRoomState(null);

        if (data.winners && data.winners.length > 0) {
            clearShowdownTimers();
            setShowdown(data);
            setShowdownResult(data);
            showdownTimerRef.current = window.setTimeout(() => {
                setShowdown(null);
            }, SHOWDOWN_DISPLAY_MS);
            showdownResultTimerRef.current = window.setTimeout(() => {
                setShowdownResult(null);
            }, SHOWDOWN_DISPLAY_MS);
        } else if (data.phase !== 'SHOWDOWN') {
            setShowdown(null);
            setShowdownResult(null);
            clearShowdownTimers();
        }

        if (data.players) {
            const myPlayer = data.players.find((p) => p.name === auth.playerName);
            if (myPlayer?.id) {
                setMyPlayerId(myPlayer.id);
            }
        }
    }, [auth.playerName, auth.roomId, clearShowdownTimers]);

    const applyIncomingPrivateState = useCallback((payload: IncomingPrivateStatePayload) => {
        const nextHoleCards = Array.isArray(payload.holeCards) ? payload.holeCards : [];
        setPrivateState({ holeCards: nextHoleCards });

        if (payload.playerId) {
            setMyPlayerId((prev) => prev ?? payload.playerId ?? null);
        }
    }, []);

    useEffect(() => {
        let mounted = true;

        const redirectToLobby = (message: string) => {
            const cleanMsg = normalizeErrorMessage(message);
            setNotification(cleanMsg);
            setLoadingStatus(cleanMsg || 'Returning to lobby...');
            setTimeout(() => {

                if (!mounted) {
                    return;
                }
                onLeave?.();
            }, ROOM_CLOSED_REDIRECT_MS);
        };

        const hydrateSession = async () => {
            setLoadingStatus('Restoring your seat...');

            try {
                const roomData = await pokerApi.getRoomInfo(auth.roomId, auth.token);
                if (!mounted) {
                    return;
                }

                const playerStillInRoom = Array.isArray(roomData.players)
                    && roomData.players.some((player: { name?: string }) => player.name === auth.playerName);

                if (!playerStillInRoom) {
                    redirectToLobby('Your seat is no longer active. Returning to lobby...');
                    return;
                }

                setRoomState((prev) => ({
                    ...prev,
                    roomId: roomData.roomId,
                    roomName: roomData.roomName,
                    players: roomData.players.map((p: { name: string; isHost: boolean }) => ({ name: p.name, isHost: p.isHost })),
                    maxPlayers: roomData.maxPlayers,
                    canStart: roomData.canStartGame,
                    gameStarted: roomData.gameStarted,
                }));

                // Only attempt to restore game state if the backend says a game was actually started.
                // This prevents 404 "Error" logs in the browser console when joining a fresh lobby.
                if (!roomData.gameStarted) {
                    setLoadingStatus('Connected to Vault...');
                    return;
                }
            } catch (err) {

                if (!mounted) {
                    return;
                }

                const statusCode = getErrorStatusCode(err);
                if (statusCode === 403 || statusCode === 404) {
                    redirectToLobby('Session expired. Returning to lobby...');
                } else {
                    console.error('Room info fetch error:', err);
                    setLoadingStatus('Reconnecting to Vault...');
                }
                return;
            }

            try {
                const fetchTime = Date.now();
                const snapshot = await pokerApi.getGameState(auth.roomId, auth.token);
                if (!mounted) {
                    return;
                }

                if (isGameStatePayload(snapshot) && fetchTime >= lastStateSyncTime.current) {
                    lastStateSyncTime.current = fetchTime;
                    applyIncomingGameState(snapshot);

                    try {
                        const privateSnapshot = await pokerApi.getPrivateState(auth.roomId, auth.token);
                        if (mounted && isPrivateStatePayload(privateSnapshot)) {
                            applyIncomingPrivateState(privateSnapshot);
                        }
                    } catch (privateErr) {
                        const privateStatusCode = getErrorStatusCode(privateErr);
                        if (privateStatusCode !== 404) {
                            console.warn('Private snapshot fetch error during hydrate:', privateErr);
                        }
                    }

                    setLoadingStatus('Seat restored. Syncing live updates...');
                    return;
                }
            } catch (err) {
                if (!mounted) {
                    return;
                }

                const statusCode = getErrorStatusCode(err);
                if (statusCode === 403) {
                    redirectToLobby('Your seat is no longer active. Returning to lobby...');
                    return;
                }

                if (statusCode !== 404) {
                    console.error('Game snapshot fetch error:', err);
                    setLoadingStatus('Reconnecting to table...');
                    return;
                }
            }

            setLoadingStatus('Connected to Vault...');
        };

        void hydrateSession();

        return () => { mounted = false; };
    }, [auth.playerName, auth.roomId, auth.token, onLeave, applyIncomingGameState, applyIncomingPrivateState, getErrorStatusCode, isGameStatePayload, isPrivateStatePayload]);

    useEffect(() => {
        const client = createStompClient(auth.token);
        stompClientRef.current = client;
        // For testing in chrome dev console
        (window as any).pokerSocket = client;

        client.onConnect = () => {
            console.log('Connected to WebSocket');

            const subscribeToMany = (destinations: string[], handler: (body: string) => void) => {
                destinations.forEach((destination) => {
                    client.subscribe(destination, (msg) => handler(msg.body));
                });
            };

            const subscribeToPrivateStateByName = (playerName: string) => {
                const encodedName = encodeURIComponent(playerName);
                if (privateSubscribedByName.current && privateSubscribedPlayerName.current === encodedName) {
                    return;
                }

                privateSubscribedByName.current = true;
                privateSubscribedPlayerName.current = encodedName;
                subscribeToMany([
                    `/game/${auth.roomId}/player-name/${encodedName}/private`,
                    `/topic/game/${auth.roomId}/player-name/${encodedName}/private`,
                ], (privBody) => {
                    try {
                        const parsed = JSON.parse(privBody);

                        // Handle action errors from WebSocket back to the UI
                        if (parsed.type === 'ACTION_ERROR' && typeof parsed.message === 'string') {
                            const normalized = normalizeErrorMessage(parsed.message);
                            setNotification(normalized);

                            // Re-apply special formatting for raise errors if possible
                            const isBetRaiseBackendError = /bet|raise|insufficient|amount|chip/i.test(parsed.message);
                            if (isBetRaiseBackendError) {
                                setRaiseError(normalized);
                                setNotification('That bet size is not allowed. Adjust the amount and try again.');
                            }

                            setTimeout(() => setNotification(null), 4000);
                            return;
                        }


                        if (isPrivateStatePayload(parsed)) {
                            applyIncomingPrivateState(parsed);
                        }
                    } catch (parseError) {
                        console.warn('Ignoring malformed private payload:', privBody, parseError);
                    }
                });
            };

            // Subscribe immediately by stable player name so the first hand's private cards are not missed.
            subscribeToPrivateStateByName(auth.playerName);

            if (auth.playerId) {
                setMyPlayerId(auth.playerId);
            }

            // Subscribe to Room Updates
            subscribeToMany([
                `/rooms${auth.roomId}`,
                `/rooms/${auth.roomId}`,
                `/topic/rooms/${auth.roomId}`,
            ], (body) => {
                const update = JSON.parse(body) as RoomUpdate;
                if (update.message === 'ROOM_CLOSED') {
                    const hostLeftMessage = 'Host left the lobby. Returning to main lobby...';
                    setNotification(hostLeftMessage);
                    setLoadingStatus(hostLeftMessage);
                    setRoomState(null);
                    setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
                    return;
                }

                if (update.message === 'ROOM_CREATED' || update.message === 'PLAYER_JOINED' || update.message === 'PLAYER_LEFT') {
                    setRoomState((prev) => {
                        const nextBase: RoomUpdate['data'] = {
                            ...(prev ?? {
                                roomId: auth.roomId,
                                roomName: auth.roomId,
                                players: [{ name: auth.playerName, isHost: false }],
                            }),
                            ...(update.data ?? {}),
                        };

                        // Some backend events contain only `player/currentCount` for joins/leaves.
                        // Keep a locally merged list so players remain visible between full snapshots.
                        if (update.message === 'PLAYER_JOINED' && update.data?.player) {
                            const players = nextBase.players ?? [];
                            if (!players.some((p) => p.name === update.data?.player)) {
                                nextBase.players = [...players, { name: update.data.player, isHost: false }];
                            }
                        }

                        if (update.message === 'PLAYER_LEFT' && update.data?.player) {
                            const players = nextBase.players ?? [];
                            nextBase.players = players.filter((p) => p.name !== update.data?.player);
                        }

                        if (update.data?.canStartGame !== undefined) {
                            nextBase.canStart = update.data.canStartGame;
                        }

                        if (!nextBase.players || nextBase.players.length === 0) {
                            nextBase.players = [{ name: auth.playerName, isHost: false }];
                        }

                        return nextBase;
                    });
                }
            });

            // Subscribe to Game State
            subscribeToMany([
                `/game/${auth.roomId}`,
                `/topic/game/${auth.roomId}`,
            ], (body) => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(body);
                } catch (parseError) {
                    console.warn('Ignoring malformed game payload:', body, parseError);
                    return;
                }

                if (!isObject(parsed)) {
                    console.warn('Ignoring non-object game payload:', parsed);
                    return;
                }

                const messageType = typeof parsed.type === 'string' ? parsed.type : null;
                const messageText = typeof parsed.message === 'string' ? parsed.message : null;

                // Note: The backend DTO for game state does not include `type`; it includes `phase`.
                if (messageType === 'PLAYER_NOTIFICATION'
                    || messageType === 'AUTO_ADVANCE_START'
                    || messageType === 'AUTO_ADVANCE_COMPLETE') {
                    if (messageText) {
                        setNotification(normalizeErrorMessage(messageText));
                    }
                    setTimeout(() => setNotification(null), 4000);
                    return;
                }


                if (messageType === 'GAME_END') {
                    setNotification(null);
                    
                    const endMsg = normalizeErrorMessage(messageText ?? 'Game finished. Returning to lobby...');
                    const winnerName = typeof parsed.winner === 'string' ? parsed.winner : null;
                    const winnerChips = typeof parsed.winnerChips === 'number' ? parsed.winnerChips : undefined;
                    const isForfeit = parsed.isForfeit === true;

                    if (winnerName && isForfeit) {
                        setShowdownResult({
                            winners: [winnerName],
                            winningsPerPlayer: winnerChips,
                            players: [{ name: winnerName }],
                        } as any);
                    } else {
                        setNotification(endMsg);
                    }

                    setTimeout(() => {
                        setShowdownResult(null);
                        setNotification(null);

                        setGameState(null);
                        setPrivateState(null);
                        setShowdown(null);
                        clearShowdownTimers();
                        // Fetch fresh lobby info so we re-enter cleanly
                        pokerApi.getRoomInfo(auth.roomId, auth.token).then(r => {
                            setRoomState({
                                roomId: r.roomId,
                                roomName: r.roomName,
                                players: r.players.map((p: { name: string; isHost: boolean }) => ({ name: p.name, isHost: p.isHost })),
                                maxPlayers: r.maxPlayers,
                                canStart: r.canStartGame,
                            });
                        }).catch(() => {
                            onLeave?.();
                        });
                    }, GAME_END_DISPLAY_MS);
                    return;
                }

                if (!isGameStatePayload(parsed)) {
                    console.warn('Ignoring non-game payload on game topic:', {
                        keys: Object.keys(parsed),
                        claimWinAvailable: parsed.claimWinAvailable,
                        claimWinPlayerName: parsed.claimWinPlayerName,
                        payload: parsed,
                    });
                    return;
                }

                lastStateSyncTime.current = Date.now();
                applyIncomingGameState(parsed);
            });

            // Unconditionally sync state on connect to catch missed updates
            const syncTime = Date.now();
            void pokerApi.getGameState(auth.roomId, auth.token)
                .then((snapshot) => {
                    if (isGameStatePayload(snapshot) && syncTime >= lastStateSyncTime.current) {
                        lastStateSyncTime.current = syncTime;
                        applyIncomingGameState(snapshot);
                    }
                })
                .catch((err) => {
                        const statusCode = getErrorStatusCode(err);
                        if (statusCode === 403) {
                            const message = normalizeErrorMessage('Your seat is no longer active. Returning to lobby...');
                            setNotification(message);
                            setLoadingStatus(message || 'Returning...');
                            setTimeout(() => onLeave?.(), ROOM_CLOSED_REDIRECT_MS);
                            return;
                        }


                        if (statusCode !== 404) {
                            console.warn('State re-sync failed after connect:', err);
                        }
                    });

                void pokerApi.getPrivateState(auth.roomId, auth.token)
                    .then((privateSnapshot) => {
                        if (isPrivateStatePayload(privateSnapshot)) {
                            applyIncomingPrivateState(privateSnapshot);
                        }
                    })
                    .catch((err) => {
                        const statusCode = getErrorStatusCode(err);
                        if (statusCode !== 404) {
                            console.warn('Private state re-sync failed after connect:', err);
                        }
                    });

        };

        client.activate();

        return () => {
            clearShowdownTimers();
            client.deactivate();
        };
    }, [auth, applyIncomingGameState, applyIncomingPrivateState, clearShowdownTimers, getErrorStatusCode, isGameStatePayload, isObject, isPrivateStatePayload, onLeave]);

    const handleAction = (action: string, amount: number = 0) => {
        const targetGameId = gameState?.gameId ?? auth.roomId;

        if (!stompClientRef.current?.connected) {
            console.warn('STOMP client not connected, action deferred');
            setNotification(normalizeErrorMessage('Waiting for table connection...'));
            return;
        }


        try {
            // Send action through the existing heartbeat pipe
            stompClientRef.current.publish({
                destination: `/app/${targetGameId}/action`,
                body: JSON.stringify({ action, amount })
            });

            // Optimistic reset (success/error will sync via game state or private channel)
            setRaiseAmount('');
            setRaiseError(null);
        } catch (err) {
            console.error('Failed to publish action:', err);
            setNotification('System malfunction. Please refresh.');
        }
    };

    const handleStartGame = async () => {
        try {
            await pokerApi.startGame(auth.roomId, auth.token);
        } catch (err) {
            console.error('Failed to start game:', err);
            const rawMsg = err instanceof Error ? err.message : 'Only the host can initiate the royal action.';
            setNotification(normalizeErrorMessage(rawMsg));
            setTimeout(() => setNotification(null), 4000);
        }

    };

    const handleClaimWin = async () => {
        const activeGameId = gameState?.gameId ?? auth.roomId;

        try {
            setClaimPending(true);
            await pokerApi.claimWin(activeGameId, auth.token);
            // We intentionally do not clear claimPending yet, as the hand will resolve and 
            // GAME_END will nuke the state, transitioning the view cleanly.
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Claim win failed.';
            setNotification(normalizeErrorMessage(message));
            setTimeout(() => setNotification(null), 4000);
            setClaimPending(false);
        }
    };

    const handleLeaveGame = async () => {
        try {
            clearShowdownTimers();
            setPrivateState(null);
            if (gameState?.gameId) {
                await pokerApi.leaveGame(gameState.gameId, auth.token);
            }
            await pokerApi.leaveRoom(auth.roomId, auth.token);
            onLeave?.();
        } catch {
            setNotification('Failed to leave game safely.');
            setTimeout(() => setNotification(null), 4000);
            onLeave?.();
        }
    };

    // Lobby View
    if (roomState && !gameState) {
        return (
            <div className="min-h-screen p-8 flex flex-col items-center justify-center">

                {/* Notifications */}
                <AnimatePresence>
                    {notification && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: "-50%" }}
                            animate={{ opacity: 1, scale: 1, x: "-50%" }}
                            exit={{ opacity: 0, scale: 0.9, x: "-50%" }}
                            className="fixed top-24 left-1/2 z-50 bg-gold-secondary text-surface px-6 py-3 rounded-2xl md:rounded-full font-headline font-bold shadow-2xl max-w-[90vw] md:max-w-2xl text-center"
                        >
                            {notification}
                        </motion.div>

                    )}
                </AnimatePresence>

                {/* Leave Button */}
                <div className="fixed top-24 right-8 z-50">
                    <Button variant="outline" size="sm" onClick={handleLeaveGame} className="border-red-500/50 text-red-500 hover:bg-red-500/10">
                        LEAVE LOBBY
                    </Button>
                </div>

                <div className="w-full max-w-5xl">
                    <div className="mb-12">
                        <span className="text-emerald-primary text-[10px] font-bold tracking-[0.3em] uppercase">Active Tournament</span>
                        <h1 className="text-5xl font-headline font-bold mt-2">GAME LOBBY: <br /><span className="text-emerald-primary/60">{roomState.roomName || 'VAULT_ROOM'}</span></h1>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {roomState.players?.map((p, i) => (
                                <Card key={i} className={cn("p-6", p.isHost && "ring-1 ring-gold-secondary/30")}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-headline font-bold text-xl">{p.name}</h3>
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">
                                                {p.isHost ? 'HOST • LEVEL 84 HIGH ROLLER' : 'CONNECTED'}
                                            </p>
                                        </div>
                                        <div className={cn("w-3 h-3 rounded-full", p.isHost ? "bg-gold-secondary" : "bg-emerald-primary")} />
                                    </div>
                                </Card>
                            ))}
                            {Array.from({ length: (roomState.maxPlayers || 6) - (roomState.players?.length || 0) }).map((_, i) => (
                                <div key={i} className="border border-white/5 rounded-xl p-6 flex items-center justify-center border-dashed">
                                    <p className="text-zinc-700 text-xs uppercase tracking-widest italic">Waiting for more...</p>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-6">
                            <Card className="bg-surface-high">
                                <h3 className="font-headline font-bold mb-4 flex items-center gap-2">
                                    <Info className="w-4 h-4 text-emerald-primary" /> Table Rules
                                </h3>
                                <div className="space-y-4 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500 uppercase text-[10px] font-bold">Blinds</span>
                                        <span className="text-emerald-primary font-bold">$10 / $20</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500 uppercase text-[10px] font-bold">Min Buy-in</span>
                                        <span className="text-emerald-primary font-bold">$2,000</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500 uppercase text-[10px] font-bold">Format</span>
                                        <span className="text-emerald-primary font-bold">No Limit Hold'em</span>
                                    </div>
                                </div>
                            </Card>

                            {roomState.players?.find(p => p.name === auth.playerName)?.isHost ? (
                                <>
                                    <Button
                                        variant="primary"
                                        size="xl"
                                        className="w-full"
                                        onClick={handleStartGame}
                                        disabled={!roomState.canStart}
                                    >
                                        <Play className="w-5 h-5 fill-current" />
                                        START GAME
                                    </Button>
                                    <p className="text-center text-[10px] text-zinc-600 uppercase tracking-widest">Host controls only</p>
                                </>
                            ) : (
                                <div className="border border-white/5 rounded-xl p-6 flex flex-col items-center justify-center border-dashed gap-3">
                                    <div className="w-6 h-6 border-2 border-emerald-primary border-t-transparent rounded-full animate-spin" />
                                    <p className="text-zinc-500 text-xs uppercase tracking-widest text-center">Waiting for host to start...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Game Table View
    if (gameState) {
        const pivotIndex = myPlayerId
            ? gameState.players.findIndex((p) => p.id === myPlayerId)
            : gameState.players.findIndex((p) => p.name === auth.playerName);
        const orderedPlayers = pivotIndex < 0
            ? gameState.players
            : gameState.players.map((_, offset) => gameState.players[(pivotIndex + offset) % gameState.players.length]);

        const isMyTurn = myPlayerId ? gameState.currentPlayerId === myPlayerId : false;
        const me = myPlayerId ? gameState.players.find(p => p.id === myPlayerId) : undefined;
        const currentTurnPlayer = gameState.players.find((p) => p.id === gameState.currentPlayerId);
        const isWaitingForReconnect = currentTurnPlayer?.status === 'DISCONNECTED';
        const canClaimWin = Boolean(gameState.claimWinAvailable && gameState.claimWinPlayerName === auth.playerName);
        const isSelfDisconnected = me?.status === 'DISCONNECTED';
        const getDisconnectSecondsRemaining = (player: (typeof orderedPlayers)[number]) => {
            if (player.status !== 'DISCONNECTED') {
                return undefined;
            }

            const disconnectDeadlineEpochMs = typeof player.disconnectDeadlineEpochMs === 'number'
                ? player.disconnectDeadlineEpochMs
                : undefined;

            if (disconnectDeadlineEpochMs === undefined) {
                return undefined;
            }

            return Math.max(0, Math.ceil((disconnectDeadlineEpochMs - nowMs) / 1000));
        };
        const actionType = (gameState.currentBet || 0) === 0 ? 'BET' : 'RAISE';
        const minRaiseAmount = actionType === 'BET'
            ? 1
            : Math.max(1, (gameState.currentBet || 0) - (me?.currentBet ?? 0) + 1);
        const availableChips = me?.chips ?? 0;
        const callAmount = Math.max(0, (gameState.currentBet || 0) - (me?.currentBet ?? 0));
        const callExceedsStack = callAmount > availableChips;
        const uncalledAmount = gameState.uncalledAmount ?? 0;
        const potBreakdown = gameState.pots && gameState.pots.length > 0
            ? gameState.pots
            : [gameState.pot];
        const displayedPot = Math.max(0, gameState.pot - uncalledAmount);
        const mainPot = potBreakdown[0] ?? gameState.pot;
        const sidePots = potBreakdown.slice(1);
        const rawRaise = raiseAmount.trim();
        const parsedRaiseAmount = rawRaise === '' ? NaN : Number.parseInt(rawRaise, 10);
        let computedRaiseError: string | null = null;

        if (rawRaise !== '') {
            if (!/^\d+$/.test(rawRaise)) {
                computedRaiseError = 'Enter a whole number.';
            } else if (!Number.isFinite(parsedRaiseAmount) || parsedRaiseAmount <= 0) {
                computedRaiseError = 'Amount must be greater than 0.';
            } else if (parsedRaiseAmount < minRaiseAmount) {
                if (actionType === 'RAISE' && parsedRaiseAmount === availableChips) {
                    computedRaiseError = `Minimum raise is ${minRaiseAmount.toLocaleString()} chips. Your full stack is smaller, use All In${callExceedsStack ? '' : ' or Call'}.`;
                } else {
                    computedRaiseError = actionType === 'BET'
                        ? 'Bet amount must be at least 1 chip.'
                        : `Minimum raise is ${minRaiseAmount.toLocaleString()} chips.`;
                }
            } else if (parsedRaiseAmount > availableChips) {
                computedRaiseError = `You only have ${availableChips.toLocaleString()} chips.`;
            }
        }

        const activeRaiseError = raiseError ?? computedRaiseError;
        const canSubmitRaise = rawRaise !== '' && !activeRaiseError;

        return (
            <div className={cn(
                "h-screen flex flex-col relative",
                "overflow-auto"
            )}>

                {/* Win Modal/Tab */}
                <AnimatePresence>
                    {showdownResult && (
                        <motion.div
                            initial={{ y: -50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -50, opacity: 0 }}
                            className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] bg-surface-highest/95 backdrop-blur border border-emerald-primary/30 rounded-2xl p-6 shadow-[0_0_40px_rgba(16,185,129,0.2)] text-center min-w-[300px]"
                        >
                            <h2 className="text-xl font-headline font-bold text-white mb-2">
                                {showdownResult.players?.length === 1 ? 'Game Over' : 'Round Over'}
                            </h2>

                            {showdownResult.winners && showdownResult.winners.length > 0 ? (
                                <div className="space-y-4">
                                    <p className="text-emerald-primary text-lg font-bold">
                                        {showdownResult.winners.length > 1
                                            ? `It's a tie: ${showdownResult.winners.join(', ')}`
                                            : showdownResult.players?.length === 1
                                                ? `${showdownResult.winners[0]} won by forfeit!`
                                                : `${showdownResult.winners[0]} won!`}
                                    </p>

                                    {showdownResult.winningsPerPlayer ? (
                                        <div className="space-y-1">
                                            <p className="text-gold-secondary font-bold text-sm">
                                                +${showdownResult.winningsPerPlayer.toLocaleString()}
                                            </p>
                                            {showdownResult.winners.length > 1 ? (
                                                <p className="text-zinc-500 text-[10px] uppercase tracking-widest">
                                                    Pot split equally
                                                </p>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    {/* Hand rank display */}
                                    {(() => {
                                        const isForfeit = showdownResult.players?.length === 1;
                                        if (isForfeit) return null;

                                        const winningPlayer = showdownResult.players.find(p => showdownResult.winners?.includes(p.name));
                                        if (winningPlayer?.handRank && winningPlayer.handRank !== 'NO_HAND') {
                                            return (
                                                <p className="text-zinc-400 text-xs uppercase tracking-widest mt-2">
                                                    Won with <span className="text-zinc-200">{winningPlayer.handRank.replace(/_/g, ' ')}</span>
                                                </p>
                                            );
                                        } else {
                                            return (
                                                <p className="text-zinc-400 text-xs uppercase tracking-widest mt-2">
                                                    Won the round
                                                </p>
                                            );
                                        }
                                    })()}
                                </div>
                            ) : (
                                <p className="text-zinc-400 text-sm">Processing results...</p>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Leave Button */}
                <div className="fixed bottom-6 right-8 z-40">
                    <Button variant="outline" size="sm" onClick={handleLeaveGame} className="border-red-500/50 text-red-500 hover:bg-red-500/10">
                        LEAVE TABLE
                    </Button>
                </div>

                {canClaimWin && (
                    <div className="absolute bottom-6 left-4 md:bottom-6 md:left-8 z-40">
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleClaimWin}
                            disabled={claimPending}
                            className="shadow-[0_0_24px_rgba(170,234,208,0.35)]"
                        >
                            {claimPending ? 'CLAIMING...' : 'CLAIM THE WIN'}
                        </Button>
                    </div>
                )}

                {/* Table Area */}
                <div className={cn(
                    "relative flex flex-1 min-w-[800px] min-h-[600px]",
                    isCompactTable ? "items-center justify-center p-2" : "items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10"
                )}>
                    <div className={cn(
                        "poker-table-gradient border-surface-high shadow-[0_0_100px_rgba(0,0,0,0.8)] relative transition-all duration-300 overflow-visible",
                        tableTier === 'compact' && "w-full h-full aspect-[2.15/1] rounded-[72px] border-[8px] min-w-[800px] min-h-[600px]",
                        tableTier === 'standard' && "w-full h-full aspect-[2.15/1] rounded-[170px] border-[10px]",
                        tableTier === 'wide' && "w-full h-full aspect-[2.35/1] rounded-[220px] border-[12px]",
                    )}>

                        {/* Community Cards */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 md:gap-6">
                            <div className="bg-black/40 px-3 md:px-6 py-2 rounded-full border border-white/5 backdrop-blur-md flex items-center gap-2 md:gap-3">
                                <Coins className="w-3 h-3 md:w-4 md:h-4 text-gold-secondary" />
                                <span className="font-headline font-bold text-lg md:text-2xl tracking-tight text-white">
                                    ${displayedPot.toLocaleString()}
                                </span>
                            </div>

                            {!isCompactTable && (
                                <div className="flex flex-wrap items-center justify-center gap-2 px-4">
                                    <div className="bg-black/35 px-3 py-1 rounded-full border border-white/10">
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">Main Pot</span>
                                        <span className="ml-2 text-sm font-bold text-gold-secondary">${mainPot.toLocaleString()}</span>
                                    </div>
                                    {sidePots.map((amount, index) => (
                                        <div
                                            key={`side-pot-${index}`}
                                            className="bg-black/35 px-3 py-1 rounded-full border border-emerald-primary/30"
                                        >
                                            <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">
                                                Side Pot {index + 1}
                                            </span>
                                            <span className="ml-2 text-sm font-bold text-emerald-primary">${amount.toLocaleString()}</span>
                                        </div>
                                    ))}
                                    {uncalledAmount > 0 && (
                                        <div className="bg-black/35 px-3 py-1 rounded-full border border-red-400/40">
                                            <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">Uncalled</span>
                                            <span className="ml-2 text-sm font-bold text-red-300">${uncalledAmount.toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3">
                                {gameState.communityCards.map((card, i) => (
                                    <motion.div key={i} initial={{ scale: 0, rotateY: 90 }} animate={{ scale: 1, rotateY: 0 }}>
                                        <CardUI card={card} />
                                    </motion.div>
                                ))}
                                {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                                    <div key={i} className="w-12 h-16 border-2 border-white/5 rounded-md border-dashed flex items-center justify-center">
                                        <span className="text-[8px] text-white/10 font-bold uppercase tracking-widest">
                                            {i === 0 && gameState.communityCards.length === 3 ? 'TURN' : i === 1 && gameState.communityCards.length === 4 ? 'RIVER' : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Players */}
                        {orderedPlayers.map((p, i) => {
                            const seat = getSeatPosition(i, orderedPlayers.length, tableTier);
                            const showdownPlayer = showdown?.players.find(sp => sp.id === p.id);
                            const isSelf = p.id === myPlayerId;
                            const canRenderCards = p.status === 'ACTIVE' || p.status === 'ALL_IN' || p.status === 'DISCONNECTED';
                            const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
                            const privateCards = isSelf ? privateState?.holeCards ?? [] : [];
                            const displayCards = shouldReveal
                                ? showdownPlayer!.holeCards!
                                : privateCards;

                            return (
                                <div
                                    key={p.id}
                                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20"
                                    style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                                >
                                    <PlayerPod
                                        player={p}
                                        isCurrent={gameState.currentPlayerId === p.id}
                                        blindLabel={p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : undefined}
                                        disconnectSecondsRemaining={getDisconnectSecondsRemaining(p)}
                                        size={isCompactTable ? 'sm' : 'md'}
                                    />

                                    {canRenderCards && (
                                        <div className={cn(
                                            "absolute z-10 flex flex-col items-center",
                                            seat.cardPlacement === 'left' && "right-full top-1/2 -translate-y-1/2 mr-2",
                                            seat.cardPlacement === 'right' && "left-full top-1/2 -translate-y-1/2 ml-2",
                                            seat.cardPlacement === 'below' && "left-1/2 top-full -translate-x-1/2 mt-2",
                                        )}>
                                            <div className="flex gap-1 justify-center">
                                                {displayCards.length > 0
                                                    ? displayCards.map((c, ci) => (
                                                        <motion.div
                                                            key={`cards-${p.id}-${ci}`}
                                                            initial={{ scale: 0.9, opacity: 0 }}
                                                            animate={{ scale: 1, opacity: 1 }}
                                                            transition={{ delay: ci * 0.08 }}
                                                        >
                                                            <CardUI card={c} className={cn(
                                                                isSelf
                                                                    ? isCompactTable ? "w-8 h-12" : "w-11 h-16 md:w-12 md:h-16"
                                                                    : isCompactTable ? "w-5 h-8" : "w-7 h-10 md:w-8 md:h-12",
                                                                "shadow-md"
                                                            )} />
                                                        </motion.div>
                                                    ))
                                                    : !isSelf
                                                        ? [0, 1].map((ci) => (
                                                            <CardUI
                                                                key={`hidden-${p.id}-${ci}`}
                                                                card=""
                                                                hidden
                                                                className={cn(
                                                                    isCompactTable ? "w-5 h-8" : "w-7 h-10 md:w-8 md:h-12",
                                                                    "shadow-md opacity-90"
                                                                )}
                                                            />
                                                        ))
                                                        : null}
                                            </div>

                                            {showdownPlayer?.handRank && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: 0.25 }}
                                                    className="mt-1 text-[9px] font-headline font-bold uppercase tracking-widest text-emerald-primary bg-black/80 px-2 py-0.5 rounded-full whitespace-nowrap border border-emerald-primary/30 shadow-lg"
                                                >
                                                    {showdownPlayer.handRank.replace(/_/g, ' ')}
                                                </motion.div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {isWaitingForReconnect && currentTurnPlayer && !isCompactTable && (
                    <div className="px-4 md:px-8 pb-3">
                        <div className="mx-auto max-w-3xl bg-amber-500/20 border border-amber-300/40 rounded-xl px-4 py-3 text-center backdrop-blur-md">
                            <p className="text-amber-200 font-headline font-bold uppercase tracking-wider text-xs md:text-sm">
                                Waiting for {currentTurnPlayer.name} to reconnect...
                            </p>
                        </div>
                    </div>
                )}

                {/* Action Panel */}
                <AnimatePresence>
                    {isMyTurn && !isSelfDisconnected && (
                        <motion.div
                            initial={{ y: 100 }}
                            animate={{ y: 0 }}
                            exit={{ y: 100 }}
                            className={cn(
                                "bg-surface-high border-t border-white/5 flex flex-wrap items-center justify-center gap-3 md:gap-4",
                                isCompactTable ? "p-2" : "p-4 md:p-6"
                            )}
                        >
                            <Button variant="outline" size={isCompactTable ? "sm" : "md"} onClick={() => handleAction('FOLD')}>Fold</Button>
                            {(!me || (me.currentBet ?? 0) >= (gameState.currentBet || 0)) ? (
                                <Button variant="outline" size={isCompactTable ? "sm" : "md"} onClick={() => handleAction('CHECK')}>Check</Button>
                            ) : callExceedsStack ? (
                                <Button variant="outline" size={isCompactTable ? "sm" : "md"} onClick={() => handleAction('ALL_IN')}>
                                    All In ${availableChips.toLocaleString()}
                                </Button>
                            ) : (
                                <Button variant="outline" size={isCompactTable ? "sm" : "md"} onClick={() => handleAction('CALL')}>
                                    Call ${callAmount.toLocaleString()}
                                </Button>
                            )}

                            {/* Custom Bet / Raise Input */}
                            <div className={cn(
                                "flex items-center gap-2 bg-black/40 p-1 rounded-md border border-white/10",
                                isCompactTable ? "" : "ml-4"
                            )}>
                                <span className={cn("font-bold", isCompactTable ? "text-zinc-400 text-xs pl-2" : "text-zinc-400 pl-3")}>
                                    $
                                </span>
                                <input
                                    type="number"
                                    className={cn(
                                        "bg-transparent text-white font-bold outline-none placeholder:text-zinc-600",
                                        isCompactTable ? "w-12 text-xs" : "w-24"
                                    )}
                                    placeholder={minRaiseAmount.toString()}
                                    value={raiseAmount}
                                    onChange={e => {
                                        setRaiseAmount(e.target.value);
                                        setRaiseError(null);
                                    }}
                                    min={minRaiseAmount}
                                    step={1}
                                />
                                <Button
                                    variant="primary"
                                    disabled={!canSubmitRaise}
                                    size={isCompactTable ? "sm" : "md"}
                                    onClick={() => {
                                        if (!canSubmitRaise) {
                                            setRaiseError(activeRaiseError ?? 'Enter a valid amount.');
                                            return;
                                        }

                                        const amount = Number.parseInt(rawRaise, 10);
                                        handleAction(actionType, amount);
                                        setRaiseAmount(''); // clear after sending
                                        setRaiseError(null);
                                    }}
                                >
                                    {(gameState.currentBet || 0) === 0 ? 'Bet' : 'Raise'}
                                </Button>
                            </div>
                            {activeRaiseError && (
                                <p className="w-full max-w-md mx-auto text-center text-[10px] md:text-[11px] text-red-400 font-bold uppercase tracking-wider line-clamp-2 md:line-clamp-3">
                                    {activeRaiseError}
                                </p>
                            )}

                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Notifications */}
                <AnimatePresence>
                    {notification && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: "-50%" }}
                            animate={{ opacity: 1, scale: 1, x: "-50%" }}
                            exit={{ opacity: 0, scale: 0.9, x: "-50%" }}
                            className="fixed top-24 left-1/2 z-[100] bg-gold-secondary text-surface px-6 py-3 rounded-2xl md:rounded-full font-headline font-bold shadow-2xl max-w-[90vw] md:max-w-2xl text-center"
                        >
                            {notification}
                        </motion.div>

                    )}
                </AnimatePresence>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin" />
                <p className="font-headline text-xs tracking-widest uppercase text-emerald-primary">{loadingStatus}</p>
            </div>
        </div>
    );
}
