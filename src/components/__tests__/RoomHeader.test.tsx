import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RoomHeader } from '../RoomHeader';
import { GameContext } from '../../context/GameContext';
import '@testing-library/jest-dom';

describe('RoomHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('room name overflow', () => {
        const longName = 'Friday Night High Stakes Hold em Club';

        function mockTextWidths(scrollWidth: number, clientWidth: number) {
            const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
            const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
            return () => { scroll.mockRestore(); client.mockRestore(); };
        }

        it('lets touch and keyboard users expand a room name that is cut off', async () => {
            const restore = mockTextWidths(300, 120);
            try {
                const user = userEvent.setup();
                render(<RoomHeader roomName={longName} wsStatus="connected" onLeave={vi.fn()} />);

                const toggle = screen.getByRole('button', { name: longName });
                expect(toggle).toHaveAttribute('aria-expanded', 'false');

                await user.click(toggle);
                expect(toggle).toHaveAttribute('aria-expanded', 'true');

                await user.click(toggle);
                expect(toggle).toHaveAttribute('aria-expanded', 'false');
            } finally {
                restore();
            }
        });

        it('keeps a room name that fits as plain text', () => {
            const restore = mockTextWidths(80, 120);
            try {
                render(<RoomHeader roomName="VIP Table" wsStatus="connected" onLeave={vi.fn()} />);

                expect(screen.getByText('VIP Table')).toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'VIP Table' })).not.toBeInTheDocument();
            } finally {
                restore();
            }
        });
    });

    it('renders brand identity, connection status, and leave button', () => {
        render(
            <RoomHeader
                brandTitle="POKER"
                roomName="VIP Table"
                playerCount={4}
                wsStatus="connected"
                onLeave={vi.fn()}
            />
        );

        expect(screen.getByText('POKER')).toBeInTheDocument();
        expect(screen.getByText('VIP Table')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /leave table/i })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: /connection status: connected/i })).not.toBeInTheDocument();
    });

    it('renders reconnecting and disconnected statuses with visible text badges', () => {
        const { rerender } = render(
            <RoomHeader
                wsStatus="reconnecting"
                onLeave={vi.fn()}
            />
        );

        expect(screen.getByRole('status', { name: /connection status: reconnecting/i })).toBeInTheDocument();
        expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();

        rerender(
            <RoomHeader
                wsStatus="disconnected"
                onLeave={vi.fn()}
            />
        );

        expect(screen.getByRole('status', { name: /connection status: disconnected/i })).toBeInTheDocument();
        expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
    });

    it('prompts confirmation when clicking leave button and invokes onLeave on confirm', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();
        // The native confirm() blocks the main thread (timers, WebSocket), so it must not be used.
        const confirmSpy = vi.spyOn(window, 'confirm');

        render(<RoomHeader wsStatus="connected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);

        const dialog = screen.getByRole('dialog', { name: /leave the table/i });
        expect(dialog).toHaveAccessibleDescription(expect.stringContaining('leave the table'));
        expect(onLeaveSpy).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole('button', { name: 'Leave' }));

        expect(onLeaveSpy).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('does not invoke onLeave when confirmation is cancelled', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();

        render(<RoomHeader wsStatus="connected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stay' }));

        expect(onLeaveSpy).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not invoke onLeave when the confirmation is dismissed with Escape', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();

        render(<RoomHeader wsStatus="connected" onLeave={onLeaveSpy} />);

        await user.click(screen.getByRole('button', { name: /leave table/i }));
        await user.keyboard('{Escape}');

        expect(onLeaveSpy).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('leave button remains interactive even when disconnected or reconnecting', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();

        render(<RoomHeader wsStatus="disconnected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        expect(leaveBtn).toBeEnabled();

        await user.click(leaveBtn);
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave' }));
        expect(onLeaveSpy).toHaveBeenCalledTimes(1);
    });

    it('applies compact shallow header styling when isCompact is true', () => {
        const { container, rerender } = render(<RoomHeader isCompact={true} />);
        const header = container.querySelector('header');
        expect(header).toHaveClass('h-11');

        rerender(<RoomHeader isCompact={false} />);
        expect(header).toHaveClass('h-14');
    });

    it('falls back to GameContext values when props are omitted', () => {
        const mockContextValue = {
            roomState: { roomName: 'Context Room', players: [{}, {}] },
            gameState: { players: [{}, {}, {}] },
            wsStatus: 'reconnecting',
            onLeave: vi.fn(),
        } as any;

        render(
            <GameContext.Provider value={mockContextValue}>
                <RoomHeader />
            </GameContext.Provider>
        );

        expect(screen.getByText('Context Room')).toBeInTheDocument();
        expect(screen.getByText('3 players')).toBeInTheDocument();
        expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    });
});
