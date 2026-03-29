import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import type { AuthResponse } from '../types';

const API_BASE = '/api';

type ApiError = Error & { status: number };

function buildApiError(status: number, message: string): ApiError {
    const error = new Error(message) as ApiError;
    error.status = status;
    return error;
}

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const contentType = res.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
            const data = await res.json();
            if (typeof data?.message === 'string' && data.message.trim()) return data.message;
            if (typeof data?.error === 'string' && data.error.trim()) return data.error;
        } else {
            const text = await res.text();
            if (text.trim()) return text;
        }
    } catch {
        // Keep fallback when payload parsing fails.
    }

    return fallback;
}

function normalizeAuthResponse(raw: unknown): AuthResponse {
    const src = (raw ?? {}) as Record<string, unknown>;
    const data = (src.data ?? src.tokenResponse ?? src.tokenReponse ?? src.TokenResponse ?? src.tokenresponse ?? src) as Record<string, unknown>;

    return {
        message: typeof src.message === 'string' ? src.message : '',
        token: typeof data.token === 'string' ? data.token : '',
        roomId: typeof data.roomId === 'string' ? data.roomId : '',
        playerName: typeof data.playerName === 'string' ? data.playerName : '',
        playerId: typeof data.playerId === 'string' ? data.playerId : undefined,
    };
}

export const pokerApi = {
    async createRoom(payload: {
        roomName: string;
        playerName: string;
        maxPlayers: number;
        smallBlind: number;
        bigBlind: number;
        buyIn: number;
        password?: string;
    }) {
        const res = await fetch(`${API_BASE}/room/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create room'));
        return normalizeAuthResponse(await res.json());
    },

    async joinRoom(payload: { roomName: string; playerName: string; password?: string }) {
        const res = await fetch(`${API_BASE}/room/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to join room'));
        return normalizeAuthResponse(await res.json());
    },

    async getRoomInfo(roomId: string, token: string) {
        const res = await fetch(`${API_BASE}/room/${roomId}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get room info'));
        return res.json();
    },

    async getGameState(gameId: string, token: string) {
        const res = await fetch(`${API_BASE}/game/${gameId}/state`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get game state'));
        return res.json();
    },

    async getPrivateState(gameId: string, token: string) {
        const res = await fetch(`${API_BASE}/game/${gameId}/private-state`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get private state'));
        return res.json();
    },

    async leaveRoom(roomId: string, token: string, keepalive: boolean = false) {
        const res = await fetch(`${API_BASE}/room/${roomId}/leave`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
            keepalive,
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to leave room'));
        return res;
    },

    async leaveGame(gameId: string, token: string, keepalive: boolean = false) {
        const res = await fetch(`${API_BASE}/game/${gameId}/leave`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
            keepalive,
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to leave game'));
        return res;
    },

    async startGame(roomId: string, token: string) {
        const res = await fetch(`${API_BASE}/room/${roomId}/start-game`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to start game'));

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            return res.json();
        }

        return null;
    },

    async performAction(gameId: string, action: string, amount: number, token: string) {
        const res = await fetch(`${API_BASE}/game/${gameId}/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ action, amount }),
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Action failed'));
        return res.ok;
    },

    async claimWin(gameId: string, token: string) {
        const res = await fetch(`${API_BASE}/game/${gameId}/claim-win`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to claim win'));
        return res.ok;
    },
};

export function createStompClient(token: string) {
    return new Client({
        webSocketFactory: () => new SockJS('/ws'),
        connectHeaders: {
            Authorization: `Bearer ${token}`,
        },
        debug: (str) => console.log(str),
        reconnectDelay: 5000,
    });
}
