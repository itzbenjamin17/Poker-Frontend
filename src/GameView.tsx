import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client } from '@stomp/stompjs';
import { createStompClient, pokerApi } from './services/api';
import {type GameState, type RoomUpdate, type ShowdownUpdate, cn, type AuthResponse } from './types';
import { Button, Card } from './components/UI';
import { PlayerPod, CardUI } from './components/GameUI';
import { Info, Play, Coins } from 'lucide-react';

type GameViewProps = {
    auth: AuthResponse;
    onLeave: () => void;
};

export default function GameView({ auth, onLeave }: GameViewProps) {
    const [roomState, setRoomState] = useState<RoomUpdate['data'] | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [privateState, setPrivateState] = useState<{ holeCards: string[] } | null>(null);
    const [showdown, setShowdown] = useState<ShowdownUpdate | null>(null);
    const [notification, setNotification] = useState<string | null>(null);

    const stompClientRef = useRef<Client | null>(null);

    useEffect(() => {
        const client = createStompClient(auth.token);
        stompClientRef.current = client;

        client.onConnect = () => {
            console.log('Connected to WebSocket');

            // Subscribe to Room Updates
            client.subscribe(`/topic/rooms/${auth.roomId}`, (msg) => {
                const update = JSON.parse(msg.body);
                if (update.message === 'ROOM_CREATED' || update.message === 'PLAYER_JOINED' || update.message === 'PLAYER_LEFT') {
                    setRoomState(update.data);
                }
            });

            // Subscribe to Game State
            client.subscribe(`/topic/game/${auth.roomId}`, (msg) => {
                const data = JSON.parse(msg.body);
                if (data.type === 'SHOWDOWN') {
                    setShowdown(data);
                    setTimeout(() => setShowdown(null), 8000);
                } else if (data.type === 'PLAYER_NOTIFICATION') {
                    setNotification(data.message);
                    setTimeout(() => setNotification(null), 4000);
                } else if (data.type === 'GAME_END') {
                    setNotification(data.message);
                } else {
                    setGameState(data);
                    setRoomState(null); // Game started, hide lobby
                }
            });

            // Subscribe to Private State
            client.subscribe(`/topic/game/${auth.roomId}/player/${auth.playerId}/private`, (msg) => {
                setPrivateState(JSON.parse(msg.body));
            });
        };

        client.activate();

        return () => {
            client.deactivate();
            onLeave();
        };
    }, [auth, onLeave]);

    const handleAction = async (action: string, amount: number = 0) => {
        try {
            await pokerApi.performAction(auth.roomId, action, amount, auth.token);
        } catch (err) {
            console.error(err);
        }
    };

    const handleStartGame = async () => {
        try {
            await pokerApi.startGame(auth.roomId, auth.token);
        } catch (err) {
            console.error('Failed to start game:', err);
            setNotification('Only the host can initiate the royal action.');
            setTimeout(() => setNotification(null), 4000);
        }
    };

    // Lobby View
    if (roomState && !gameState) {
        return (
            <div className="min-h-screen p-8 flex flex-col items-center justify-center">
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
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Game Table View
    if (gameState) {
        const isMyTurn = gameState.currentPlayerId === auth.playerId;
        const me = gameState.players.find(p => p.playerId === auth.playerId);

        return (
            <div className="min-h-screen flex flex-col overflow-hidden">
                {/* Table Area */}
                <div className="flex-1 relative flex items-center justify-center p-8">
                    <div className="w-full max-w-5xl aspect-[2/1] poker-table-gradient rounded-[200px] border-[12px] border-surface-high shadow-[0_0_100px_rgba(0,0,0,0.8)] relative">

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
                        {gameState.players.map((p, i) => {
                            // Position players around the table
                            const angle = (i / gameState.players.length) * 2 * Math.PI;
                            const x = 50 + 42 * Math.cos(angle);
                            const y = 50 + 42 * Math.sin(angle);

                            return (
                                <div
                                    key={p.playerId}
                                    className="absolute -translate-x-1/2 -translate-y-1/2"
                                    style={{ left: `${x}%`, top: `${y}%` }}
                                >
                                    <PlayerPod
                                        player={p}
                                        isCurrent={gameState.currentPlayerId === p.playerId}
                                    />
                                    {showdown && showdown.players.find(sp => sp.playerId === p.playerId)?.holeCards && (
                                        <div className="flex gap-1 mt-2 justify-center">
                                            {showdown.players.find(sp => sp.playerId === p.playerId)?.holeCards?.map((c, ci) => (
                                                <CardUI key={ci} card={c} className="w-8 h-12" />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* My Hole Cards (Floating) */}
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4">
                        <div className="flex gap-2">
                            {privateState?.holeCards.map((card, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ y: 50, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: i * 0.1 }}
                                >
                                    <CardUI card={card} className="w-16 h-24" />
                                </motion.div>
                            ))}
                        </div>
                        <div className="bg-surface-high/80 px-4 py-1 rounded-full border border-white/10 backdrop-blur-md">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Your Stack: </span>
                            <span className="text-sm font-bold text-white">${me?.chips.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                {/* Action Panel */}
                <AnimatePresence>
                    {isMyTurn && (
                        <motion.div
                            initial={{ y: 100 }}
                            animate={{ y: 0 }}
                            exit={{ y: 100 }}
                            className="bg-surface-high border-t border-white/5 p-6 flex items-center justify-center gap-4"
                        >
                            <Button variant="outline" onClick={() => handleAction('FOLD')}>Fold</Button>
                            <Button variant="outline" onClick={() => handleAction('CHECK')}>Check</Button>
                            <Button variant="secondary" onClick={() => handleAction('BET', 100)}>Bet $100</Button>
                            <Button variant="primary" onClick={() => handleAction('RAISE', gameState.currentHighestBet * 2)}>
                                Raise to ${gameState.currentHighestBet * 2}
                            </Button>
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
                <p className="font-headline text-xs tracking-widest uppercase text-emerald-primary">Connecting to Vault...</p>
            </div>
        </div>
    );
}
