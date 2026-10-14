import type { GameState, Player, RoomDataResponse } from '../types';

export function createMockJwt(exp = Math.floor(Date.now() / 1000) + 3600): string {
    const payload = btoa(JSON.stringify({ exp }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `test.${payload}.test`;
}

export const mockAuth = {
    get token() {
        return createMockJwt();
    },
    roomId: 'room-123',
    playerName: 'Player 1',
    message: 'Success',
};

export function createValidPlayer(overrides: Record<string, unknown> = {}): Player {
    return {
        id: 'player-1',
        name: 'Player 1',
        chips: 1_000,
        currentBet: 0,
        status: 'ACTIVE',
        hasFolded: false,
        ...overrides,
    } as Player;
}

export function createValidGameState(overrides: Record<string, unknown> = {}): GameState {
    const overriddenPlayers = overrides.players;
    const players = Array.isArray(overriddenPlayers)
        ? overriddenPlayers.map((player) => (
            typeof player === 'object' && player !== null && !Array.isArray(player)
                ? createValidPlayer(player as Record<string, unknown>)
                : player
        ))
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
        ...overrides,
        players,
    } as GameState;
}

export function createValidRoomData(overrides: Record<string, unknown> = {}): RoomDataResponse {
    return {
        roomId: 'room-123',
        roomName: 'Test Room',
        maxPlayers: 6,
        buyIn: 1_000,
        smallBlind: 10,
        bigBlind: 20,
        createdAt: '2026-01-01T00:00:00.000Z',
        hostName: 'Player 1',
        currentPlayers: 1,
        canStartGame: false,
        gameStarted: false,
        players: [{ name: 'Player 1', isHost: true, joinedAt: '2026-01-01T00:00:00.000Z' }],
        ...overrides,
    } as RoomDataResponse;
}
