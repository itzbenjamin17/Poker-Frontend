import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameTableView } from '../../GameTableView';
import { PokerRoomLayout } from '../../PokerRoomLayout';
import { RoomHeader } from '../../RoomHeader';
import type { GameState, RoomState } from '../../../types';
import '@testing-library/jest-dom';

describe('Stage Layout & Viewports', () => {
    const mockRoomState: RoomState = {
        roomId: 'ROOM123',
        roomName: 'Championship Table',
        players: [
            { name: 'Alice', isHost: true },
            { name: 'Bob', isHost: false },
            { name: 'Charlie', isHost: false },
        ],
        gameStarted: true,
        maxPlayers: 6,
        buyIn: 1000,
        smallBlind: 10,
        bigBlind: 20,
    };

    const createGameState = (overrides?: Partial<GameState>): GameState => ({
        gameId: 'ROOM123',
        phase: 'PRE_FLOP',
        pot: 30,
        currentBet: 20,
        maxPlayers: 6,
        currentPlayerId: 'p-bob',
        currentPlayerName: 'Bob',
        communityCards: [],
        legalActions: ['CHECK', 'BET', 'FOLD'],
        claimWinAvailable: false,
        players: [
            {
                id: 'p-alice',
                name: 'Alice',
                chips: 1000,
                currentBet: 20,
                status: 'ACTIVE',
                hasFolded: false,
            },
            {
                id: 'p-bob',
                name: 'Bob',
                chips: 1000,
                currentBet: 10,
                status: 'ACTIVE',
                hasFolded: false,
            },
            {
                id: 'p-charlie',
                name: 'Charlie',
                chips: 1000,
                currentBet: 0,
                status: 'ACTIVE',
                hasFolded: false,
            },
        ],
        ...overrides,
    });

    const setViewport = (width: number, height: number) => {
        act(() => {
            Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
            Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
            window.dispatchEvent(new Event('resize'));
        });
    };

    let originalWidth: number;
    let originalHeight: number;

    beforeEach(() => {
        originalWidth = window.innerWidth;
        originalHeight = window.innerHeight;
    });

    afterEach(() => {
        setViewport(originalWidth, originalHeight);
    });

    it('places Claim Win button inside RoomStage at bottom-left with 8px inset above RoomDock', () => {
        const gameState = createGameState({
            claimWinAvailable: true,
            claimWinPlayerName: 'Alice',
        });

        render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameState}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        const stage = screen.getByTestId('room-stage');
        const dock = screen.getByTestId('room-dock');
        const claimContainer = screen.getByTestId('claim-win-container');
        const claimButton = screen.getByRole('button', { name: /CLAIM THE WIN/i });

        expect(claimButton).toBeInTheDocument();
        // Claim container must be inside RoomStage
        expect(stage).toContainElement(claimContainer);
        expect(dock).not.toContainElement(claimContainer);

        // Inset verification: left 8px, bottom 8px, absolute positioning
        expect(claimContainer).toHaveStyle({
            position: 'absolute',
            left: '8px',
            bottom: '8px',
        });
        expect(claimContainer.className).toContain('absolute');
        expect(claimContainer.className).toContain('left-[8px]');
        expect(claimContainer.className).toContain('bottom-[8px]');
    });

    it('renders remote reconnect banner as an absolute overlay inside RoomStage without modifying stage or dock styles', () => {
        // Disconnected opponent Charlie
        const gameStateWithDc = createGameState({
            players: [
                { id: 'p-alice', name: 'Alice', chips: 1000, currentBet: 20, status: 'ACTIVE', hasFolded: false },
                { id: 'p-bob', name: 'Bob', chips: 1000, currentBet: 10, status: 'ACTIVE', hasFolded: false },
                { id: 'p-charlie', name: 'Charlie', chips: 1000, currentBet: 0, status: 'DISCONNECTED', hasFolded: false },
            ],
        });

        const { rerender } = render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={createGameState()} // no disconnect
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        const stageBefore = screen.getByTestId('room-stage');
        const dockBefore = screen.getByTestId('room-dock');
        const stageClassBefore = stageBefore.className;
        const dockClassBefore = dockBefore.className;

        expect(screen.queryByTestId('remote-reconnect-banner')).not.toBeInTheDocument();

        // Rerender with Charlie disconnected
        rerender(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameStateWithDc}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );

        const stageAfter = screen.getByTestId('room-stage');
        const dockAfter = screen.getByTestId('room-dock');
        const banner = screen.getByTestId('remote-reconnect-banner');

        expect(banner).toBeInTheDocument();
        expect(stageAfter).toContainElement(banner);
        expect(dockAfter).not.toContainElement(banner);
        expect(banner.className).toContain('absolute');

        // Stage and dock flex flow / dimensions class names remain strictly unchanged
        expect(stageAfter.className).toBe(stageClassBefore);
        expect(dockAfter.className).toBe(dockClassBefore);
    });

    it('reconnect banner excludes hero, excludes folded players, and prefers disconnected current actor', () => {
        // Scenario A: Hero Alice is disconnected -> hero should be excluded, no banner
        const gameStateHeroDc = createGameState({
            players: [
                { id: 'p-alice', name: 'Alice', chips: 1000, currentBet: 20, status: 'DISCONNECTED', hasFolded: false },
                { id: 'p-bob', name: 'Bob', chips: 1000, currentBet: 10, status: 'ACTIVE', hasFolded: false },
            ],
        });

        const { rerender } = render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameStateHeroDc}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );
        expect(screen.queryByTestId('remote-reconnect-banner')).not.toBeInTheDocument();

        // Scenario B: Opponent Bob is disconnected but folded -> excluded, no banner
        const gameStateBobFoldedDc = createGameState({
            players: [
                { id: 'p-alice', name: 'Alice', chips: 1000, currentBet: 20, status: 'ACTIVE', hasFolded: false },
                { id: 'p-bob', name: 'Bob', chips: 1000, currentBet: 10, status: 'DISCONNECTED', hasFolded: true },
            ],
        });

        rerender(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameStateBobFoldedDc}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );
        expect(screen.queryByTestId('remote-reconnect-banner')).not.toBeInTheDocument();

        // Scenario C: Both Bob and Charlie disconnected. Bob is current actor -> prefers Bob
        const gameStateTwoDc = createGameState({
            currentPlayerId: 'p-bob',
            currentPlayerName: 'Bob',
            players: [
                { id: 'p-alice', name: 'Alice', chips: 1000, currentBet: 20, status: 'ACTIVE', hasFolded: false },
                { id: 'p-bob', name: 'Bob', chips: 1000, currentBet: 10, status: 'DISCONNECTED', hasFolded: false },
                { id: 'p-charlie', name: 'Charlie', chips: 1000, currentBet: 0, status: 'DISCONNECTED', hasFolded: false },
            ],
        });

        rerender(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameStateTwoDc}
                roomState={mockRoomState}
                nowMs={1000}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={vi.fn()}
            />
        );
        expect(screen.getByTestId('remote-reconnect-banner')).toHaveTextContent(/Bob/i);
    });

    it('renders exactly one Leave control: shell header when present, standalone when header is absent', () => {
        const gameState = createGameState();
        const onLeave = vi.fn();

        // 1. With shell header present:
        const { unmount } = render(
            <PokerRoomLayout
                header={
                    <RoomHeader
                        roomName={mockRoomState.roomName}
                        playerCount={3}
                        wsStatus="connected"
                        onLeave={onLeave}
                    />
                }
                wsStatus="connected"
                onLeave={onLeave}
            >
                <GameTableView
                    auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                    playerName="Alice"
                    myPlayerId="p-alice"
                    gameState={gameState}
                    roomState={mockRoomState}
                    nowMs={1000}
                    hasShellHeader={true}
                    onAction={vi.fn()}
                    onReady={vi.fn()}
                    onUnready={vi.fn()}
                    onClaimWin={vi.fn()}
                    onLeaveGame={onLeave}
                />
            </PokerRoomLayout>
        );

        // Dock controls must be suppressed; exactly one Leave button appears in the header
        const leaveButtonsWithHeader = screen.getAllByRole('button', { name: /leave/i });
        expect(leaveButtonsWithHeader).toHaveLength(1);
        expect(screen.getByRole('banner')).toContainElement(leaveButtonsWithHeader[0]);

        unmount();

        // 2. Standalone mode (without shell header):
        render(
            <GameTableView
                auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                playerName="Alice"
                myPlayerId="p-alice"
                gameState={gameState}
                roomState={mockRoomState}
                nowMs={1000}
                hasShellHeader={false}
                onAction={vi.fn()}
                onReady={vi.fn()}
                onUnready={vi.fn()}
                onClaimWin={vi.fn()}
                onLeaveGame={onLeave}
            />
        );

        // Standalone confirmed Leave button at top-left, dock leave controls suppressed
        const leaveButtonsStandalone = screen.getAllByRole('button', { name: /leave/i });
        expect(leaveButtonsStandalone).toHaveLength(1);
        expect(leaveButtonsStandalone[0]).toHaveTextContent('LEAVE TABLE');
    });

    describe.each([
        { width: 667, height: 375, name: '667x375 (iPhone landscape)' },
        { width: 1024, height: 600, name: '1024x600 (Tablet landscape)' },
        { width: 1440, height: 900, name: '1440x900 (Desktop)' },
    ])('viewport $name verification', ({ width, height }) => {
        it(`verifies claim does not intersect dock, reconnect leaves dimensions unchanged, and leave appears once at ${width}x${height}`, () => {
            setViewport(width, height);
            const onLeave = vi.fn();
            const gameState = createGameState({
                claimWinAvailable: true,
                claimWinPlayerName: 'Alice',
                players: [
                    { id: 'p-alice', name: 'Alice', chips: 1000, currentBet: 20, status: 'ACTIVE', hasFolded: false },
                    { id: 'p-bob', name: 'Bob', chips: 1000, currentBet: 10, status: 'DISCONNECTED', hasFolded: false },
                ],
            });

            const { container } = render(
                <PokerRoomLayout
                    header={
                        <RoomHeader
                            roomName={mockRoomState.roomName}
                            playerCount={2}
                            wsStatus="connected"
                            onLeave={onLeave}
                        />
                    }
                    wsStatus="connected"
                    onLeave={onLeave}
                >
                    <GameTableView
                        auth={{ token: 'tok', roomId: 'ROOM123', playerName: 'Alice' }}
                        playerName="Alice"
                        myPlayerId="p-alice"
                        gameState={gameState}
                        roomState={mockRoomState}
                        nowMs={1000}
                        hasShellHeader={true}
                        onAction={vi.fn()}
                        onReady={vi.fn()}
                        onUnready={vi.fn()}
                        onClaimWin={vi.fn()}
                        onLeaveGame={onLeave}
                    />
                </PokerRoomLayout>
            );

            // 1. Claim Win does not intersect RoomDock (Claim is inside RoomStage at bottom-left)
            const stage = container.querySelector('[data-testid="room-stage"]');
            const dock = container.querySelector('[data-testid="room-dock"]');
            const claim = container.querySelector('[data-testid="claim-win-container"]');
            expect(stage).toContainElement(claim);
            expect(dock).not.toContainElement(claim);

            // 2. Reconnect banner is an absolute overlay inside stage
            const banner = container.querySelector('[data-testid="remote-reconnect-banner"]');
            expect(stage).toContainElement(banner);
            expect(banner?.className).toContain('absolute');

            // 3. Exactly one Leave control
            const leaveButtons = screen.getAllByRole('button', { name: /leave/i });
            expect(leaveButtons).toHaveLength(1);
        });
    });
});
