// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { validateCreate, validateJoin, validatePassword, normalizePassword, parseCreateRoomSubmission, parseJoinRoomSubmission, VALIDATION } from '../validation';
import {
    VALIDATION_PASSWORD_CONTROL,
    VALIDATION_PASSWORD_MAX,
    formatPasswordMaxError,
} from '../../../constants/strings';

describe('password UTF-8 limits', () => {
    test('rejects a 75-byte password before create or join submission', () => {
        const data = { roomName: 'Room', playerName: 'Player', password: '漢'.repeat(25) };
        expect(validateJoin(data)).toBe('Password must be at most 72 UTF-8 bytes.');
        expect(validateCreate({ ...data, maxPlayers: 6, smallBlind: 5, bigBlind: 10, buyIn: 100 }))
            .toBe('Password must be at most 72 UTF-8 bytes.');
    });

    test('accepts the 72-byte boundary and preserves its surrounding spaces', () => {
        const password = ` ${'漢'.repeat(23)}ab`;
        expect(validatePassword(password)).toBeNull();
        expect(parseJoinRoomSubmission({ roomName: 'Room', playerName: 'Player', password }).password)
            .toBe(password);
        expect(validatePassword(`${password} `)).toBe('Password must be at most 72 UTF-8 bytes.');
        expect(validatePassword('a'.repeat(50))).toBeNull();
    });
});

describe('validateCreate', () => {
    const validConfig = {
        roomName: 'High Rollers Club',
        playerName: 'Maverick',
        maxPlayers: 6,
        smallBlind: 25,
        bigBlind: 50,
        buyIn: 1000,
    };

    test('returns null for a valid configuration (both numeric and string inputs)', () => {
        expect(validateCreate(validConfig)).toBeNull();
        expect(validateCreate({
            ...validConfig,
            smallBlind: '25',
            bigBlind: '50',
            buyIn: '1000',
        })).toBeNull();
    });

    test('rejects empty or non-numeric string inputs for blinds and buy-in', () => {
        expect(validateCreate({ ...validConfig, smallBlind: '' }))
            .toBe(`Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, bigBlind: '' }))
            .toBe(`Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, buyIn: '' }))
            .toBe(`Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`);
    });

    test('rejects empty or whitespace-only room name', () => {
        expect(validateCreate({ ...validConfig, roomName: '' })).toBe('Room name is required.');
        expect(validateCreate({ ...validConfig, roomName: '   ' })).toBe('Room name is required.');
    });

    test('rejects room name exceeding maximum character length', () => {
        const longRoomName = 'A'.repeat(VALIDATION.roomName.max + 1);
        expect(validateCreate({ ...validConfig, roomName: longRoomName }))
            .toBe(`Room name must be at most ${VALIDATION.roomName.max} characters.`);
    });

    test('rejects empty or whitespace-only player alias', () => {
        expect(validateCreate({ ...validConfig, playerName: '' })).toBe('Player alias is required.');
        expect(validateCreate({ ...validConfig, playerName: '   ' })).toBe('Player alias is required.');
    });

    test('rejects player alias exceeding maximum character length', () => {
        const longPlayerName = 'P'.repeat(VALIDATION.playerName.max + 1);
        expect(validateCreate({ ...validConfig, playerName: longPlayerName }))
            .toBe(`Alias must be at most ${VALIDATION.playerName.max} characters.`);
    });

    test('rejects big blind less than 2x small blind (including big blind <= small blind)', () => {
        // big blind <= small blind
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 50 }))
            .toBe('Big blind must be at least 2× the small blind.');
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 25 }))
            .toBe('Big blind must be at least 2× the small blind.');
        // big blind > small blind but < 2x small blind
        expect(validateCreate({ ...validConfig, smallBlind: 50, bigBlind: 90 }))
            .toBe('Big blind must be at least 2× the small blind.');
    });

    test('rejects buy-in less than big blind', () => {
        expect(validateCreate({ ...validConfig, bigBlind: 100, buyIn: 50 }))
            .toBe('Buy-in must be at least the big blind amount.');
    });

    test('rejects small blind below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, smallBlind: 0 }))
            .toBe(`Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, smallBlind: 15_000 }))
            .toBe(`Small blind must be between ${VALIDATION.smallBlind.min} and ${VALIDATION.smallBlind.max.toLocaleString()}.`);
    });

    test('rejects big blind below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, bigBlind: 1 }))
            .toBe(`Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, bigBlind: 25_000 }))
            .toBe(`Big blind must be between ${VALIDATION.bigBlind.min} and ${VALIDATION.bigBlind.max.toLocaleString()}.`);
    });

    test('rejects buy-in below minimum or above maximum', () => {
        expect(validateCreate({ ...validConfig, buyIn: 10 }))
            .toBe(`Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`);
        expect(validateCreate({ ...validConfig, buyIn: 2_000_000 }))
            .toBe(`Buy-in must be between $${VALIDATION.buyIn.min} and $${VALIDATION.buyIn.max.toLocaleString()}.`);
    });

    test.each([1, 11, 2.5, 'invalid'])('rejects invalid maxPlayers value %j', (maxPlayers) => {
        expect(validateCreate({ ...validConfig, maxPlayers }))
            .toBe('Max players must be a whole number between 2 and 10.');
    });

    test('validates optional password in validateCreate', () => {
        expect(validateCreate({ ...validConfig, password: 'securePassword123' })).toBeNull();
        expect(validateCreate({ ...validConfig, password: 'a'.repeat(51) }))
            .toBe(formatPasswordMaxError(VALIDATION.password.max));
        expect(validateCreate({ ...validConfig, password: 'bad\u0000pass' }))
            .toBe(VALIDATION_PASSWORD_CONTROL);
    });
});

