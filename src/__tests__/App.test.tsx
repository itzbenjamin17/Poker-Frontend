import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from '../App';
import { useAuthSession } from '../hooks/useAuthSession';
import '@testing-library/jest-dom';

vi.mock('../hooks/useAuthSession', () => ({
    useAuthSession: vi.fn(),
}));

vi.mock('../Lobby', () => ({
    default: ({ onAuth, initialError }: { onAuth: (auth: any) => void; initialError?: string | null }) => (
        <div data-testid="lobby-view">
            <span>Lobby Component</span>
            {initialError && <span data-testid="auth-error">{initialError}</span>}
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
    default: ({ auth, onLeave }: { auth: any; onLeave: () => void }) => (
        <div data-testid="game-view">
            <span>Game View Component for {auth.playerName}</span>
            <button type="button" onClick={onLeave}>
                Mock Leave Game
            </button>
        </div>
    ),
}));

describe('App', () => {
    const mockSetAuth = vi.fn();
    const mockClearAuth = vi.fn();
    const mockClearAuthError = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default desktop window dimensions
        window.innerWidth = 1024;
        window.innerHeight = 768;
    });

    it('renders Lobby component when user is unauthenticated', () => {
        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authError: null,
            clearAuthError: mockClearAuthError,
        });

        render(<App />);

        expect(screen.getByTestId('lobby-view')).toBeInTheDocument();
        expect(screen.queryByTestId('game-view')).not.toBeInTheDocument();
        expect(screen.getByText('VAULT POKER')).toBeInTheDocument();
    });

    it('renders GameView component when user is authenticated and triggers clearAuth on leave', async () => {
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
            authError: null,
            clearAuthError: mockClearAuthError,
        });

        render(<App />);

        expect(screen.getByTestId('game-view')).toBeInTheDocument();
        expect(screen.getByText('Game View Component for CardMaster')).toBeInTheDocument();
        expect(screen.queryByTestId('lobby-view')).not.toBeInTheDocument();

        // Clicking leave invokes clearAuth
        await user.click(screen.getByRole('button', { name: 'Mock Leave Game' }));
        expect(mockClearAuth).toHaveBeenCalledTimes(1);
    });

    it('displays screen-too-small warning when width is below 320px', () => {
        window.innerWidth = 300;
        window.innerHeight = 600;

        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authError: null,
            clearAuthError: mockClearAuthError,
        });

        render(<App />);

        expect(screen.getByText(/Window too narrow to play/i)).toBeInTheDocument();
        expect(screen.getByText(/Please resize your window/i)).toBeInTheDocument();
        expect(screen.queryByTestId('lobby-view')).not.toBeInTheDocument();
    });

    it('displays screen-too-small warning when height is below 480px', () => {
        window.innerWidth = 800;
        window.innerHeight = 400;

        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authError: null,
            clearAuthError: mockClearAuthError,
        });

        render(<App />);

        expect(screen.getByText(/Window too short to play/i)).toBeInTheDocument();
        expect(screen.getByText(/Try rotating your device/i)).toBeInTheDocument();
        expect(screen.queryByTestId('lobby-view')).not.toBeInTheDocument();
    });

    it('updates WindowSizeGuard display on window resize event', () => {
        window.innerWidth = 300;
        window.innerHeight = 600;

        vi.mocked(useAuthSession).mockReturnValue({
            auth: null,
            setAuth: mockSetAuth,
            clearAuth: mockClearAuth,
            authError: null,
            clearAuthError: mockClearAuthError,
        });

        render(<App />);
        expect(screen.getByText(/Window too narrow to play/i)).toBeInTheDocument();

        // Resize back to valid dimensions
        act(() => {
            window.innerWidth = 1024;
            window.innerHeight = 768;
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.queryByText(/Window too narrow to play/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('lobby-view')).toBeInTheDocument();
    });
});
