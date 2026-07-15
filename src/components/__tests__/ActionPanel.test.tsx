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
            />,
        ),
    };
}

describe('ActionPanel', () => {
    it('renders fold, check, and a progressive raise button on my turn', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
        });

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
        expect(screen.getByRole('button', { name: /call \$10/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
    });

    it('shows ALL IN only when supplied by the legal action contract', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 200, legalActions: ['FOLD', 'ALL_IN'] },
            me: { ...mockMe, chips: 50, currentBet: 10 },
        });

        expect(screen.getByRole('button', { name: /all in \$50/i })).toBeInTheDocument();
    });

    it('progressively reveals valid amount controls for raise', async () => {
        const user = userEvent.setup();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
        });

        expect(screen.queryByLabelText(/raise amount/i)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        expect(screen.getByLabelText(/raise amount/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^raise$/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('displays error messages after amount controls are revealed', async () => {
        const user = userEvent.setup();
        const { rerender } = renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, chips: 100, currentBet: 10 },
            raiseAmount: '150',
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByText(/You only have 100 chips/i)).toBeInTheDocument();

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
        expect(screen.getByText(/Minimum raise is 11 chips/i)).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /call \$10/i })).toBeInTheDocument();
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
});
