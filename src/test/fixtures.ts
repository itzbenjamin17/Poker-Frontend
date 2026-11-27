import type { AuthResponse, GameState, Player, RoomDataResponse } from '../types';

export const DEFAULT_MOCK_JWT_EXP = 4_102_444_800; // 2100-01-01T00:00:00Z

export interface MockJwtClaims {
    exp?: number;
    sub?: string;
    jti?: string;
    [key: string]: unknown;
}

export function createMockJwt(expOrClaims?: number | MockJwtClaims): string {
    const claims: MockJwtClaims = typeof expOrClaims === 'number'
        ? { exp: expOrClaims }
        : expOrClaims && typeof expOrClaims === 'object'
            ? { exp: DEFAULT_MOCK_JWT_EXP, ...expOrClaims }
            : { exp: DEFAULT_MOCK_JWT_EXP };

    const payload = btoa(JSON.stringify(claims))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `test.${payload}.test`;
}

export function createExpiredJwt(nowMs = Date.now()): string {
    return createMockJwt(Math.floor(nowMs / 1000) - 60);
}

export function createMockAuth(overrides: Partial<AuthResponse> = {}): AuthResponse {
    return {
        token: createMockJwt(),
        roomId: 'room-123',
        playerName: 'Player 1',
        ...overrides,
    };
}

export const mockAuth: Readonly<AuthResponse> = Object.freeze(createMockAuth());

export function createValidPlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: 'player-1',
        name: 'Player 1',
        chips: 1_000,
        currentBet: 0,
        status: 'ACTIVE',
        hasFolded: false,
        ...overrides,
    };
}

export type GameStateOverrides = Partial<Omit<GameState, 'players'>> & {
    players?: ReadonlyArray<Partial<Player>>;
};

export function createValidGameState(overrides: GameStateOverrides = {}): GameState {
    const { players: overriddenPlayers, ...restOverrides } = overrides;
    const players = overriddenPlayers
        ? overriddenPlayers.map((player) => createValidPlayer(player))
        : [createValidPlayer()];
    return {
        gameId: 'game-123',
        maxPlayers: 6,
        pot: 0,
        phase: 'PRE_FLOP',
        currentBet: 0,
        communityCards: [],
        currentPlayerName: 'Player 1',
        currentPlayerId: 'player-1',
        ...restOverrides,
        players,
    };
}

export function createValidRoomData(overrides: Partial<RoomDataResponse> = {}): RoomDataResponse {
    return {
        roomId: 'room-123',
        roomName: 'Test Room',
        maxPlayers: 6,
        buyIn: 1_000,
        smallBlind: 10,
        bigBlind: 20,
        canStartGame: false,
        gameStarted: false,
        players: [{ name: 'Player 1', isHost: true }],
        ...overrides,
    };
}

/** Intentionally untyped builder for malformed-payload decoder tests only. */
export function createRawGameStatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base = createValidGameState();
    const { players: overriddenPlayers, ...restOverrides } = overrides;
    const players = Array.isArray(overriddenPlayers)
        ? overriddenPlayers.map((player) => (
            typeof player === 'object' && player !== null && !Array.isArray(player)
                ? { ...createValidPlayer(), ...player }
                : player
        ))
        : overriddenPlayers === undefined
            ? base.players
            : overriddenPlayers;
    return {
        ...base,
        ...restOverrides,
        players,
    };
}

/** Intentionally untyped builder for malformed-payload room decoder tests only. */
export function createRawRoomDataPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...createValidRoomData(),
        ...overrides,
    };
}
