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
