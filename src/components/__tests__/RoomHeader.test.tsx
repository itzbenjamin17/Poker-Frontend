import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RoomHeader } from '../RoomHeader';
import { GameContext } from '../../context/GameContext';
import '@testing-library/jest-dom';

describe('RoomHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<RoomHeader wsStatus="connected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('leave the table'));
        expect(onLeaveSpy).toHaveBeenCalledTimes(1);
    });

    it('does not invoke onLeave when confirmation is cancelled', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        render(<RoomHeader wsStatus="connected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);

        expect(onLeaveSpy).not.toHaveBeenCalled();
    });

    it('leave button remains interactive even when disconnected or reconnecting', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<RoomHeader wsStatus="disconnected" onLeave={onLeaveSpy} />);

        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        expect(leaveBtn).toBeEnabled();

        await user.click(leaveBtn);
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
