import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card } from '../UI';
import { pokerApi } from '../../services/api';
import { RECENT_SEATS_KEY, forgetSeat, loadRecentSeats } from '../../services/recentSeats';
import { getErrorStatusCode } from '../../lib/payloads';
import { useLobbyRequest, type LobbyRequestLock } from './useLobbyRequest';
import {
    ERROR_MALFORMED_RESPONSE,
    ERROR_REJOIN_FALLBACK,
    ERROR_REJOIN_ROOM_GONE,
    ERROR_REJOIN_SEAT_GONE,
    REJOIN_HEADING,
    REJOIN_STATUS_FINISHED,
    REJOIN_STATUS_IN_GAME,
    REJOIN_STATUS_WAITING,
    REJOIN_SUBTITLE,
    formatRejoinLabel,
    formatViewResultLabel,
} from '../../constants/strings';
import type { AuthResponse } from '../../types';

interface HeldSeat {
    seat: AuthResponse;
    roomName: string;
    gameStarted: boolean;
    gameFinished: boolean;
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
        return {
            seat,
            roomName: room.roomName,
            gameStarted: Boolean(room.gameStarted),
            gameFinished: Boolean(room.gameFinished),
        };
    } catch (error) {
        if (!signal.aborted && isSeatGone(getErrorStatusCode(error))) forgetSeat(seat.token);
        return null;
    }
}

export interface RejoinSeatsProps {
    onAuth: (data: AuthResponse) => void;
    onError?: (message: string | null) => void;
    disabled?: boolean;
    setLoading?: (loading: boolean) => void;
    requestLock?: LobbyRequestLock;
}

/**
 * Offers to open active seats this browser recently logged in to (whether from closed tabs or another open tab).
 * Only seats the server confirms it still holds are shown; a seat is adopted only when the player clicks it.
 */
export function RejoinSeats({ onAuth, onError, disabled, setLoading, requestLock }: RejoinSeatsProps) {
    const [held, setHeld] = useState<HeldSeat[]>([]);
    const heldTokensRef = useRef(new Set<string>());
    const { pending, run } = useLobbyRequest({
        requestLock,
        onAuth,
        onError: message => onError?.(message),
        setLoading: loading => setLoading?.(loading),
    });

    useEffect(() => {
        heldTokensRef.current = new Set(held.map(entry => entry.seat.token));
    }, [held]);

    useEffect(() => {
        let activeController = new AbortController();
        const syncSeats = (seats: AuthResponse[]) => {
            activeController.abort();
            const controller = new AbortController();
            activeController = controller;
            if (seats.length === 0) {
                setHeld([]);
                return;
            }
            void Promise.all(seats.map(seat => checkSeat(seat, controller.signal))).then(results => {
                if (!controller.signal.aborted) setHeld(results.filter((r): r is HeldSeat => r !== null));
            });
        };

        const initialSeats = loadRecentSeats();
        if (initialSeats.length > 0) syncSeats(initialSeats);

        const handleStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== RECENT_SEATS_KEY) return;
            const seats = loadRecentSeats();
            const liveTokens = new Set(seats.map(seat => seat.token));
            setHeld(prev => prev.filter(entry => liveTokens.has(entry.seat.token)));
            if (seats.some(seat => !heldTokensRef.current.has(seat.token))) {
                syncSeats(seats);
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => {
            activeController.abort();
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const handleRejoin = (seat: AuthResponse) => {
        if (disabled || pending) return;
        onError?.(null);
        void run(
            async signal => {
                const room = await pokerApi.getRoomData(seat.roomId, seat.token, signal);
                if (typeof room?.roomName !== 'string') {
                    throw new Error(ERROR_MALFORMED_RESPONSE);
                }
                return seat;
            },
            ERROR_REJOIN_FALLBACK,
            error => {
                const status = getErrorStatusCode(error);
                if (!isSeatGone(status)) return undefined;
                forgetSeat(seat.token);
                setHeld(prev => prev.filter(entry => entry.seat.token !== seat.token));
                return status === 404 || status === 410 ? ERROR_REJOIN_ROOM_GONE : ERROR_REJOIN_SEAT_GONE;
            },
        );
    };

    if (held.length === 0) return null;

    const orderedHeld = [...held].sort((a, b) => Number(a.gameFinished) - Number(b.gameFinished));

    return (
        <section aria-label={REJOIN_HEADING} className="w-full max-w-6xl mb-8 [@media(max-height:500px)]:mb-4">
            <Card className="p-5 sm:p-6 md:p-8 [@media(max-height:500px)]:p-4">
                <h2 className="font-headline text-2xl font-bold text-white mb-1">{REJOIN_HEADING}</h2>
                <p className="text-zinc-400 text-sm mb-4 sm:mb-6 [@media(max-height:500px)]:mb-3">{REJOIN_SUBTITLE}</p>
                <ul className="space-y-3">
                    {orderedHeld.map(({ seat, roomName, gameStarted, gameFinished }) => (
                        <li
                            key={seat.token}
                            className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2"
                        >
                            <span className="text-xs uppercase tracking-widest text-zinc-400">
                                {gameFinished ? REJOIN_STATUS_FINISHED : gameStarted ? REJOIN_STATUS_IN_GAME : REJOIN_STATUS_WAITING}
                            </span>
                            <Button
                                variant="secondary"
                                disabled={disabled || pending}
                                onClick={() => handleRejoin(seat)}
                                className="normal-case max-w-full min-w-0 w-full sm:w-auto sm:justify-self-end justify-between"
                            >
                                <span className="min-w-0 [overflow-wrap:anywhere] text-left">
                                    {gameFinished ? formatViewResultLabel(roomName, seat.playerName) : formatRejoinLabel(roomName, seat.playerName)}
                                </span>
                                <ArrowRight aria-hidden="true" className="w-4 h-4 shrink-0" />
                            </Button>
                        </li>
                    ))}
                </ul>
            </Card>
        </section>
    );
}
