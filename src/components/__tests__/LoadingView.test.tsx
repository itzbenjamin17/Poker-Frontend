import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    it('does not render Return to Lobby button when onLeave is omitted', () => {
        render(<LoadingView status="Connecting..." />);
        const button = screen.queryByRole('button', { name: /return to lobby/i });
        expect(button).not.toBeInTheDocument();
    });

    it('renders Return to Lobby button and invokes onLeave when clicked if onLeave is provided', async () => {
        const user = userEvent.setup();
        const onLeave = vi.fn();
        render(<LoadingView status="Restoring your seat..." onLeave={onLeave} />);

        const button = screen.getByRole('button', { name: /return to lobby/i });
        expect(button).toBeInTheDocument();

        await user.click(button);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });
});
