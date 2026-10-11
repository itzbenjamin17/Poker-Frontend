import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ActionPanel } from '../ActionPanel';
import type { GameState, Player, PokerAction } from '../../types';

const mockGameState: GameState = {
    gameId: 'ROOM123',
    maxPlayers: 6,
    pot: 30,
    currentBet: 20,
    communityCards: [],
    currentPlayerId: 'p-1',
    currentPlayerName: 'TestPlayer',
    legalActions: ['FOLD', 'CALL', 'RAISE'],
    players: [],
    phase: 'PRE_FLOP',
};

const mockMe: Player = {
    id: 'p-1',
    name: 'TestPlayer',
    chips: 1000,
    currentBet: 10,
    status: 'ACTIVE',
    hasFolded: false,
};

function renderActionPanel({
    gameState = mockGameState,
    me = mockMe,
    isMyTurn = true,
    isSelfDisconnected = false,
    isReadyCountdownActive = false,
    currentTurnPlayerName = 'TestPlayer',
    isMobileLandscape = false,
    isCompactTable = false,
    raiseAmount = '',
    raiseError = null,
    onRaiseChange = vi.fn(),
    onAction = vi.fn(),
    isActionPending = false,
    bigBlind = 20,
}: Partial<Parameters<typeof ActionPanel>[0]> = {}) {
    return {
        onAction,
        onRaiseChange,
        ...render(
            <ActionPanel
                gameState={gameState}
                me={me}
                isMyTurn={isMyTurn}
                isSelfDisconnected={isSelfDisconnected}
                isReadyCountdownActive={isReadyCountdownActive}
                currentTurnPlayerName={currentTurnPlayerName}
                isMobileLandscape={isMobileLandscape}
                isCompactTable={isCompactTable}
                raiseAmount={raiseAmount}
                raiseError={raiseError}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={isActionPending}
                bigBlind={bigBlind}
            />,
        ),
    };
}

