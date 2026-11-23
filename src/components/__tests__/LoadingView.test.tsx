import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LoadingView } from '../LoadingView';

describe('LoadingView', () => {
    it('places the status role on the status paragraph', () => {
        render(<LoadingView status="Connecting to Game" />);
        const element = screen.getByRole('status');
        expect(element).toBeInTheDocument();
        expect(element.tagName).toBe('P');
        expect(element).toHaveTextContent('Connecting to Game');
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

    it('keeps error state and recovery actions scrollable and compact on short landscape viewports', () => {
        render(
            <LoadingView
                status="Connection interrupted"
                error={true}
                errorMessage="Network unreachable"
                onRetry={vi.fn()}
                onLeave={vi.fn()}
            />
        );

        const wrapper = screen.getByTestId('loading-view');
        expect(wrapper).toHaveClass('overflow-y-auto', 'max-h-full', 'short:py-2');
        expect(wrapper.firstElementChild).toHaveClass('m-auto', 'short:gap-3');
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /return to lobby/i })).toBeInTheDocument();
    });
});
