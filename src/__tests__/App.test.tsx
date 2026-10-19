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
    default: ({ auth, onRequestLeave, onLeave, leaveError }: { auth: any; onRequestLeave: () => Promise<boolean>; onLeave: () => void; leaveError?: string | null }) => (
        <div data-testid="game-view">
            <span>Game View Component for {auth.playerName}</span>
            {leaveError && <p role="alert">{leaveError}</p>}
            <button type="button" onClick={() => { void onRequestLeave(); }}>
                Mock Leave Game
            </button>
            <button type="button" onClick={() => { void onRequestLeave(); }}>Retry Leave</button>
            <button type="button" onClick={onLeave}>Stale Local Leave</button>
        </div>
    ),
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
});
