import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client } from '@stomp/stompjs';
import { createStompClient, pokerApi } from './services/api';
import {type GameState, type RoomUpdate, cn, type AuthResponse } from './types';
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

    const isObject = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null;

    const isGameStatePayload = (
        value: unknown,
    ): value is Omit<GameState, 'gameId'> & { gameId?: string } => {
        if (!isObject(value)) {
            return false;
        }

        return (typeof value.gameId === 'string' || value.gameId === undefined)
            && typeof value.phase === 'string'
            && Array.isArray(value.players)
            && Array.isArray(value.communityCards)
            && typeof value.pot === 'number';
    };

    const [roomState, setRoomState] = useState<RoomUpdate['data'] | null>(() => ({
        roomId: auth.roomId,
        roomName: auth.roomId,
        players: [{ name: auth.playerName, isHost: false }],
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

    const stompClientRef = useRef<Client | null>(null);
    const privateSubscribedByName = useRef(false);
    const privateSubscribedPlayerName = useRef<string | null>(null);
    const gameIdRef = useRef<string | null>(null);
    const showdownTimerRef = useRef<number | null>(null);
    const showdownResultTimerRef = useRef<number | null>(null);

    const isMobileTable = windowWidth < 900;

    type SeatPosition = {
        left: number;
        top: number;
        cardsAbove: boolean;
    };

    const getSeatPosition = (index: number, total: number, mobile: boolean): SeatPosition => {
        if (index === 0) {
            return {
                left: 50,
                top: mobile ? 84 : 86,
                cardsAbove: true,
            };
        }

        if (total === 2) {
            return {
                left: 50,
                top: mobile ? 16 : 14,
                cardsAbove: false,
            };
        }

        const others = total - 1;
        const t = (index - 1) / Math.max(1, others - 1);
        const angleDegrees = 210 - t * 240;
        const angle = (angleDegrees * Math.PI) / 180;
        const radiusX = mobile ? 41 : 43;
        const radiusY = mobile ? 30 : 35;
        const left = 50 + radiusX * Math.cos(angle);
        const top = 50 + radiusY * Math.sin(angle);

        return {
            left,
            top,
            cardsAbove: top > 58,
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

    const clearShowdownTimers = () => {
        if (showdownTimerRef.current !== null) {
            window.clearTimeout(showdownTimerRef.current);
            showdownTimerRef.current = null;
        }

        if (showdownResultTimerRef.current !== null) {
            window.clearTimeout(showdownResultTimerRef.current);
            showdownResultTimerRef.current = null;
        }
    };

    useEffect(() => {
        let mounted = true;
        pokerApi.getRoomInfo(auth.roomId, auth.token)
            .then(data => {
                if (!mounted) return;
                setRoomState(prev => ({
                    ...prev,
                    roomId: data.roomId,
                    roomName: data.roomName,
                    players: data.players.map((p: any) => ({ name: p.name, isHost: p.isHost })),
                    maxPlayers: data.maxPlayers,
                    canStart: data.canStartGame,
                }));
            })
            .catch(err => {
                if (!mounted) return;
                console.error("Room info fetch error:", err);
                onLeave?.();
            });

        return () => { mounted = false; };
    }, [auth.roomId, auth.token, onLeave]);

    useEffect(() => {
        const client = createStompClient(auth.token);
        stompClientRef.current = client;

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
                    setPrivateState(JSON.parse(privBody));
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
                        setNotification(messageText);
                    }
                    setTimeout(() => setNotification(null), 4000);
                    return;
                }

                if (messageType === 'GAME_END') {
                    setNotification(messageText ?? 'Game finished. Returning to lobby...');
                    setTimeout(() => {
                        setNotification(null);
                        setGameState(null);
                        setPrivateState(null);
                        setShowdown(null);
                        setShowdownResult(null);
                        clearShowdownTimers();
                        // Fetch fresh lobby info so we re-enter cleanly
                        pokerApi.getRoomInfo(auth.roomId, auth.token).then(r => {
                            setRoomState({
                                roomId: r.roomId,
                                roomName: r.roomName,
                                players: r.players.map((p: any) => ({ name: p.name, isHost: p.isHost })),
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
                    console.warn('Ignoring non-game payload on game topic:', parsed);
                    return;
                }

                const data: GameState = {
                    ...parsed,
                    gameId: parsed.gameId ?? auth.roomId,
                };
                setGameState(data);
                setRoomState(null); // Game started, hide lobby

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
                } else {
                    setShowdown(null);
                    setShowdownResult(null);
                    clearShowdownTimers();
                }

                if (data.players) {
                    const myPlayer = data.players.find((p: any) => p.name === auth.playerName);
                    if (myPlayer?.id) {
                        setMyPlayerId(myPlayer.id);
                    }
                }
            });
        };

        client.activate();

        return () => {
            clearShowdownTimers();
            client.deactivate();
        };
    }, [auth]);

    const handleAction = async (action: string, amount: number = 0) => {
        try {
            await pokerApi.performAction(gameState?.gameId ?? auth.roomId, action, amount, auth.token);
        } catch (err) {
            console.error('Failed action:', err);
            const backendMessage = err instanceof Error ? err.message : 'Action failed. Please try again.';
            const isRaiseAction = action === 'BET' || action === 'RAISE';
            const isBetRaiseBackendError = /bet|raise|insufficient|amount|chip/i.test(backendMessage);

            if (isRaiseAction && isBetRaiseBackendError) {
                setRaiseError(backendMessage);
                setNotification('That bet size is not allowed. Adjust the amount and try again.');
            } else {
                setNotification(backendMessage);
            }

            setTimeout(() => setNotification(null), 4000);
        }
    };

    const handleStartGame = async () => {
        try {
            await pokerApi.startGame(auth.roomId, auth.token);
        } catch (err) {
            console.error('Failed to start game:', err);
            setNotification(err instanceof Error ? err.message : 'Only the host can initiate the royal action.');
            setTimeout(() => setNotification(null), 4000);
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
        } catch (err) {
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
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-gold-secondary text-surface px-6 py-3 rounded-full font-headline font-bold shadow-2xl"
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
                        <h1 className="text-5xl font-headline font-bold mt-2">GAME LOBBY: <br/><span className="text-emerald-primary/60">{roomState.roomName || 'VAULT_ROOM'}</span></h1>
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
        const actionType = (gameState.currentBet || 0) === 0 ? 'BET' : 'RAISE';
        const minRaiseAmount = actionType === 'BET'
            ? 1
            : Math.max(1, (gameState.currentBet || 0) - (me?.currentBet ?? 0) + 1);
        const availableChips = me?.chips ?? 0;
        const callAmount = Math.max(0, (gameState.currentBet || 0) - (me?.currentBet ?? 0));
        const callExceedsStack = callAmount > availableChips;
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
            <div className="min-h-screen flex flex-col overflow-hidden relative">
                
                {/* Win Modal/Tab */}
                <AnimatePresence>
                    {showdownResult && (
                        <motion.div 
                            initial={{ y: -50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -50, opacity: 0 }}
                            className="absolute top-8 left-1/2 -translate-x-1/2 z-[100] bg-surface-highest/95 backdrop-blur border border-emerald-primary/30 rounded-2xl p-6 shadow-[0_0_40px_rgba(16,185,129,0.2)] text-center min-w-[300px]"
                        >
                            <h2 className="text-xl font-headline font-bold text-white mb-2">Round Over</h2>
                            
                            {showdownResult.winners && showdownResult.winners.length > 0 ? (
                                <div className="space-y-4">
                                    <p className="text-emerald-primary text-lg font-bold">
                                        {showdownResult.winners.length > 1
                                            ? `It's a tie: ${showdownResult.winners.join(', ')}`
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
                <div className="absolute top-20 right-4 md:top-24 md:right-8 z-50">
                    <Button variant="outline" size="sm" onClick={handleLeaveGame} className="border-red-500/50 text-red-500 hover:bg-red-500/10">
                        LEAVE TABLE
                    </Button>
                </div>

                {/* Table Area */}
                <div className="flex-1 relative flex items-center justify-center p-3 md:p-8">
                    <div className={cn(
                        "w-full max-w-5xl poker-table-gradient border-surface-high shadow-[0_0_100px_rgba(0,0,0,0.8)] relative transition-all duration-300",
                        isMobileTable ? "aspect-[1.1/1] rounded-[80px] border-[8px]" : "aspect-[2/1] rounded-[200px] border-[12px]"
                    )}>

                        {/* Community Cards */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                            <div className="bg-black/40 px-6 py-2 rounded-full border border-white/5 backdrop-blur-md flex items-center gap-3">
                                <Coins className="w-4 h-4 text-gold-secondary" />
                                <span className="font-headline font-bold text-2xl tracking-tight text-white">
                  ${gameState.pot.toLocaleString()}
                </span>
                            </div>

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
                            const seat = getSeatPosition(i, orderedPlayers.length, isMobileTable);
                            const showdownPlayer = showdown?.players.find(sp => sp.id === p.id);
                            const isSelf = p.id === myPlayerId;
                            const shouldReveal = Boolean(showdownPlayer?.holeCards && showdownPlayer.holeCards.length > 0);
                            const privateCards = isSelf ? privateState?.holeCards ?? [] : [];
                            const displayCards = shouldReveal
                                ? showdownPlayer!.holeCards!
                                : privateCards;

                            return (
                                <div
                                    key={p.id}
                                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                                    style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                                >
                                    {seat.cardsAbove && (p.status === 'ACTIVE' || p.status === 'ALL_IN') && (
                                        <div className="mb-2 flex flex-col items-center z-10">
                                            <div className="flex gap-1 justify-center">
                                                {displayCards.length > 0
                                                    ? displayCards.map((c, ci) => (
                                                        <motion.div
                                                            key={`cards-top-${p.id}-${ci}`}
                                                            initial={{ scale: 0.9, opacity: 0 }}
                                                            animate={{ scale: 1, opacity: 1 }}
                                                            transition={{ delay: ci * 0.08 }}
                                                        >
                                                            <CardUI card={c} className={cn(
                                                                isSelf ? "w-10 h-14 md:w-11 md:h-16" : "w-8 h-12",
                                                                "shadow-md"
                                                            )} />
                                                        </motion.div>
                                                    ))
                                                    : !isSelf
                                                        ? [0, 1].map((ci) => (
                                                            <CardUI key={`hidden-top-${p.id}-${ci}`} card="" hidden className="w-8 h-12 shadow-md opacity-90" />
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

                                    <PlayerPod
                                        player={p}
                                        isCurrent={gameState.currentPlayerId === p.id}
                                        blindLabel={p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : undefined}
                                        size={isMobileTable ? 'sm' : 'md'}
                                    />

                                    {(p.status === 'ACTIVE' || p.status === 'ALL_IN') && !seat.cardsAbove && (
                                        <div className="mt-2 flex flex-col items-center z-10">
                                            <div className="flex gap-1 justify-center">
                                                {displayCards.length > 0
                                                    ? displayCards.map((c, ci) => (
                                                        <motion.div
                                                            key={`cards-bottom-${p.id}-${ci}`}
                                                            initial={{ scale: 0.9, opacity: 0 }}
                                                            animate={{ scale: 1, opacity: 1 }}
                                                            transition={{ delay: ci * 0.08 }}
                                                        >
                                                            <CardUI card={c} className={cn(
                                                                isSelf ? "w-10 h-14 md:w-12 md:h-16" : "w-8 h-12",
                                                                "shadow-md"
                                                            )} />
                                                        </motion.div>
                                                    ))
                                                    : !isSelf
                                                        ? [0, 1].map((ci) => (
                                                            <CardUI key={`hidden-bottom-${p.id}-${ci}`} card="" hidden className="w-8 h-12 shadow-md opacity-90" />
                                                        ))
                                                        : null}
                                            </div>

                                            {isSelf && (
                                                <div className="mt-1 bg-surface-high/80 px-3 py-1 rounded-full border border-white/10 backdrop-blur-md">
                                                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Your Stack: </span>
                                                    <span className="text-xs font-bold text-white">${me?.chips.toLocaleString()}</span>
                                                </div>
                                            )}

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

                {/* Action Panel */}
                <AnimatePresence>
                    {isMyTurn && (
                        <motion.div
                            initial={{ y: 100 }}
                            animate={{ y: 0 }}
                            exit={{ y: 100 }}
                            className="bg-surface-high border-t border-white/5 p-4 md:p-6 flex flex-wrap items-center justify-center gap-3 md:gap-4"
                        >
                            <Button variant="outline" onClick={() => handleAction('FOLD')}>Fold</Button>
                            {(!me || (me.currentBet ?? 0) >= (gameState.currentBet || 0)) ? (
                                <Button variant="outline" onClick={() => handleAction('CHECK')}>Check</Button>
                            ) : callExceedsStack ? (
                                <Button variant="outline" onClick={() => handleAction('ALL_IN')}>
                                    All In ${availableChips.toLocaleString()}
                                </Button>
                            ) : (
                                <Button variant="outline" onClick={() => handleAction('CALL')}>
                                    Call ${callAmount.toLocaleString()}
                                </Button>
                            )}
                            
                            {/* Custom Bet / Raise Input */}
                            <div className="flex items-center gap-2 bg-black/40 p-1 rounded-md border border-white/10 ml-4">
                                <span className="text-zinc-400 pl-3 font-bold">$</span>
                                <input 
                                    type="number" 
                                    className="bg-transparent text-white font-bold w-24 outline-none placeholder:text-zinc-600"
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
                                <p className="w-full text-center text-[11px] text-red-400 font-bold uppercase tracking-wider">
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
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-gold-secondary text-surface px-6 py-3 rounded-full font-headline font-bold shadow-2xl"
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
