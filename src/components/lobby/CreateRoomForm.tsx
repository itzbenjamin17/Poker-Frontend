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
                    <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                            <label htmlFor="max-players" className="block font-headline text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                Max Players
                            </label>
                            <span className="font-headline text-lg font-bold text-emerald-primary tabular-nums">
                                {createData.maxPlayers}
                                <span className="text-zinc-500 text-xs font-body font-normal ml-1">/ {VALIDATION.maxPlayers.max}</span>
                            </span>
                        </div>
                        <input
                            id="max-players"
                            type="range"
                            min={VALIDATION.maxPlayers.min}
                            max={VALIDATION.maxPlayers.max}
                            step={1}
                            value={createData.maxPlayers}
                            onChange={e => {
                                const v = Number.parseInt(e.target.value, 10);
                                setCreateData({ ...createData, maxPlayers: Number.isNaN(v) ? createData.maxPlayers : v });
                            }}
                            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-highest accent-emerald-primary focus:outline-none focus:ring-1 focus:ring-emerald-primary/30"
                        />
                        <div className="flex justify-between text-[10px] text-zinc-600 font-headline select-none">
                            {Array.from({ length: VALIDATION.maxPlayers.max - VALIDATION.maxPlayers.min + 1 }, (_, i) => (
                                <span key={i + VALIDATION.maxPlayers.min}>{i + VALIDATION.maxPlayers.min}</span>
                            ))}
                        </div>
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
