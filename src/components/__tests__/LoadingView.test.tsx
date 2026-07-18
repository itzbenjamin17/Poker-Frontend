import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoadingView } from '../LoadingView';

describe('LoadingView', () => {
    it('renders with status role and aria-busy set to true', () => {
        render(<LoadingView status="Connecting to Game" />);
        const element = screen.getByRole('status');
        expect(element).toBeInTheDocument();
        expect(element).toHaveAttribute('aria-busy', 'true');
    });

    it('renders the status text in uppercase', () => {
        render(<LoadingView status="Restoring session" />);
        expect(screen.getByText('Restoring session')).toBeInTheDocument();
    });

    it('does not render Return to Lobby button when onLeave is not provided', () => {
        render(<LoadingView status="Connecting..." />);
        const button = screen.queryByRole('button', { name: /return to lobby/i });
        expect(button).not.toBeInTheDocument();
    });

    it('does not render Return to Lobby button when redirecting', () => {
        const onLeaveMock = vi.fn();
        render(<LoadingView status="Session expired. Returning to lobby..." onLeave={onLeaveMock} />);
        const button = screen.queryByRole('button', { name: /return to lobby/i });
        expect(button).not.toBeInTheDocument();
    });

    it('renders Return to Lobby button when onLeave is provided and calls callback on click', () => {
        const onLeaveMock = vi.fn();
        render(<LoadingView status="Connecting..." onLeave={onLeaveMock} />);
        const button = screen.getByRole('button', { name: /return to lobby/i });
        expect(button).toBeInTheDocument();
        
        button.click();
        expect(onLeaveMock).toHaveBeenCalledTimes(1);
    });
});
