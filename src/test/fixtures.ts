export const mockAuth = {
  token: 'test.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })) + '.test',
  roomId: 'ROOM123',
  playerName: 'TestPlayer',
  playerId: 'p-1',
  message: 'Success',
};
