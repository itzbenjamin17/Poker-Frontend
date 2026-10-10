import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    PokerRoomLayout,
    RoomStage,
    RoomDock,
} from '../PokerRoomLayout';
import { RoomHeader } from '../RoomHeader';
import '@testing-library/jest-dom';

describe('PokerRoomLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default to landscape desktop
        window.innerWidth = 1024;
        window.innerHeight = 768;
    });

    it('renders three-region layout geometry with header, stage, and dock', () => {
        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
                dock={<RoomDock><div>Action Dock Content</div></RoomDock>}
            />
        );

        // Root container renders full layout
        expect(screen.getByTestId('poker-room-layout')).toBeInTheDocument();

        // Check header, stage, and dock regions
        expect(screen.getByRole('banner')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /room stage/i })).toBeInTheDocument();
        expect(screen.getByText('Table Content')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /room dock/i })).toBeInTheDocument();
        expect(screen.getByText('Action Dock Content')).toBeInTheDocument();
    });

    it('renders children directly when stage/dock props are not explicitly provided', () => {
        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
            >
                <div data-testid="custom-children">Custom Layout Content</div>
            </PokerRoomLayout>
        );

        expect(screen.getByTestId('custom-children')).toBeInTheDocument();
    });

    it('gates portrait mode below supported breakpoint and renders only RotatePrompt', () => {
        // Set dimensions to mobile portrait
        window.innerWidth = 390;
        window.innerHeight = 844;

        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
                dock={<RoomDock><div>Action Dock Content</div></RoomDock>}
            />
        );

        // Should render ONLY RotatePrompt
        expect(screen.getByTestId('rotate-prompt')).toBeInTheDocument();
        expect(screen.getByText(/landscape mode required/i)).toBeInTheDocument();

        // Stage, Dock, and Header must NOT be rendered
        expect(screen.queryByRole('banner')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /room stage/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /room dock/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Table Content')).not.toBeInTheDocument();
    });

    it('updates orientation gating dynamically when window resize event is dispatched', () => {
        // Start in mobile portrait
        window.innerWidth = 390;
        window.innerHeight = 844;

        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
                dock={<RoomDock><div>Action Dock Content</div></RoomDock>}
            />
        );

        expect(screen.getByTestId('rotate-prompt')).toBeInTheDocument();

        // Rotate device to landscape
        act(() => {
            window.innerWidth = 844;
            window.innerHeight = 390;
            window.dispatchEvent(new Event('resize'));
        });

        // Rotate prompt disappears and layout appears
        expect(screen.queryByTestId('rotate-prompt')).not.toBeInTheDocument();
        expect(screen.getByText('Table Content')).toBeInTheDocument();
    });

    it('does not gate portrait if width is above supported breakpoint', () => {
        // Large vertical monitor (portrait, but >= 1024)
        window.innerWidth = 1200;
        window.innerHeight = 1600;

        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
            />
        );

        expect(screen.queryByTestId('rotate-prompt')).not.toBeInTheDocument();
        expect(screen.getByText('Table Content')).toBeInTheDocument();
    });

    it('gates sub-667x375 mobile landscape viewports (e.g. 650x300) and allows 667x375+', () => {
        window.innerWidth = 650;
        window.innerHeight = 300;

        render(
            <PokerRoomLayout
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
            />
        );

        expect(screen.getByTestId('rotate-prompt')).toBeInTheDocument();
        expect(screen.queryByText('Table Content')).not.toBeInTheDocument();

        act(() => {
            window.innerWidth = 667;
            window.innerHeight = 375;
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.queryByTestId('rotate-prompt')).not.toBeInTheDocument();
        expect(screen.getByText('Table Content')).toBeInTheDocument();
    });

    it('renders reconnect overlay when wsStatus is disconnected while keeping header leave action interactive', async () => {
        const user = userEvent.setup();
        const onLeaveSpy = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(
            <PokerRoomLayout
                wsStatus="disconnected"
                header={<RoomHeader brandTitle="POKER" wsStatus="disconnected" onLeave={onLeaveSpy} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
            />
        );

        // Connection lost alert is visible
        const alertEl = screen.getAllByRole('status').find(el => el.textContent?.includes('Connection lost'));
        expect(alertEl).toBeInTheDocument();
        expect(alertEl).toHaveTextContent(/connection lost/i);
        expect(alertEl).toHaveTextContent(/reconnecting/i);

        // Header leave action is interactive even with overlay active
        const leaveBtn = screen.getByRole('button', { name: /leave table/i });
        await user.click(leaveBtn);
        expect(onLeaveSpy).toHaveBeenCalledTimes(1);
    });

    it('does not render reconnect overlay when wsStatus is connected', () => {
        render(
            <PokerRoomLayout
                wsStatus="connected"
                header={<RoomHeader brandTitle="POKER" wsStatus="connected" onLeave={vi.fn()} />}
                stage={<RoomStage><div>Table Content</div></RoomStage>}
            />
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
