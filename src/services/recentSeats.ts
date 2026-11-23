import { isJwtValid } from './api';
import { isAuthResponse } from '../lib/payloads';
import { logger } from '../security/logger';
import type { AuthResponse } from '../types';

/**
 * Browser-wide list of the seats this browser recently logged in to, newest first.
 *
 * Active credentials stay tab-local (ADR-0003); this opt-in localStorage list (ADR-0008) never logs a tab in
 * by itself. It only lets a new tab offer "Rejoin" buttons so closing every tab does not strand a live seat.
 */
export const RECENT_SEATS_KEY = 'poker-recent-seats';
export const MAX_RECENT_SEATS = 5;
const RECENT_SEATS_VERSION = 1;

function readSeats(): AuthResponse[] {
    let raw: string | null;
    try {
        raw = localStorage.getItem(RECENT_SEATS_KEY);
    } catch (e) {
        logger.warn('Failed to read recent seats from localStorage:', e);
        return [];
    }
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            !parsed || typeof parsed !== 'object' ||
            !('version' in parsed) || parsed.version !== RECENT_SEATS_VERSION ||
            !('seats' in parsed) || !Array.isArray(parsed.seats)
        ) return [];
        return parsed.seats.filter(isAuthResponse).map(toSeat);
    } catch {
        return [];
    }
}

function writeSeats(seats: AuthResponse[]): void {
    try {
        if (seats.length === 0) {
            localStorage.removeItem(RECENT_SEATS_KEY);
        } else {
            localStorage.setItem(RECENT_SEATS_KEY, JSON.stringify({ version: RECENT_SEATS_VERSION, seats }));
        }
    } catch (e) {
        logger.warn('Failed to write recent seats to localStorage:', e);
    }
}

function toSeat({ token, roomId, playerName }: AuthResponse): AuthResponse {
    return { token, roomId, playerName };
}

/** The remembered seats whose token has not expired, newest first. Expired and malformed entries are dropped. */
export function loadRecentSeats(): AuthResponse[] {
    const seats = readSeats();
    const live = seats.filter(seat => isJwtValid(seat.token));
    if (live.length !== seats.length) writeSeats(live);
    return live;
}

/** Records a seat a tab just logged in to, replacing any older login for the same room and name. */
export function rememberSeat(auth: AuthResponse): void {
    const others = readSeats().filter(seat =>
        seat.token !== auth.token && !(seat.roomId === auth.roomId && seat.playerName === auth.playerName));
    writeSeats([toSeat(auth), ...others].slice(0, MAX_RECENT_SEATS));
}

/** Drops a seat that was left or is no longer held. */
export function forgetSeat(token: string): void {
    const seats = readSeats();
    const rest = seats.filter(seat => seat.token !== token);
    if (rest.length !== seats.length) writeSeats(rest);
}