describe('ActionPanel', () => {
    it('renders fold, check, and a progressive raise button on my turn', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
            isMyTurn: true,
        });

        const dock = screen.getByRole('region', { name: /action dock/i });
        expect(dock).toHaveAttribute('data-is-active-turn', 'true');
        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /check/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^raise$/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText(/raise amount/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all in/i })).not.toBeInTheDocument();
    });

    it('renders call button instead of check when currentBet is higher', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL'] },
            me: { ...mockMe, currentBet: 10 },
        });

        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /call 10/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
    });

    it('shows ALL IN only when supplied by the legal action contract', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 200, legalActions: ['FOLD', 'ALL_IN'] },
            me: { ...mockMe, chips: 50, currentBet: 10 },
        });

        expect(screen.getByRole('button', { name: /all in 50/i })).toBeInTheDocument();
    });

    it('progressively reveals valid amount controls for raise, replacing normal row, and restores on cancel', async () => {
        const user = userEvent.setup();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
        });

        // Initially in normal betting state
        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /call 10/i })).toBeInTheDocument();
        expect(screen.queryByLabelText(/raise amount/i)).not.toBeInTheDocument();

        // Clicking Raise enters raise state and replaces normal row completely
        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        expect(screen.getByLabelText(/raise amount/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^raise$/i })).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument();

        // Clicking Cancel returns to normal state
        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /call 10/i })).toBeInTheDocument();
        expect(screen.queryByLabelText(/raise amount/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });

    it('clicking preset buttons updates raise amount via onRaiseChange', async () => {
        const user = userEvent.setup();
        const onRaiseChange = vi.fn();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, pot: 100, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, chips: 1000, currentBet: 10 },
            onRaiseChange,
            bigBlind: 20,
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        await user.click(screen.getByRole('button', { name: /^3bb$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('60');

        await user.click(screen.getByRole('button', { name: /^1\/2 pot$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('50');

        await user.click(screen.getByRole('button', { name: /^pot$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('100');

        await user.click(screen.getByRole('button', { name: /^max$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('1000');
    });

    it('displays error messages after amount controls are revealed', async () => {
        const user = userEvent.setup();
        const { rerender } = renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, chips: 100, currentBet: 10 },
            raiseAmount: '150',
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByText(/You only have 100/i)).toBeInTheDocument();

        rerender(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] }}
                me={{ ...mockMe, chips: 100, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="5"
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={vi.fn()}
                isActionPending={false}
                bigBlind={10}
            />,
        );
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByText(/Minimum raise is 11/i)).toBeInTheDocument();
    });

    it('triggers onAction callback correctly when clicked', async () => {
        const handleAction = vi.fn<(action: PokerAction, amount?: number) => void>();
        const user = userEvent.setup();

        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK'] },
            me: { ...mockMe, currentBet: 10 },
            onAction: handleAction,
        });

        await user.click(screen.getByRole('button', { name: /fold/i }));
        expect(handleAction).toHaveBeenCalledWith('FOLD');

        await user.click(screen.getByRole('button', { name: /check/i }));
        expect(handleAction).toHaveBeenCalledWith('CHECK');
    });

    it('keeps a quiet waiting dock visible when another player acts', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentPlayerId: 'p-2', currentPlayerName: 'Opponent' },
            isMyTurn: false,
            currentTurnPlayerName: 'Opponent',
        });

        expect(screen.getByRole('region', { name: /action dock/i })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/waiting for opponent to act/i);
        expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();
    });

    it('only renders actions included in the legal action contract', () => {
        renderActionPanel({
            gameState: { ...mockGameState, legalActions: ['FOLD', 'CALL'] },
            me: { ...mockMe, currentBet: 10 },
        });

        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /call 10/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /raise/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all in/i })).not.toBeInTheDocument();
    });

    it('does not replace supplied legal actions with client-derived alternatives', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['CHECK', 'BET'] },
            me: { ...mockMe, currentBet: 10 },
        });

        expect(screen.getByRole('button', { name: /check/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^bet$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /raise/i })).not.toBeInTheDocument();
    });

    it('does not render action buttons when phase is SHOWDOWN even if it is my turn with legal actions', () => {
        renderActionPanel({
            gameState: { ...mockGameState, phase: 'SHOWDOWN', legalActions: ['FOLD', 'CHECK', 'CALL'] },
            me: { ...mockMe, currentBet: 10 },
            isMyTurn: true,
        });

        expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument();
    });

    it('keeps the raise drawer open on submit until turn resolution and surfaces server raiseError', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        const onRaiseChange = vi.fn();
        const gameState: GameState = { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] };
        const me: Player = { ...mockMe, chips: 1000, currentBet: 10 };

        const { rerender } = render(
            <ActionPanel
                gameState={gameState}
                me={me}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="50"
                raiseError={null}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={20}
            />,
        );

        // Open the raise drawer
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByLabelText(/raise amount/i)).toBeInTheDocument();

        // Submit the raise
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(onAction).toHaveBeenCalledWith('RAISE', 50);

        // Drawer remains open after submit
        expect(screen.getByLabelText(/raise amount/i)).toBeInTheDocument();

        // Server rejects the raise and passes raiseError
        rerender(
            <ActionPanel
                gameState={gameState}
                me={me}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="50"
                raiseError="Raise amount is below table minimum"
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={20}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Raise amount is below table minimum');
        expect(screen.getByRole('button', { name: /^raise$/i })).toBeDisabled();

        // Adjusting the amount calls onRaiseChange (which clears raiseError in parent) and re-enables submission
        await user.click(screen.getByRole('button', { name: '3BB' }));
        expect(onRaiseChange).toHaveBeenCalledWith('60');

        rerender(
            <ActionPanel
                gameState={gameState}
                me={me}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="120"
                raiseError={null}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={20}
            />,
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^raise$/i })).not.toBeDisabled();
    });

    it('clamps short-stack presets to availableChips when availableChips < minRaiseAmount and submits without validation error', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        const onRaiseChange = vi.fn();
        // bigBlind = 40 -> minRaiseAmount = 40, but player only has 30 chips
        const shortGameState: GameState = {
            ...mockGameState,
            currentBet: 20,
            pot: 100,
            legalActions: ['FOLD', 'CALL', 'RAISE'],
        };
        const shortMe: Player = {
            ...mockMe,
            chips: 30,
            currentBet: 10,
        };

        const { rerender } = render(
            <ActionPanel
                gameState={shortGameState}
                me={shortMe}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={40}
            />,
        );

        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        // Clicking 3BB, POT, or MAX should clamp to availableChips ('30'), not minRaiseAmount ('40')
        await user.click(screen.getByRole('button', { name: /^3bb$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('30');

        await user.click(screen.getByRole('button', { name: /^max$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('30');

        rerender(
            <ActionPanel
                gameState={shortGameState}
                me={shortMe}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="30"
                raiseError={null}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={40}
            />,
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        const submitBtn = screen.getByRole('button', { name: /^raise$/i });
        expect(submitBtn).not.toBeDisabled();
        await user.click(submitBtn);
        expect(onAction).toHaveBeenCalledWith('RAISE', 30);
    });
});
