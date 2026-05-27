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

/** Decode JWT payload and check exp claim. Returns false if expired. */
export function isJwtValid(token: string): boolean {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof payload.exp === 'number') {
            return payload.exp * 1000 > Date.now();
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Shared fetch wrapper: injects headers, ngrok bypass (dev), handles network errors.
 */
async function fetchApi<T>(url: string, options: RequestInit & { token?: string }): Promise<T> {
    const { token, headers, ...rest } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const mergedHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(import.meta.env.DEV ? { 'ngrok-skip-browser-warning': 'true' } : {}),
            ...(headers as Record<string, string>),
        };
        if (token) {
            if (!isJwtValid(token)) {
                window.dispatchEvent(new Event('auth-expired'));
                throw buildApiError(401, 'Session expired');
            }
            mergedHeaders['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            ...rest,
            signal: controller.signal,
            headers: mergedHeaders,
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                window.dispatchEvent(new Event('auth-expired'));
            }
            throw buildApiError(response.status, await getErrorMessage(response, 'Request failed'));
        }

        // Return empty object/null for 204 or responses without JSON
        if (response.status === 204) return null as T;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        return null as T;
    } catch (e) {
        if (e instanceof TypeError) {
            throw buildApiError(0, 'Unable to reach the server. Check your connection.');
        }
        throw e;
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
        const data = await fetchApi<unknown>(`${API_BASE}/room/create`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return normalizeAuthResponse(data);
    },

    async joinRoom(payload: { roomName: string; playerName: string; password?: string }): Promise<AuthResponse> {
        const data = await fetchApi<unknown>(`${API_BASE}/room/join`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return normalizeAuthResponse(data);
    },

    async getRoomInfo(roomId: string, token: string): Promise<RoomDataResponse> {
        return fetchApi<RoomDataResponse>(`${API_BASE}/room/${encodeURIComponent(roomId)}`, { method: 'GET', token });
    },

    async getGameState(gameId: string, token: string): Promise<unknown> {
        return fetchApi<unknown>(`${API_BASE}/game/${encodeURIComponent(gameId)}/state`, { method: 'GET', token });
    },

    async getPrivateState(gameId: string, token: string): Promise<unknown> {
        return fetchApi<unknown>(`${API_BASE}/game/${encodeURIComponent(gameId)}/private-state`, { method: 'GET', token });
    },

    async leaveRoom(roomId: string, token: string, keepalive = false): Promise<void> {
        await fetchApi<void>(`${API_BASE}/room/${encodeURIComponent(roomId)}/leave`, { method: 'POST', token, keepalive });
    },

    async leaveGame(gameId: string, token: string, keepalive = false): Promise<void> {
        await fetchApi<void>(`${API_BASE}/game/${encodeURIComponent(gameId)}/leave`, { method: 'POST', token, keepalive });
    },

    async startGame(roomId: string, token: string): Promise<unknown> {
        return fetchApi<unknown>(`${API_BASE}/room/${encodeURIComponent(roomId)}/start-game`, { method: 'POST', token });
    },

    async claimWin(gameId: string, token: string): Promise<boolean> {
        await fetchApi<void>(`${API_BASE}/game/${encodeURIComponent(gameId)}/claim-win`, { method: 'POST', token });
        return true;
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
