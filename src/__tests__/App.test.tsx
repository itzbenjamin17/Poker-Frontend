import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from '../App';
import { useAuthSession } from '../hooks/useAuthSession';
import { pokerApi } from '../services/api';
import '@testing-library/jest-dom';

vi.mock('../hooks/useAuthSession', () => ({
    useAuthSession: vi.fn(),
}));

vi.mock('../services/api', () => ({ pokerApi: { leaveRoom: vi.fn() } }));

vi.mock('../Lobby', () => ({
    default: ({ onAuth }: { onAuth: (auth: any) => void }) => (
        <div data-testid="lobby-view">
            <span>Lobby Component</span>
            <button
                type="button"
                onClick={() =>
                    onAuth({
                        roomId: 'room-1',
                        playerName: 'TestPlayer',
                        token: 'jwt-token',
                    })
                }
            >
                Mock Authenticate
            </button>
        </div>
    ),
}));

vi.mock('../GameView', () => ({
    default: ({ auth, onRequestLeave, onLeave, leaveError }: { auth: any; onRequestLeave: () => Promise<boolean>; onLeave: () => void; leaveError?: string | null }) => {
        if (auth?.token === 'crash-token') {
            throw new Error('GameView crashed for User A');
        }
        return (
            <div data-testid="game-view" data-auth-key={`${auth.roomId}:${auth.playerName}:${auth.token}`}>
                <span>Game View Component for {auth.playerName}</span>
                {leaveError && <p role="alert">{leaveError}</p>}
                <input data-testid="local-bet-input" defaultValue="100" />
                <button type="button" onClick={() => { void onRequestLeave(); }}>
                    Mock Leave Game
                </button>
                <button type="button" onClick={() => { void onRequestLeave(); }}>Retry Leave</button>
                <button type="button" onClick={onLeave}>Stale Local Leave</button>
            </div>
        );
    },
}));