describe('validateJoin', () => {
    test('returns null for valid roomName and playerName', () => {
        expect(validateJoin({ roomName: 'PokerRoom', playerName: 'Alice' })).toBeNull();
    });

    test('rejects empty or overly long roomName or playerName', () => {
        expect(validateJoin({ roomName: '   ', playerName: 'Alice' })).toBe('Room name is required.');
        expect(validateJoin({ roomName: 'A'.repeat(VALIDATION.roomName.max + 1), playerName: 'Alice' }))
            .toBe(`Room name must be at most ${VALIDATION.roomName.max} characters.`);
        expect(validateJoin({ roomName: 'PokerRoom', playerName: '   ' })).toBe('Player alias is required.');
        expect(validateJoin({ roomName: 'PokerRoom', playerName: 'P'.repeat(VALIDATION.playerName.max + 1) }))
            .toBe(`Alias must be at most ${VALIDATION.playerName.max} characters.`);
    });

    test.each(['\u0000', '\u007f'])('rejects control character %j in room names and aliases', (control) => {
        expect(validateJoin({ roomName: `Poker${control}Room`, playerName: 'Alice' }))
            .toBe('Room name cannot contain control characters.');
        expect(validateJoin({ roomName: 'PokerRoom', playerName: `Alice${control}` }))
            .toBe('Player alias cannot contain control characters.');
    });

    test.each([
        ['\u200B', 'zero-width space'],
        ['\u200C', 'zero-width non-joiner'],
        ['\u200D', 'zero-width joiner'],
        ['\u200E', 'left-to-right mark'],
        ['\u200F', 'right-to-left mark'],
        ['\u202A', 'left-to-right embedding'],
        ['\u202E', 'right-to-left override'],
        ['\u2066', 'left-to-right isolate'],
        ['\uFEFF', 'byte order mark'],
    ])('rejects Unicode Cf format character %s (%s) in room name and player alias', (char) => {
        expect(validateJoin({ roomName: `Room${char}1`, playerName: 'Alice' }))
            .toBe('Room name cannot contain format characters.');
        expect(validateJoin({ roomName: 'Room1', playerName: `Alice${char}` }))
            .toBe('Player alias cannot contain format characters.');
    });

    test('rejects raw room name and player alias with Cf characters before trimming', () => {
        expect(validateJoin({ roomName: '  \u200B  ', playerName: 'Alice' }))
            .toBe('Room name cannot contain format characters.');
        expect(validateJoin({ roomName: 'Room1', playerName: '  \uFEFF  ' }))
            .toBe('Player alias cannot contain format characters.');
        expect(validateJoin({ roomName: '\u200B   Room', playerName: 'Alice' }))
            .toBe('Room name cannot contain format characters.');
        expect(validateJoin({ roomName: 'Room1', playerName: 'Alice   \u200D' }))
            .toBe('Player alias cannot contain format characters.');
    });

    test.each([
        '<script>alert(1)</script>',
        '<b>Room</b>',
        '<img src=x onerror=alert(1)>',
        '<div>',
        '<>',
    ])('rejects HTML tag %s in room name and player alias', (tag) => {
        expect(validateJoin({ roomName: tag, playerName: 'Alice' }))
            .toBe('Room name cannot contain HTML tags.');
        expect(validateJoin({ roomName: 'Room1', playerName: tag }))
            .toBe('Player alias cannot contain HTML tags.');
    });

    test('preserves valid international Unicode names without prohibited characters', () => {
        expect(validateJoin({ roomName: '東京ポーカー', playerName: '田中' })).toBeNull();
        expect(validateJoin({ roomName: 'Café des Joueurs', playerName: 'René' })).toBeNull();
        expect(validateJoin({ roomName: 'Sala de Póker', playerName: 'José María' })).toBeNull();
        expect(validateJoin({ roomName: 'Покер Клуб', playerName: 'Иван' })).toBeNull();
    });

    test('validates optional password in validateJoin', () => {
        expect(validateJoin({ roomName: 'Room', playerName: 'Alice', password: 'valid-password' })).toBeNull();
        expect(validateJoin({ roomName: 'Room', playerName: 'Alice', password: 'a'.repeat(51) }))
            .toBe('Password must be at most 50 characters.');
        expect(validateJoin({ roomName: 'Room', playerName: 'Alice', password: 'bad\u0000pass' }))
            .toBe('Password cannot contain control characters.');
    });
});

