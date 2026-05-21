import React, { useState } from 'react';
import { Button, Input, Card } from './components/UI';
import { pokerApi } from './services/api';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, Key, ArrowRight } from 'lucide-react';
import type { AuthResponse } from './types';
import { logger } from './security/logger';
import {
    LOBBY_HERO_SUBTITLE,
    LOBBY_HERO_TITLE_1,
    LOBBY_HERO_TITLE_2,
    CREATE_TABLE_HEADING,
    CREATE_TABLE_SUBTITLE,
    JOIN_TABLE_HEADING,
    JOIN_TABLE_SUBTITLE,
    BTN_ESTABLISH,
    BTN_ESTABLISHING,
    BTN_JOIN,
    BTN_JOINING,
    ERROR_CREATE_FALLBACK,
    ERROR_JOIN_FALLBACK,
} from './constants/strings';

// Backend validation constraints mirrored from CreateRoomRequest.java
const VALIDATION = {
    roomName: { min: 1, max: 50 },
    playerName: { min: 1, max: 30 },
    maxPlayers: { min: 2, max: 10 },
    smallBlind: { min: 1, max: 10_000 },
    bigBlind: { min: 2, max: 20_000 },
    buyIn: { min: 20, max: 1_000_000 },
};

function validateCreate(data: {
    roomName: string;
    playerName: string;
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    buyIn: number;
}): string | null {
    if (!data.roomName.trim()) return 'Room name is required.';
    if (data.roomName.trim().length > VALIDATION.roomName.max) return `Room name must be at most ${VALIDATION.roomName.max} characters.`;
    if (!data.playerName.trim()) return 'Player alias is required.';
    if (data.playerName.trim().length > VALIDATION.playerName.max) return `Alias must be at most ${VALIDATION.playerName.max} characters.`;
    if (Number.isNaN(data.smallBlind) || data.smallBlind < VALIDATION.smallBlind.min || data.smallBlind > VALIDATION.smallBlind.max)
        return `Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`;
    if (Number.isNaN(data.bigBlind) || data.bigBlind < VALIDATION.bigBlind.min || data.bigBlind > VALIDATION.bigBlind.max)
        return `Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`;
    if (data.bigBlind < data.smallBlind * 2) return 'Big blind must be at least 2× the small blind.';
    if (Number.isNaN(data.buyIn) || data.buyIn < VALIDATION.buyIn.min || data.buyIn > VALIDATION.buyIn.max)
        return `Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`;
    if (data.buyIn < data.bigBlind) return 'Buy-in must be at least the big blind amount.';
    return null;
}

