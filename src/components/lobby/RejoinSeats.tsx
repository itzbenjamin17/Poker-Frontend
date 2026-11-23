import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card } from '../UI';
import { pokerApi } from '../../services/api';
import { forgetSeat, loadRecentSeats } from '../../services/recentSeats';
import { getErrorStatusCode } from '../../lib/payloads';
import {
    REJOIN_HEADING,
    REJOIN_STATUS_IN_GAME,
    REJOIN_STATUS_WAITING,
    REJOIN_SUBTITLE,
    formatRejoinLabel,
} from '../../constants/strings';
import type { AuthResponse } from '../../types';

interface HeldSeat {
    seat: AuthResponse;
    roomName: string;
    gameStarted: boolean;
}

/** A client error other than a timeout or rate limit means the server no longer holds this seat. */
function isSeatGone(status: number | undefined): boolean {
    return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Asks the server whether it still holds the seat; forgets seats it has let go. */
async function checkSeat(seat: AuthResponse, signal: AbortSignal): Promise<HeldSeat | null> {
    try {
        const room = await pokerApi.getRoomData(seat.roomId, seat.token, signal);
        if (typeof room?.roomName !== 'string') return null;
        return { seat, roomName: room.roomName, gameStarted: Boolean(room.gameStarted) };
    } catch (error) {
        if (!signal.aborted && isSeatGone(getErrorStatusCode(error))) forgetSeat(seat.token);
        return null;
    }
}

export interface RejoinSeatsProps {
    onAuth: (data: AuthResponse) => void;
    disabled?: boolean;
}

/**
 * Offers to open active seats this browser recently logged in to (whether from closed tabs or another open tab).
 * Only seats the server confirms it still holds are shown; a seat is adopted only when the player clicks it.
 */
export function RejoinSeats({ onAuth, disabled }: RejoinSeatsProps) {
    const [held, setHeld] = useState<HeldSeat[]>([]);

    useEffect(() => {
        const seats = loadRecentSeats();
        if (seats.length === 0) return;
        const controller = new AbortController();
        void Promise.all(seats.map(seat => checkSeat(seat, controller.signal))).then(results => {
            if (!controller.signal.aborted) setHeld(results.filter((r): r is HeldSeat => r !== null));
        });
        return () => controller.abort();
    }, []);

    if (held.length === 0) return null;

    return (
        <section aria-label={REJOIN_HEADING} className="w-full max-w-6xl mb-8">
            <Card>
                <h2 className="font-headline text-2xl font-bold text-white mb-1">{REJOIN_HEADING}</h2>
                <p className="text-zinc-400 text-sm mb-6">{REJOIN_SUBTITLE}</p>
                <ul className="space-y-3">
                    {held.map(({ seat, roomName, gameStarted }) => (
                        <li key={seat.token} className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs uppercase tracking-widest text-zinc-400">
                                {gameStarted ? REJOIN_STATUS_IN_GAME : REJOIN_STATUS_WAITING}
                            </span>
                            <Button variant="secondary" disabled={disabled} onClick={() => onAuth(seat)}>
                                {formatRejoinLabel(roomName, seat.playerName)}
                                <ArrowRight aria-hidden="true" className="w-4 h-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            </Card>
        </section>
    );
}
