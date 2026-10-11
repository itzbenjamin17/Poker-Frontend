import React, { useState } from 'react';
import { Button, Input, Card } from '../UI';
import { pokerApi } from '../../services/api';
import { Key, ArrowRight } from 'lucide-react';
import { logger } from '../../security/logger';
import {
    JOIN_TABLE_HEADING,
    JOIN_TABLE_SUBTITLE,
    BTN_JOIN,
    BTN_JOINING,
    ERROR_JOIN_FALLBACK,
} from '../../constants/strings';
import { VALIDATION, validateJoin } from './validation';
import type { AuthResponse } from '../../types';

interface JoinRoomFormProps {
    onAuth: (data: AuthResponse) => void;
    onError: (msg: string | null) => void;
    isSubmitting?: boolean;
    loading?: boolean;
    disabled?: boolean;
    setLoading: (loading: boolean) => void;
}

export function JoinRoomForm({ onAuth, onError, isSubmitting, loading = false, disabled = false, setLoading }: JoinRoomFormProps) {
    const [joinData, setJoinData] = useState({
        roomName: '',
        playerName: '',
    });

    const submitting = isSubmitting ?? loading;
    const isDisabled = submitting || disabled;

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        onError(null);

        const validationError = validateJoin(joinData);
        if (validationError) {
            onError(validationError);
            return;
        }

        const roomName = joinData.roomName.trim();
        const playerName = joinData.playerName.trim();

        setLoading(true);
        try {
            const res = await pokerApi.joinRoom({ roomName, playerName });
            onAuth(res);
        } catch (err) {
            logger.error('Failed to join room:', err);
            onError(err instanceof Error ? err.message : ERROR_JOIN_FALLBACK);
        } finally {
            setLoading(false);
        }
    };

    return (
        <section aria-label="Quick Join">
            <Card className="h-full">
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h2 className="font-headline text-3xl font-bold text-white mb-2">{JOIN_TABLE_HEADING}</h2>
                        <p className="text-zinc-500 text-sm">{JOIN_TABLE_SUBTITLE}</p>
                    </div>
                    <Key aria-hidden="true" className="text-gold-secondary/20 w-10 h-10" />
                </div>

                <form onSubmit={handleJoin} noValidate className="space-y-6">
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
                        disabled={isDisabled}
                    >
                        {submitting ? BTN_JOINING : BTN_JOIN}
                        <ArrowRight aria-hidden="true" className="w-5 h-5 ml-2" />
                    </Button>
                </form>
            </Card>
        </section>
    );
}
