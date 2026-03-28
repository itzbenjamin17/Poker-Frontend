import React, { useState } from 'react';
import { Button, Input, Card } from './components/UI';
import { pokerApi } from './services/api';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, Key, ArrowRight } from 'lucide-react';
import type {AuthResponse} from './types';

export default function Lobby({ onAuth }: { onAuth: (data: AuthResponse) => void }) {
    const [loading, setLoading] = useState(false);
    const [createData, setCreateData] = useState({
        roomName: '',
        playerName: '',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        buyIn: 1000
    });
    const [joinData, setJoinData] = useState({
        roomName: '',
        playerName: ''
    });

    const [error, setError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await pokerApi.createRoom(createData);
            onAuth(res);
        } catch (err) {
            console.error('Failed to create room:', err);
            setError(err instanceof Error ? err.message : 'Failed to establish table. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await pokerApi.joinRoom(joinData);
            onAuth(res);
        } catch (err) {
            console.error('Failed to join room:', err);
            setError(err instanceof Error ? err.message : 'Failed to enter vault. Room may not exist or password incorrect.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen pt-24 pb-32 px-6 flex flex-col items-center justify-center">
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-4 rounded-xl font-headline font-bold shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-4"
                    >
                        <span>{error}</span>
                        <button 
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
          The High-Stakes Experience
        </span>
                <h1 className="font-headline text-5xl md:text-7xl font-bold tracking-tighter leading-none text-white max-w-3xl">
                    UNCOMPROMISED <br />
                    <span className="text-emerald-primary/60">ROYAL ACTION.</span>
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
                    <Card>
                        <div className="flex justify-between items-start mb-8">
                            <div>
                                <h2 className="font-headline text-3xl font-bold text-white mb-2">Create Table</h2>
                                <p className="text-zinc-500 text-sm">Define the stakes and command the room.</p>
                            </div>
                            <Rocket className="text-emerald-primary/20 w-10 h-10" />
                        </div>

                        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="col-span-full">
                                <Input
                                    label="Room Name"
                                    placeholder="Emerald Vault 01"
                                    value={createData.roomName}
                                    onChange={e => setCreateData({...createData, roomName: e.target.value})}
                                    required
                                />
                            </div>
                            <Input
                                label="Player Alias"
                                placeholder="Viking_01"
                                value={createData.playerName}
                                onChange={e => setCreateData({...createData, playerName: e.target.value})}
                                required
                            />
                            <div className="space-y-2">
                                <label className="block font-headline text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Max Players</label>
                                <select
                                    className="w-full bg-surface-highest border-none rounded-lg p-4 text-white focus:ring-1 focus:ring-emerald-primary/30 transition-all font-body appearance-none outline-none"
                                    value={createData.maxPlayers}
                                    onChange={e => setCreateData({...createData, maxPlayers: parseInt(e.target.value)})}
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
                                onChange={e => setCreateData({...createData, buyIn: parseInt(e.target.value)})}
                            />
                            <Input
                                label="Small Blind"
                                type="number"
                                value={createData.smallBlind}
                                onChange={e => setCreateData({...createData, smallBlind: parseInt(e.target.value)})}
                            />

                            <div className="col-span-full mt-4">
                                <Button variant="secondary" size="lg" className="w-full" type="submit" disabled={loading}>
                                    {loading ? 'ESTABLISHING...' : 'ESTABLISH TABLE'}
                                </Button>
                            </div>
                        </form>
                    </Card>
                </motion.div>

                {/* Join Table */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="lg:col-span-5"
                >
                    <Card className="h-full">
                        <div className="flex justify-between items-start mb-8">
                            <div>
                                <h2 className="font-headline text-3xl font-bold text-white mb-2">Quick Join</h2>
                                <p className="text-zinc-500 text-sm">Enter an existing arena.</p>
                            </div>
                            <Key className="text-gold-secondary/20 w-10 h-10" />
                        </div>

                        <form onSubmit={handleJoin} className="space-y-6">
                            <Input
                                label="Room Name"
                                placeholder="Enter Room Name"
                                value={joinData.roomName}
                                onChange={e => setJoinData({...joinData, roomName: e.target.value})}
                                required
                            />
                            <Input
                                label="Player Alias"
                                placeholder="Enter Alias"
                                value={joinData.playerName}
                                onChange={e => setJoinData({...joinData, playerName: e.target.value})}
                                required
                            />
                            <Button size="xl" className="w-full" type="submit" disabled={loading}>
                                {loading ? 'ENTERING...' : 'ENTER VAULT'}
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </form>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
