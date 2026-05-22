import { Client } from '@stomp/stompjs';
import type { AuthResponse, RoomDataResponse } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const REQUEST_TIMEOUT_MS = 15000;

function getWebSocketUrl(): string {
    const envUrl = import.meta.env.VITE_WS_URL;
    if (envUrl) return envUrl;

    if (typeof window !== 'undefined' && window.location) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/ws`;
    }
    return 'ws://localhost:8080/ws';
}

type ApiError = Error & { status: number };

function buildApiError(status: number, message: string): ApiError {
    const error = new Error(message) as ApiError;
    error.status = status;
    return error;
}

export async function getErrorMessage(res: Response, fallback: string): Promise<string> {
    if (res.status === 429) {
        return 'Too many requests. Please try again later.';
    }
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
    // Backend sends: { "message": "...", "data": { "token": "...", "roomId": "...", "playerName": "..." } }
    const data = (src.data ?? src) as Record<string, unknown>;

    return {
        message: typeof src.message === 'string' ? src.message : '',
        token: typeof data.token === 'string' ? data.token : '',
        roomId: typeof data.roomId === 'string' ? data.roomId : '',
        playerName: typeof data.playerName === 'string' ? data.playerName : '',
    };
}

/**
 * Shared fetch wrapper: injects auth header, ngrok bypass, and a request timeout.
 */
async function authFetch(
    url: string,
    options: RequestInit & { token: string }
): Promise<Response> {
    const { token, headers, ...rest } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, {
            ...rest,
            signal: controller.signal,
            headers: {
                ...headers,
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true',
            },
        });
    } finally {
        clearTimeout(timeoutId);
    }
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
    }): Promise<AuthResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${API_BASE}/room/create`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create room'));
            return normalizeAuthResponse(await res.json());
        } finally {
            clearTimeout(timeoutId);
        }
    },

    async joinRoom(payload: { roomName: string; playerName: string; password?: string }): Promise<AuthResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${API_BASE}/room/join`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to join room'));
            return normalizeAuthResponse(await res.json());
        } finally {
            clearTimeout(timeoutId);
        }
    },

    async getRoomInfo(roomId: string, token: string): Promise<RoomDataResponse> {
        const res = await authFetch(`${API_BASE}/room/${roomId}`, { method: 'GET', token });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get room info'));
        return res.json() as Promise<RoomDataResponse>;
    },

    async getGameState(gameId: string, token: string): Promise<unknown> {
        const res = await authFetch(`${API_BASE}/game/${gameId}/state`, { method: 'GET', token });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get game state'));
        return res.json();
    },

    async getPrivateState(gameId: string, token: string): Promise<unknown> {
        const res = await authFetch(`${API_BASE}/game/${gameId}/private-state`, { method: 'GET', token });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to get private state'));
        return res.json();
    },

    async leaveRoom(roomId: string, token: string, keepalive = false): Promise<Response> {
        const res = await authFetch(`${API_BASE}/room/${roomId}/leave`, { method: 'POST', token, keepalive });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to leave room'));
        return res;
    },

    async leaveGame(gameId: string, token: string, keepalive = false): Promise<Response> {
        const res = await authFetch(`${API_BASE}/game/${gameId}/leave`, { method: 'POST', token, keepalive });
        if (!res.ok) throw buildApiError(res.status, await getErrorMessage(res, 'Failed to leave game'));
        return res;
    },

    async startGame(roomId: string, token: string): Promise<unknown> {
        const res = await authFetch(`${API_BASE}/room/${roomId}/start-game`, { method: 'POST', token });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to start game'));
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) return res.json();
        return null;
    },

    async claimWin(gameId: string, token: string): Promise<boolean> {
        const res = await authFetch(`${API_BASE}/game/${gameId}/claim-win`, { method: 'POST', token });
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to claim win'));
        return res.ok;
    },
};

export function createStompClient(token: string) {
    return new Client({
        brokerURL: getWebSocketUrl(),
        connectHeaders: {
            Authorization: `Bearer ${token}`,
        },
        debug: (str) => {
            if (import.meta.env.DEV) {
                console.log(str);
            }
        },
        reconnectDelay: 5000,
    });
}