describe('validatePassword', () => {
    test('allows undefined, null, empty, or whitespace-only passwords', () => {
        expect(validatePassword(undefined)).toBeNull();
        expect(validatePassword(null as unknown as string)).toBeNull();
        expect(validatePassword('')).toBeNull();
        expect(validatePassword('   ')).toBeNull();
    });

    test('enforces exact boundary lengths up to 50 characters', () => {
        expect(validatePassword('a')).toBeNull();
        expect(validatePassword('a'.repeat(49))).toBeNull();
        expect(validatePassword('a'.repeat(50))).toBeNull();
        expect(validatePassword('a'.repeat(51))).toBe(formatPasswordMaxError(VALIDATION.password.max));
        expect(validatePassword('a'.repeat(100))).toBe(formatPasswordMaxError(VALIDATION.password.max));
        expect(formatPasswordMaxError(50)).toBe(VALIDATION_PASSWORD_MAX);
    });

    test.each([
        ['\u0000', 'NUL (C0 start)', '\u0000secret'],
        ['\u0009', 'TAB (C0 middle)', 'sec\u0009ret'],
        ['\u000A', 'LF (C0 middle)', 'sec\u000Aret'],
        ['\u000D', 'CR (C0 middle)', 'sec\u000Dret'],
        ['\u001F', 'US (C0 boundary)', 'secret\u001F'],
        ['\u007F', 'DEL (control)', 'secret\u007F'],
        ['\u0080', 'PAD (C1 start)', '\u0080secret'],
        ['\u0085', 'NEL (C1 next line)', 'sec\u0085ret'],
        ['\u009F', 'APC (C1 boundary)', 'secret\u009F'],
    ])('rejects control character %s (%s) anywhere in password', (_char, _desc, pass) => {
        expect(validatePassword(pass)).toBe(VALIDATION_PASSWORD_CONTROL);
    });

    test('accepts rich international Unicode passwords and special symbols', () => {
        expect(validatePassword('パスワード#123')).toBeNull();
        expect(validatePassword('Пароль#456')).toBeNull();
        expect(validatePassword('كلمة_السر_789')).toBeNull();
        expect(validatePassword('Mötörhéad#99')).toBeNull();
        expect(validatePassword('🔒Secret🔑Key🎲')).toBeNull();
        expect(validatePassword('P@$$w0rd!^&*()_-+=[]{}|;:,.<>?/')).toBeNull();
    });

    test('applies no Unicode format character restriction or HTML tag sanitization to passwords', () => {
        expect(validatePassword('pass\u200Bword')).toBeNull();
        expect(validatePassword('<b>secret</b>')).toBeNull();
        expect(validatePassword('<script>alert("xss")</script>')).toBeNull();
    });
});