describe('App', () => {
    const mockSetAuth = vi.fn();
    const mockClearAuth = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pokerApi.leaveRoom).mockResolvedValue();
        // Default desktop window dimensions
        window.innerWidth = 1024;
        window.innerHeight = 768;
    });

    it('renders Lobby component when user is unauthenticated', () => {
        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authExpired: false,
            dismissAuthExpired: vi.fn(),
            isCurrentToken: vi.fn(() => true),
            getCurrentAuth: vi.fn(() => null),
        });

        render(<App />);

        expect(screen.getByTestId('lobby-view')).toBeInTheDocument();
        expect(screen.queryByTestId('game-view')).not.toBeInTheDocument();
        expect(screen.getByText('POKER')).toBeInTheDocument();
    });

    it('shows a dismissible lobby explanation after the current token expires', async () => {
        const user = userEvent.setup();
        const dismissAuthExpired = vi.fn();
        vi.mocked(useAuthSession).mockReturnValue({
            auth: null, setAuth: mockSetAuth, clearAuth: mockClearAuth,
            authExpired: true, dismissAuthExpired, isCurrentToken: vi.fn(() => false), getCurrentAuth: vi.fn(() => null),
        });
        render(<App />);
        expect(screen.getByRole('alert')).toHaveTextContent(/room session expired/i);
        await user.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(dismissAuthExpired).toHaveBeenCalledTimes(1);
    });

    it('routes explicit leave through the room endpoint before clearing auth', async () => {
        const user = userEvent.setup();
        vi.mocked(useAuthSession).mockReturnValue({
            auth: {
                roomId: 'room-123',
                playerName: 'CardMaster',
                token: 'valid-jwt',
                message: 'Success',
            },
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authExpired: false,
            dismissAuthExpired: vi.fn(),
            isCurrentToken: vi.fn(() => true), getCurrentAuth: vi.fn(() => ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' })),
        });

        render(<App />);

        expect(await screen.findByTestId('game-view')).toBeInTheDocument();
        expect(screen.getByText('Game View Component for CardMaster')).toBeInTheDocument();
        expect(screen.queryByTestId('lobby-view')).not.toBeInTheDocument();

        // Clicking leave invokes one room departure request and then clears auth.
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));
        expect(pokerApi.leaveRoom).toHaveBeenCalledWith('room-123', 'valid-jwt');
        expect(mockClearAuth).toHaveBeenCalledWith('valid-jwt');
    });

    it('keeps auth and exposes a retry when room departure fails', async () => {
        const user = userEvent.setup();
        vi.mocked(pokerApi.leaveRoom).mockRejectedValueOnce(Object.assign(new Error('Network unavailable'), { status: 500 }));
        vi.mocked(useAuthSession).mockReturnValue({
            auth: { roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' },
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn(() => true), getCurrentAuth: vi.fn(() => ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' })),
        });

        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
        expect(mockClearAuth).not.toHaveBeenCalled();
        expect(screen.getByTestId('game-view')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Retry Leave' }));
        expect(pokerApi.leaveRoom).toHaveBeenCalledTimes(2);
        expect(mockClearAuth).toHaveBeenCalledWith('valid-jwt');
    });

    it.each([200, 404, 410])('preserves same-room replacement auth and review after stale leave status %s', async (status) => {
        const user = userEvent.setup();
        let currentToken = 'valid-jwt';
        let resolveLeave!: () => void;
        vi.mocked(pokerApi.leaveRoom).mockImplementation(() => new Promise<void>((resolve, reject) => {
            resolveLeave = () => status === 200 ? resolve() : reject(Object.assign(new Error('Gone'), { status }));
        }));
        vi.mocked(useAuthSession).mockReturnValue({
            auth: { roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' },
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn((token: string) => currentToken === token), getCurrentAuth: vi.fn(() => currentToken === 'valid-jwt' ? ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' }) : ({ roomId: 'room-123', playerName: 'CardMaster', token: currentToken, message: 'Success' })),
        });

        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));
        currentToken = 'replacement-token';
        const replacementReview = JSON.stringify({ winnerName: 'Replacement', isForfeit: false, message: 'New review' });
        sessionStorage.setItem('poker-game-end:room-123', replacementReview);
        await act(async () => { resolveLeave(); });

        expect(mockClearAuth).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBe(replacementReview);
    });

    it('retains auth and final review and shows a retryable error when leaveRoom fails with 503', async () => {
        const user = userEvent.setup();
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify({ winnerName: 'W', isForfeit: false, message: 'm' }));
        vi.mocked(pokerApi.leaveRoom).mockRejectedValueOnce(Object.assign(new Error('Server unavailable'), { status: 503 }));
        vi.mocked(useAuthSession).mockReturnValue({
            auth: { roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' },
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn(() => true), getCurrentAuth: vi.fn(() => ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' })),
        });

        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
        expect(mockClearAuth).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();
    });

    it('clears auth and cleans persisted state when leaveRoom fails with 404 or 410', async () => {
        const user = userEvent.setup();
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify({ winnerName: 'W', isForfeit: false, message: 'm' }));
        vi.mocked(pokerApi.leaveRoom).mockRejectedValueOnce(Object.assign(new Error('Gone'), { status: 410 }));
        vi.mocked(useAuthSession).mockReturnValue({
            auth: { roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' },
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn(() => true), getCurrentAuth: vi.fn(() => ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' })),
        });

        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));

        expect(mockClearAuth).toHaveBeenCalledWith('valid-jwt');
        expect(sessionStorage.getItem('poker-game-end:room-123')).toBeNull();
    });

    it('ignores a stale local leave callback for a same-room replacement token', async () => {
        const user = userEvent.setup();
        const replacement = { roomId: 'room-123', playerName: 'CardMaster', token: 'replacement', message: 'Success' };
        sessionStorage.setItem('poker-game-end:room-123', JSON.stringify({ winnerName: 'W', isForfeit: false, message: 'm' }));
        vi.mocked(useAuthSession).mockReturnValue({
            auth: { roomId: 'room-123', playerName: 'CardMaster', token: 'old-token', message: 'Success' },
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn(() => false), getCurrentAuth: vi.fn(() => replacement),
        });
        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Stale Local Leave' }));
        expect(mockClearAuth).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('poker-game-end:room-123')).not.toBeNull();
    });

    it('cleans up persisted game-end for originating room when older leave request resolves without wiping replacement state', async () => {
        const user = userEvent.setup();
        let resolveLeave!: () => void;
        vi.mocked(pokerApi.leaveRoom).mockImplementation(() => new Promise<void>((resolve) => { resolveLeave = resolve; }));
        sessionStorage.setItem('poker-game-end:room-old', JSON.stringify({ winnerName: 'Old', isForfeit: false, message: 'old' }));
        sessionStorage.setItem('poker-game-end:room-new', JSON.stringify({ winnerName: 'New', isForfeit: false, message: 'new' }));

        let currentAuth: any = { roomId: 'room-old', playerName: 'CardMaster', token: 'token-old', message: 'Success' };
        vi.mocked(useAuthSession).mockImplementation(() => ({
            auth: currentAuth,
            setAuth: mockSetAuth, clearAuth: mockClearAuth, authExpired: false,
            dismissAuthExpired: vi.fn(), isCurrentToken: vi.fn((token: string) => currentAuth?.token === token), getCurrentAuth: vi.fn(() => currentAuth),
        }));

        render(<App />);
        await screen.findByTestId('game-view');
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));

        // Now user is in a different room with a new token
        currentAuth = { roomId: 'room-new', playerName: 'CardMaster', token: 'token-new', message: 'Success' };
        resolveLeave();

        await Promise.resolve();
        expect(sessionStorage.getItem('poker-game-end:room-old')).toBeNull();
        expect(sessionStorage.getItem('poker-game-end:room-new')).not.toBeNull();
        expect(mockClearAuth).not.toHaveBeenCalledWith('token-new');
    });

    it('renders the lobby in a narrow window without a size warning (WindowSizeGuard was removed)', () => {
        window.innerWidth = 300;
        window.innerHeight = 600;

        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authExpired: false,
            dismissAuthExpired: vi.fn(),
            isCurrentToken: vi.fn(() => true),
            getCurrentAuth: vi.fn(() => null),
        });

        render(<App />);

        expect(screen.getByTestId('lobby-view')).toBeInTheDocument();
        expect(screen.queryByText(/Window too narrow to play/i)).not.toBeInTheDocument();
    });

    it('reloads the page when Try Again handles a GameView load failure', async () => {
        const user = userEvent.setup();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });

        try {
            vi.resetModules();
            vi.doMock('../GameView', () => {
                throw new Error('GameView chunk failed');
            });
            const authModule = await import('../hooks/useAuthSession');
            vi.mocked(authModule.useAuthSession).mockReturnValue({
                auth: {
                    roomId: 'room-123',
                    playerName: 'CardMaster',
                    token: 'valid-jwt',
                    message: 'Success',
                },
                setAuth: mockSetAuth,
                clearAuth: mockClearAuth,
                authExpired: false,
                dismissAuthExpired: vi.fn(),
                isCurrentToken: vi.fn(() => true),
                getCurrentAuth: vi.fn(() => ({ roomId: 'room-123', playerName: 'CardMaster', token: 'valid-jwt', message: 'Success' })),
            });
            const { default: AppWithFailedGameView } = await import('../App');

            render(<AppWithFailedGameView />);
            await user.click(await screen.findByRole('button', { name: /try again/i }));

            expect(reloadSpy).toHaveBeenCalledTimes(1);
            expect(mockClearAuth).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: originalLocation,
            });
            consoleSpy.mockRestore();
            vi.doUnmock('../GameView');
        }
    });

    it('resets error boundary state when switching from a failed user session to another user', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            let currentAuth: any = {
                roomId: 'room-1',
                playerName: 'UserA',
                token: 'crash-token',
                message: 'Success',
            };

            vi.mocked(useAuthSession).mockImplementation(() => ({
                auth: currentAuth,
                setAuth: mockSetAuth,
                clearAuth: mockClearAuth,
                authExpired: false,
                dismissAuthExpired: vi.fn(),
                isCurrentToken: vi.fn((token: string) => currentAuth?.token === token),
                getCurrentAuth: vi.fn(() => currentAuth),
            }));

            const { rerender } = render(<App />);

            // User A throws an uncaught error inside GameView; ErrorBoundary catches it
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
            expect(screen.queryByTestId('game-view')).not.toBeInTheDocument();

            // Switch auth to User B
            currentAuth = {
                roomId: 'room-2',
                playerName: 'UserB',
                token: 'valid-token-b',
                message: 'Success',
            };

            rerender(<App />);

            // User B must NOT be trapped in User A's error screen; GameView for User B must render!
            expect(await screen.findByTestId('game-view')).toBeInTheDocument();
            expect(screen.getByText('Game View Component for UserB')).toBeInTheDocument();
            expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
        } finally {
            consoleSpy.mockRestore();
        }
    });

    it('remounts GameView subtree and resets local state when auth identity changes but preserves it on same-identity rerender', async () => {
        let currentAuth: any = {
            roomId: 'room-1',
            playerName: 'UserA',
            token: 'token-a',
            message: 'Success',
        };

        vi.mocked(useAuthSession).mockImplementation(() => ({
            auth: currentAuth,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authExpired: false,
            dismissAuthExpired: vi.fn(),
            isCurrentToken: vi.fn((token: string) => currentAuth?.token === token),
            getCurrentAuth: vi.fn(() => currentAuth),
        }));

        const { rerender } = render(<App />);

        const view1 = await screen.findByTestId('game-view');
        expect(view1).toHaveAttribute('data-auth-key', 'room-1:UserA:token-a');

        // Mutate local state in GameView
        const input = screen.getByTestId('local-bet-input');
        expect(input).toHaveValue('100');
        await userEvent.clear(input);
        await userEvent.type(input, '500');
        expect(input).toHaveValue('500');

        // Re-render with same auth identity: element instance and local state are preserved
        rerender(<App />);
        const view2 = screen.getByTestId('game-view');
        expect(view2).toBe(view1);
        expect(screen.getByTestId('local-bet-input')).toHaveValue('500');

        // Switch to different auth identity: GameView subtree remounts and local state resets
        currentAuth = {
            roomId: 'room-2',
            playerName: 'UserB',
            token: 'token-b',
            message: 'Success',
        };
        rerender(<App />);

        const view3 = await screen.findByTestId('game-view');
        expect(view3).not.toBe(view1);
        expect(view3).toHaveAttribute('data-auth-key', 'room-2:UserB:token-b');
        expect(screen.getByTestId('local-bet-input')).toHaveValue('100');
    });

    it('remounts GameView subtree and resets local state when same-room same-player auth token is replaced', async () => {
        let currentAuth: any = {
            roomId: 'room-1',
            playerName: 'UserA',
            token: 'token-a1',
            message: 'Success',
        };

        vi.mocked(useAuthSession).mockImplementation(() => ({
            auth: currentAuth,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authExpired: false,
            dismissAuthExpired: vi.fn(),
            isCurrentToken: vi.fn((token: string) => currentAuth?.token === token),
            getCurrentAuth: vi.fn(() => currentAuth),
        }));

        const { rerender } = render(<App />);

        const view1 = await screen.findByTestId('game-view');
        expect(view1).toHaveAttribute('data-auth-key', 'room-1:UserA:token-a1');

        const input = screen.getByTestId('local-bet-input');
        expect(input).toHaveValue('100');
        await userEvent.clear(input);
        await userEvent.type(input, '750');
        expect(input).toHaveValue('750');

        // Re-render with identical auth credentials but a fresh object reference
        currentAuth = {
            roomId: 'room-1',
            playerName: 'UserA',
            token: 'token-a1',
            message: 'Success',
        };
        rerender(<App />);

        const viewSame = screen.getByTestId('game-view');
        expect(viewSame).toBe(view1);
        expect(screen.getByTestId('local-bet-input')).toHaveValue('750');

        // Cross-tab replacement / eviction: same room & player, but new token
        currentAuth = {
            roomId: 'room-1',
            playerName: 'UserA',
            token: 'token-a2',
            message: 'Success',
        };
        rerender(<App />);

        const viewReplaced = await screen.findByTestId('game-view');
        expect(viewReplaced).not.toBe(view1);
        expect(viewReplaced).toHaveAttribute('data-auth-key', 'room-1:UserA:token-a2');
        expect(screen.getByTestId('local-bet-input')).toHaveValue('100');
    });

    it('resets error boundary state when same user re-authenticates in same room with fresh token after crash', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            let currentAuth: any = {
                roomId: 'room-1',
                playerName: 'UserA',
                token: 'crash-token',
                message: 'Success',
            };

            vi.mocked(useAuthSession).mockImplementation(() => ({
                auth: currentAuth,
                setAuth: mockSetAuth,
                clearAuth: mockClearAuth,
                authExpired: false,
                dismissAuthExpired: vi.fn(),
                isCurrentToken: vi.fn((token: string) => currentAuth?.token === token),
                getCurrentAuth: vi.fn(() => currentAuth),
            }));

            const { rerender } = render(<App />);

            // User A throws an uncaught error inside GameView; ErrorBoundary catches it
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
            expect(screen.queryByTestId('game-view')).not.toBeInTheDocument();

            // Re-authenticate User A in same room with fresh non-crashing token
            currentAuth = {
                roomId: 'room-1',
                playerName: 'UserA',
                token: 'fresh-token',
                message: 'Success',
            };

            rerender(<App />);

            // Fresh token changes authKey, so ErrorBoundary is reset and GameView renders cleanly
            expect(await screen.findByTestId('game-view')).toBeInTheDocument();
            expect(screen.getByText('Game View Component for UserA')).toBeInTheDocument();
            expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
        } finally {
            consoleSpy.mockRestore();
        }
    });
});