export default function Lobby({ onAuth }: { onAuth: (data: AuthResponse) => void }) {
    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);

    const [createData, setCreateData] = useState({
        roomName: '',
        playerName: '',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000,
    });
    const [joinData, setJoinData] = useState({
        roomName: '',
        playerName: '',
    });

    const [error, setError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const submissionData = {
            ...createData,
            roomName: createData.roomName.trim(),
            playerName: createData.playerName.trim(),
        };

        const validationError = validateCreate(submissionData);
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsCreating(true);
        try {
            const res = await pokerApi.createRoom(submissionData);
            onAuth(res);
        } catch (err) {
            logger.error('Failed to create room:', err);
            setError(err instanceof Error ? err.message : ERROR_CREATE_FALLBACK);
        } finally {
            setIsCreating(false);
        }
    };

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const roomName = joinData.roomName.trim();
        const playerName = joinData.playerName.trim();

        if (!roomName) { setError('Room name is required.'); return; }
        if (roomName.length > VALIDATION.roomName.max) { setError(`Room name must be at most ${VALIDATION.roomName.max} characters.`); return; }
        if (!playerName) { setError('Player alias is required.'); return; }
        if (playerName.length > VALIDATION.playerName.max) { setError(`Alias must be at most ${VALIDATION.playerName.max} characters.`); return; }

        setIsJoining(true);
        try {
            const res = await pokerApi.joinRoom({ roomName, playerName });
            onAuth(res);
        } catch (err) {
            logger.error('Failed to join room:', err);
            setError(err instanceof Error ? err.message : ERROR_JOIN_FALLBACK);
        } finally {
            setIsJoining(false);
        }
    };

    const loading = isCreating || isJoining;

    return (
        <div className="min-h-screen pt-24 pb-32 px-6 flex flex-col items-center justify-center">
            <AnimatePresence>
                {error && (
                    <motion.div
                        role="alert"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-4 rounded-xl font-headline font-bold shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-4"
                    >
                        <span>{error}</span>
                        <button
                            aria-label="Close error notification"
                            onClick={() => setError(null)}
                            className="bg-black/20 hover:bg-black/40 rounded-full w-6 h-6 flex items-center justify-center transition-colors"
                        >
                            &times;
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-6xl mb-16"
            >
                <span className="block text-gold-secondary font-headline text-[10px] tracking-[0.2em] uppercase font-bold mb-4">
                    {LOBBY_HERO_SUBTITLE}
                </span>
                <h1 className="font-headline text-5xl md:text-7xl font-bold tracking-tighter leading-none text-white max-w-3xl">
                    {LOBBY_HERO_TITLE_1} <br />
                    <span className="text-emerald-primary/60">{LOBBY_HERO_TITLE_2}</span>
                </h1>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full max-w-6xl">
                {/* Create Table */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="lg:col-span-7"
                >
                    <section aria-label="Create Table">
                        <Card>
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h2 className="font-headline text-3xl font-bold text-white mb-2">{CREATE_TABLE_HEADING}</h2>
                                    <p className="text-zinc-500 text-sm">{CREATE_TABLE_SUBTITLE}</p>
                                </div>
                                <Rocket aria-hidden="true" className="text-emerald-primary/20 w-10 h-10" />
                            </div>

                            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="col-span-full">
                                    <Input
                                        label="Room Name"
                                        placeholder="Emerald Vault 01"
                                        value={createData.roomName}
                                        onChange={e => setCreateData({ ...createData, roomName: e.target.value })}
                                        required
                                        maxLength={VALIDATION.roomName.max}
                                    />
                                </div>
                                <div className="col-span-full">
                                    <Input
                                        label="Player Alias"
                                        placeholder="Viking_01"
                                        value={createData.playerName}
                                        onChange={e => setCreateData({ ...createData, playerName: e.target.value })}
                                        required
                                        maxLength={VALIDATION.playerName.max}
                                    />
                                </div>
                                <Input
                                    label="Small Blind"
                                    type="number"
                                    value={createData.smallBlind}
                                    onChange={e => {
                                        const v = Number.parseInt(e.target.value, 10);
                                        setCreateData({ ...createData, smallBlind: Number.isNaN(v) ? createData.smallBlind : v });
                                    }}
                                    min={VALIDATION.smallBlind.min}
                                    max={VALIDATION.smallBlind.max}
                                />
                                <Input
                                    label="Big Blind"
                                    type="number"
                                    value={createData.bigBlind}
                                    onChange={e => {
                                        const v = Number.parseInt(e.target.value, 10);
                                        setCreateData({ ...createData, bigBlind: Number.isNaN(v) ? createData.bigBlind : v });
                                    }}
                                    min={VALIDATION.bigBlind.min}
                                    max={VALIDATION.bigBlind.max}
                                />
                                <div className="space-y-2">
                                    <label htmlFor="max-players" className="block font-headline text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                        Max Players
                                    </label>
                                    <select
                                        id="max-players"
                                        className="w-full bg-surface-highest border-none rounded-lg p-4 text-white focus:ring-1 focus:ring-emerald-primary/30 transition-all font-body appearance-none outline-none"
                                        value={createData.maxPlayers}
                                        onChange={e => {
                                            const v = Number.parseInt(e.target.value, 10);
                                            setCreateData({ ...createData, maxPlayers: Number.isNaN(v) ? createData.maxPlayers : v });
                                        }}
                                    >
                                        <option value={2}>2 Players</option>
                                        <option value={6}>6 Players</option>
                                        <option value={9}>9 Players</option>
                                    </select>
                                </div>
                                <Input
                                    label="Buy-in Amount"
                                    type="number"
                                    value={createData.buyIn}
                                    onChange={e => {
                                        const v = Number.parseInt(e.target.value, 10);
                                        setCreateData({ ...createData, buyIn: Number.isNaN(v) ? createData.buyIn : v });
                                    }}
                                    min={VALIDATION.buyIn.min}
                                    max={VALIDATION.buyIn.max}
                                />

                                <div className="col-span-full mt-4">
                                    <Button
                                        variant="secondary"
                                        size="lg"
                                        className="w-full"
                                        type="submit"
                                        disabled={isCreating || loading}
                                    >
                                        {isCreating ? BTN_ESTABLISHING : BTN_ESTABLISH}
                                    </Button>
                                </div>
                            </form>
                        </Card>
                    </section>
                </motion.div>

                {/* Join Table */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="lg:col-span-5"
                >
                    <section aria-label="Quick Join">
                        <Card className="h-full">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h2 className="font-headline text-3xl font-bold text-white mb-2">{JOIN_TABLE_HEADING}</h2>
                                    <p className="text-zinc-500 text-sm">{JOIN_TABLE_SUBTITLE}</p>
                                </div>
                                <Key aria-hidden="true" className="text-gold-secondary/20 w-10 h-10" />
                            </div>

                            <form onSubmit={handleJoin} className="space-y-6">
                                <Input
                                    label="Room Name"
                                    placeholder="Enter Room Name"
                                    value={joinData.roomName}
                                    onChange={e => setJoinData({ ...joinData, roomName: e.target.value })}
                                    required
                                    maxLength={VALIDATION.roomName.max}
                                />
                                <Input
                                    label="Player Alias"
                                    placeholder="Enter Alias"
                                    value={joinData.playerName}
                                    onChange={e => setJoinData({ ...joinData, playerName: e.target.value })}
                                    required
                                    maxLength={VALIDATION.playerName.max}
                                />
                                <Button
                                    size="xl"
                                    className="w-full"
                                    type="submit"
                                    disabled={isJoining || loading}
                                >
                                    {isJoining ? BTN_JOINING : BTN_JOIN}
                                    <ArrowRight aria-hidden="true" className="w-5 h-5 ml-2" />
                                </Button>
                            </form>
                        </Card>
                    </section>
                </motion.div>
            </div>
        </div>
    );
}