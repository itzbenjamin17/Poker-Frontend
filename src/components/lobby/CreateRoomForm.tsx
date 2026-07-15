import React, { useState } from 'react';
import { Button, Input, Card } from '../UI';
import { pokerApi } from '../../services/api';
import { Rocket } from 'lucide-react';
import { logger } from '../../security/logger';
import {
    CREATE_TABLE_HEADING,
    CREATE_TABLE_SUBTITLE,
    BTN_ESTABLISH,
    BTN_ESTABLISHING,
    ERROR_CREATE_FALLBACK,
} from '../../constants/strings';
import { VALIDATION, validateCreate } from './validation';
import type { AuthResponse } from '../../types';

interface CreateRoomFormProps {
    onAuth: (data: AuthResponse) => void;
    onError: (msg: string | null) => void;
    loading: boolean;
    setLoading: (loading: boolean) => void;
}

export function CreateRoomForm({ onAuth, onError, loading, setLoading }: CreateRoomFormProps) {
    const [createData, setCreateData] = useState({
        roomName: '',
        playerName: '',
        maxPlayers: 6,
        smallBlind: 25,
        bigBlind: 50,
        buyIn: 1000,
    });

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        onError(null);

        const submissionData = {
            ...createData,
            roomName: createData.roomName.trim(),
            playerName: createData.playerName.trim(),
        };

        const validationError = validateCreate(submissionData);
        if (validationError) {
            onError(validationError);
            return;
        }

        setLoading(true);
        try {
            const res = await pokerApi.createRoom(submissionData);
            onAuth(res);
        } catch (err) {
            logger.error('Failed to create room:', err);
            onError(err instanceof Error ? err.message : ERROR_CREATE_FALLBACK);
        } finally {
            setLoading(false);
        }
    };

    return (
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
                            disabled={loading}
                        >
                            {loading ? BTN_ESTABLISHING : BTN_ESTABLISH}
                        </Button>
                    </div>
                </form>
            </Card>
        </section>
    );
}
