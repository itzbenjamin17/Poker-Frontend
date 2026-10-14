import React, { useState } from 'react';
import { Button, Input, Card } from '../UI';
import { pokerApi } from '../../services/api';
import { Rocket } from 'lucide-react';
import {
    CREATE_TABLE_HEADING,
    CREATE_TABLE_SUBTITLE,
    BTN_CREATE_GAME,
    BTN_CREATING,
    ERROR_CREATE_FALLBACK,
} from '../../constants/strings';
import { VALIDATION, validateCreate, parseCreateRoomSubmission } from './validation';
import { useLobbyRequest } from './useLobbyRequest';
import type { LobbyRequestLock } from './useLobbyRequest';
import type { AuthResponse } from '../../types';

interface CreateRoomFormProps {
    onAuth: (data: AuthResponse) => void;
    onError: (msg: string | null) => void;
    isSubmitting?: boolean;
    loading?: boolean;
    disabled?: boolean;
    setLoading: (loading: boolean) => void;
    requestLock?: LobbyRequestLock;
}

export function CreateRoomForm({ onAuth, onError, isSubmitting, loading = false, disabled = false, setLoading, requestLock }: CreateRoomFormProps) {
    const [createData, setCreateData] = useState({
        roomName: '',
        playerName: '',
        maxPlayers: 6,
        smallBlind: '25',
        bigBlind: '50',
        buyIn: '1000',
    });

    const submitting = isSubmitting ?? loading;
    const isDisabled = submitting || disabled;
    const { isBusy, run } = useLobbyRequest({ requestLock, onAuth, onError, setLoading });

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isDisabled || isBusy()) return;
        onError(null);

        const validationError = validateCreate(createData);
        if (validationError) {
            onError(validationError);
            return;
        }

        const submissionData = parseCreateRoomSubmission(createData);

        await run(signal => pokerApi.createRoom(submissionData, signal), ERROR_CREATE_FALLBACK);
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

                <form onSubmit={handleCreate} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="col-span-full">
                        <Input
                            label="Room Name"
                            placeholder="Game 01"
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
                        onChange={e => setCreateData({ ...createData, smallBlind: e.target.value })}
                        min={VALIDATION.smallBlind.min}
                        max={VALIDATION.smallBlind.max}
                    />
                    <Input
                        label="Big Blind"
                        type="number"
                        value={createData.bigBlind}
                        onChange={e => setCreateData({ ...createData, bigBlind: e.target.value })}
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
                        onChange={e => setCreateData({ ...createData, buyIn: e.target.value })}
                        min={VALIDATION.buyIn.min}
                        max={VALIDATION.buyIn.max}
                    />

                    <div className="col-span-full mt-4">
                        <Button
                            variant="secondary"
                            size="lg"
                            className="w-full"
                            type="submit"
                            disabled={isDisabled}
                        >
                            {submitting ? BTN_CREATING : BTN_CREATE_GAME}
                        </Button>
                    </div>
                </form>
            </Card>
        </section>
    );
}
