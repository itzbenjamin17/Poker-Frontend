import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const API_BASE = '/api';

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
        if (!res.ok) throw new Error('Failed to create room');
        return res.json();
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
        if (!res.ok) throw new Error('Failed to join room');
        return res.json();
    },

    async startGame(roomId: string, token: string) {
        const res = await fetch(`${API_BASE}/room/${roomId}/start-game`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'ngrok-skip-browser-warning': 'true'
            },
        });
        if (!res.ok) throw new Error('Failed to start game');
        return res.json();
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
        if (!res.ok) throw new Error('Action failed');
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