describe('normalizePassword', () => {
    test('normalizes undefined, null, empty, or whitespace-only passwords to undefined', () => {
        expect(normalizePassword(undefined)).toBeUndefined();
        expect(normalizePassword(null as unknown as string)).toBeUndefined();
        expect(normalizePassword('')).toBeUndefined();
        expect(normalizePassword('   ')).toBeUndefined();
        expect(normalizePassword('\t \n \r')).toBeUndefined();
    });

    test('transmits non-empty password unchanged, including leading/trailing spaces', () => {
        expect(normalizePassword('secret')).toBe('secret');
        expect(normalizePassword('  secret123  ')).toBe('  secret123  ');
        expect(normalizePassword(' spaced pass ')).toBe(' spaced pass ');
        expect(normalizePassword(' ' + 'a'.repeat(48) + ' ')).toBe(' ' + 'a'.repeat(48) + ' ');
    });
});

describe('parseCreateRoomSubmission and parseJoinRoomSubmission', () => {
    test('omits whitespace-only or undefined password in parseCreateRoomSubmission', () => {
        const parsedWithout = parseCreateRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
            maxPlayers: 6,
            smallBlind: 10,
            bigBlind: 20,
            buyIn: 1000,
        });
        expect(parsedWithout.password).toBeUndefined();

        const parsedWhitespace = parseCreateRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
            maxPlayers: 6,
            smallBlind: 10,
            bigBlind: 20,
            buyIn: 1000,
            password: '   ',
        });
        expect(parsedWhitespace.password).toBeUndefined();
    });

    test('preserves entered password in parseCreateRoomSubmission', () => {
        const parsed = parseCreateRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
            maxPlayers: 6,
            smallBlind: 10,
            bigBlind: 20,
            buyIn: 1000,
            password: '  secret123  ',
        });
        expect(parsed.password).toBe('  secret123  ');
    });

    test('parseJoinRoomSubmission trims names and handles password', () => {
        const withoutPass = parseJoinRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
        });
        expect(withoutPass).toEqual({
            roomName: 'Room 1',
            playerName: 'Alice',
        });

        const withPass = parseJoinRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
            password: '  secret123  ',
        });
        expect(withPass).toEqual({
            roomName: 'Room 1',
            playerName: 'Alice',
            password: '  secret123  ',
        });

        const withBlankPass = parseJoinRoomSubmission({
            roomName: ' Room 1 ',
            playerName: ' Alice ',
            password: '   ',
        });
        expect(withBlankPass).toEqual({
            roomName: 'Room 1',
            playerName: 'Alice',
        });
    });
});

