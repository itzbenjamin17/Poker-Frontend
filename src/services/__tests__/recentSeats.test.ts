import { beforeEach, describe, expect, it } from 'vitest';
import { createMockJwt } from '../../test/fixtures';
import { forgetSeat, loadRecentSeats, MAX_RECENT_SEATS, RECENT_SEATS_KEY, rememberSeat } from '../recentSeats';

const inAnHour = Math.floor(Date.now() / 1000) + 3600;
/** A seat with its own token (tokens differ by expiry second). */
const seat = (roomId: string, playerName: string, offset = 0) => ({ token: createMockJwt(inAnHour + offset), roomId, playerName });

describe('recentSeats', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('remembers seats newest first, storing only the room, name and token', () => {
        const ann = seat('room-1', 'Ann', 1);
        const ben = seat('room-1', 'Ben', 2);
        rememberSeat(ann);
        rememberSeat({ ...ben, extra: 'dropped' } as typeof ben);

        expect(loadRecentSeats()).toEqual([ben, ann]);
    });

    it('replaces an older login for the same room and name instead of listing it twice', () => {
        rememberSeat(seat('room-1', 'Ann', 1));
        const again = seat('room-1', 'Ann', 2);
        rememberSeat(again);

        expect(loadRecentSeats()).toEqual([again]);
    });

    it(`keeps at most ${MAX_RECENT_SEATS} seats, dropping the oldest`, () => {
        const seats = Array.from({ length: MAX_RECENT_SEATS + 1 }, (_, i) => seat(`room-${i}`, 'Ann', i));
        seats.forEach(rememberSeat);

        expect(loadRecentSeats()).toEqual(seats.slice(1).reverse());
    });

    it('forgets a seat by its token and leaves the others', () => {
        const ann = seat('room-1', 'Ann', 1);
        const ben = seat('room-1', 'Ben', 2);
        rememberSeat(ann);
        rememberSeat(ben);

        forgetSeat(ann.token);

        expect(loadRecentSeats()).toEqual([ben]);
    });

    it('drops seats whose token has expired', () => {
        const live = seat('room-1', 'Ann', 1);
        rememberSeat({ token: createMockJwt(Math.floor(Date.now() / 1000) - 60), roomId: 'room-2', playerName: 'Ben' });
        rememberSeat(live);

        expect(loadRecentSeats()).toEqual([live]);
        expect(JSON.parse(localStorage.getItem(RECENT_SEATS_KEY)!).seats).toEqual([live]);
    });

    it.each([
        ['malformed JSON', '{not json'],
        ['an unknown version', JSON.stringify({ version: 99, seats: [] })],
        ['a bare array', JSON.stringify([])],
    ])('treats %s as an empty list', (_label, raw) => {
        localStorage.setItem(RECENT_SEATS_KEY, raw);

        expect(loadRecentSeats()).toEqual([]);
    });

    it('skips individual entries that are not seats', () => {
        const ann = seat('room-1', 'Ann', 1);
        localStorage.setItem(RECENT_SEATS_KEY, JSON.stringify({ version: 1, seats: [{ roomId: 'room-2' }, ann] }));

        expect(loadRecentSeats()).toEqual([ann]);
    });

    it('removes the key once the last seat is forgotten', () => {
        const ann = seat('room-1', 'Ann', 1);
        rememberSeat(ann);
        forgetSeat(ann.token);

        expect(localStorage.getItem(RECENT_SEATS_KEY)).toBeNull();
    });
});
