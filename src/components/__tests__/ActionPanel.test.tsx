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

function renderActionPanel(props: Partial<Parameters<typeof ActionPanel>[0]> = {}) {
    const onAction = props.onAction ?? vi.fn();
    const onRaiseChange = props.onRaiseChange ?? vi.fn();
    return {
        onAction,
        onRaiseChange,
        ...render(
            <ActionPanel
                gameState={mockGameState}
                me={mockMe}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                actionError={null}
                onRaiseChange={onRaiseChange}
                onAction={onAction}
                isActionPending={false}
                bigBlind={20}
                {...props}
            />,
        ),
    };
}

describe('ActionPanel', () => {
    it('uses the server full incremental raise minimum as its default', async () => {
        const user = userEvent.setup();
        renderActionPanel({
            gameState: { ...mockGameState, minimumRaiseAmount: 60 },
        });
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByRole('slider', { name: /raise amount/i })).toHaveValue('60');
        expect(screen.getByText('60')).toBeInTheDocument();
    });
    it('announces the raise slider value in the same formatted chips it shows', async () => {
        const user = userEvent.setup();
        renderActionPanel({
            gameState: { ...mockGameState, minimumRaiseAmount: 1500 },
            me: { ...mockMe, chips: 5000 },
        });
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByRole('slider', { name: /raise amount/i })).toHaveAttribute('aria-valuetext', '1,500 chips');
    });
    it('submits the backend minimum in incremental chips after the call amount', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, minimumRaiseAmount: 60 },
            me: { ...mockMe, currentBet: 10 },
            onAction,
        });
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(onAction).toHaveBeenCalledWith('RAISE', 60);
    });

    it('suppresses controls for empty authoritative actions or auto-advance despite a stale actor id', () => {
        const staleActor = { ...mockGameState, currentPlayerId: 'p-1', legalActions: [] };
        const { rerender } = renderActionPanel({ gameState: staleActor });
        const actionButtons = () => ['fold', 'check', 'call', 'raise', 'bet', 'all in']
            .flatMap((name) => screen.queryAllByRole('button', { name: new RegExp(name, 'i') }));
        expect(actionButtons()).toHaveLength(0);

        rerender(<ActionPanel
            gameState={{ ...mockGameState, isAutoAdvancing: true }}
            me={mockMe} isMyTurn isSelfDisconnected={false} isReadyCountdownActive={false}
            isMobileLandscape={false} isCompactTable={false} raiseError={null} onAction={vi.fn()}
            isActionPending={false}
        />);
        expect(actionButtons()).toHaveLength(0);
    });

    it('keeps a short whole-stack call available below the server full minimum', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 100, minimumRaiseAmount: 150,
                legalActions: ['FOLD', 'CALL', 'ALL_IN'] },
            me: { ...mockMe, chips: 80, currentBet: 20 },
            onAction,
        });
        expect(screen.queryByRole('button', { name: /^raise$/i })).not.toBeInTheDocument();
        const allIn = screen.getByRole('button', { name: /all in 80/i });
        expect(allIn).toBeInTheDocument();
        await user.click(allIn);
        expect(onAction).toHaveBeenCalledWith('ALL_IN');
    });
    it('keeps an unfamiliar check error in the Action Panel with its supplied wording', () => {
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK'] },
            actionError: { type: 'ACTION_ERROR', code: 'FUTURE_RULE', action: 'CHECK', message: 'A new rule applies' },
        });
        expect(screen.getByRole('region', { name: 'Action dock' })).toHaveTextContent('A new rule applies');
        expect(screen.getByRole('alert')).toHaveTextContent('A new rule applies');
    });

    it('shows a rejected action while the Hero is waiting', () => {
        renderActionPanel({
            isMyTurn: false,
            actionError: { type: 'ACTION_ERROR', code: 'NOT_YOUR_TURN', action: 'FOLD', message: 'Wait for your turn' },
        });
        expect(screen.getByRole('region', { name: 'Action dock' })).toHaveTextContent('Wait for your turn');
        expect(screen.getByRole('alert')).toHaveTextContent('Wait for your turn');
    });

    it('reveals the rejected raise control using its action and clears feedback on amount change', async () => {
        const onClearRaiseError = vi.fn();
        render(<ActionPanel
            gameState={mockGameState} me={mockMe} isMyTurn isSelfDisconnected={false}
            isReadyCountdownActive={false} isMobileLandscape={false} isCompactTable={false}
            raiseError={null} actionError={{ type: 'ACTION_ERROR', code: 'UNKNOWN', action: 'RAISE', message: 'Use a different total' }}
            onClearRaiseError={onClearRaiseError} onAction={vi.fn()} isActionPending={false}
        />);
        expect(screen.getByRole('alert')).toHaveTextContent('Use a different total');
        expect(screen.getByLabelText(/raise amount/i)).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: 'MAX' }));
        expect(onClearRaiseError).toHaveBeenCalled();
    });

    it('keeps turn action buttons usable after a transient server error', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
            isMyTurn: true,
            actionError: { type: 'ACTION_ERROR', code: 'SERVER_UNAVAILABLE', action: 'CHECK', message: 'Server unavailable' },
            onAction,
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
        const foldBtn = screen.getByRole('button', { name: /fold/i });
        const checkBtn = screen.getByRole('button', { name: /check/i });
        const raiseBtn = screen.getByRole('button', { name: /^raise$/i });

        expect(foldBtn).toBeEnabled();
        expect(checkBtn).toBeEnabled();
        expect(raiseBtn).toBeEnabled();

        await user.click(foldBtn);
        expect(onAction).toHaveBeenCalledWith('FOLD');
    });

    it('keeps ready controls usable after a transient server error', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();
        renderActionPanel({
            isMyTurn: false,
            isReadyCountdownActive: true,
            readyCountdownSecondsRemaining: 5,
            readyCount: 1,
            readyEligibleCount: 2,
            readyEligiblePlayers: [mockMe, { ...mockMe, id: 'player-2', name: 'Bob' }],
            isReadyEligible: true,
            amReadyForNextHand: false,
            actionError: { type: 'ACTION_ERROR', code: 'SERVER_UNAVAILABLE', action: 'READY', message: 'Server unavailable' },
            onReady,
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
        const readyBtn = screen.getByRole('button', { name: /^ready$/i });
        expect(readyBtn).toBeEnabled();

        await user.click(readyBtn);
        expect(onReady).toHaveBeenCalled();
    });

    it('keeps raise controls usable when raise is rejected with a transient server error', () => {
        render(<ActionPanel
            gameState={{ ...mockGameState, currentBet: 10, legalActions: ['FOLD', 'CHECK', 'RAISE'] }}
            me={{ ...mockMe, currentBet: 10 }}
            isMyTurn
            isSelfDisconnected={false}
            isReadyCountdownActive={false}
            isMobileLandscape={false}
            isCompactTable={false}
            raiseError={null}
            actionError={{ type: 'ACTION_ERROR', code: 'SERVER_UNAVAILABLE', action: 'RAISE', message: 'Server unavailable' }}
            onAction={vi.fn()}
            isActionPending={false}
        />);

        expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
        expect(screen.getByLabelText(/raise amount/i)).toBeEnabled();
        expect(screen.getByRole('button', { name: '3BB' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'MAX' })).toBeEnabled();
    });

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

        // Each preset names the total wager; the amount sent is what the hero adds to the 10 already in.
        await user.click(screen.getByRole('button', { name: /^3bb$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('50'); // raise to 60 = 3 big blinds

        await user.click(screen.getByRole('button', { name: /^1\/2 pot$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('65'); // raise to 20 + (100 + 10 call) / 2 = 75

        await user.click(screen.getByRole('button', { name: /^pot$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('120'); // raise to 20 + (100 + 10 call) = 130

        await user.click(screen.getByRole('button', { name: /^max$/i }));
        expect(onRaiseChange).toHaveBeenCalledWith('1000');
    });

    it('sizes pre-flop raise presets from the small blind as raises to 3 big blinds and to a pot-sized total', async () => {
        const user = userEvent.setup();
        const onRaiseChange = vi.fn();
        // Blinds 10/20: the small blind faces a 10 call into a 30 pot.
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, pot: 30, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, chips: 990, currentBet: 10 },
            onRaiseChange,
            bigBlind: 20,
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        await user.click(screen.getByRole('button', { name: /^3bb$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('50'); // raise to 60
        await user.click(screen.getByRole('button', { name: /^1\/2 pot$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('30'); // raise to 40
        await user.click(screen.getByRole('button', { name: /^pot$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('50'); // raise to 60: 20 + (30 pot + 10 call)
    });

    it('keeps post-flop bet presets as fractions of the pot', async () => {
        const user = userEvent.setup();
        const onRaiseChange = vi.fn();
        renderActionPanel({
            gameState: { ...mockGameState, phase: 'FLOP', currentBet: 0, pot: 100, legalActions: ['CHECK', 'BET'] },
            me: { ...mockMe, chips: 1000, currentBet: 0 },
            onRaiseChange,
            bigBlind: 20,
        });

        await user.click(screen.getByRole('button', { name: /^bet$/i }));

        await user.click(screen.getByRole('button', { name: /^3bb$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('60');
        await user.click(screen.getByRole('button', { name: /^1\/2 pot$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('50');
        await user.click(screen.getByRole('button', { name: /^pot$/i }));
        expect(onRaiseChange).toHaveBeenLastCalledWith('100');
    });

    it('uses a minimum raise amount of 30 for a 20 blind, 20 table bet, and 10 committed chips', async () => {
        const user = userEvent.setup();
        renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, currentBet: 10 },
            bigBlind: 20,
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));

        expect(screen.getByLabelText(/raise amount/i)).toHaveValue('30');
    });

    it('displays error messages after amount controls are revealed', async () => {
        const user = userEvent.setup();
        const { rerender } = renderActionPanel({
            gameState: { ...mockGameState, currentBet: 20, legalActions: ['FOLD', 'CALL', 'RAISE'] },
            me: { ...mockMe, chips: 100, currentBet: 10 },
            raiseAmount: '150',
        });

        await user.click(screen.getByRole('button', { name: /^raise$/i }));
        expect(screen.getByRole('alert')).toHaveTextContent('You only have 100.');

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
        expect(screen.getByRole('alert')).toHaveTextContent('Minimum raise is 20.');
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
        expect(onRaiseChange).toHaveBeenCalledWith('50');

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

    it('does not show turn warning when more than 10 seconds remain', () => {
        renderActionPanel({ turnSecondsRemaining: 25 });
        expect(screen.queryByTestId('turn-warning')).not.toBeInTheDocument();
        const dock = screen.getByRole('region', { name: 'Action dock' });
        expect(dock.className).not.toContain('border-amber-400');
    });

    it('shows accessible turn warning and dock emphasis at 10 seconds or less', () => {
        const { rerender } = renderActionPanel({ turnSecondsRemaining: 10 });

        const warning = screen.getByTestId('turn-warning');
        expect(warning).toBeInTheDocument();
        expect(warning).toHaveTextContent(/10s left/i);

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('aria-live', 'polite');
        expect(alert).toHaveTextContent(/10 seconds or less remaining/i);

        const dock = screen.getByRole('region', { name: 'Action dock' });
        expect(dock.className).toContain('border-amber-400');

        // Verify at 5s remaining
        rerender(
            <ActionPanel
                gameState={mockGameState}
                me={mockMe}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                currentTurnPlayerName="TestPlayer"
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                actionError={null}
                onAction={vi.fn()}
                isActionPending={false}
                turnSecondsRemaining={5}
            />,
        );
        expect(screen.getByTestId('turn-warning')).toHaveTextContent(/5s left/i);
    });

    describe('corner-chrome layout (B1-A)', () => {
        it('renders compact turn controls in the bottom-right corner without duplicating the street label', () => {
            renderActionPanel({ layout: 'corner' });

            expect(screen.queryByTestId('dock-phase')).not.toBeInTheDocument();
            expect(screen.getByTestId('corner-dock')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^fold$/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^call 10$/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^raise$/i })).toBeInTheDocument();
        });

        it('splits presets to bottom-left and full-width slider + submit to bottom-right when raising', async () => {
            const user = userEvent.setup();
            const { onAction } = renderActionPanel({ layout: 'corner' });

            await user.click(screen.getByRole('button', { name: /^raise$/i }));
            expect(screen.getByTestId('corner-raise-presets')).toBeInTheDocument();
            expect(screen.getByTestId('corner-raise-controls')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'POT' }));
            await user.click(screen.getByRole('button', { name: /^raise /i }));

            expect(onAction).toHaveBeenCalledWith('RAISE', expect.any(Number));
        });

        it('closes the corner raise picker on Escape and returns focus to Raise', async () => {
            const user = userEvent.setup();
            renderActionPanel({ layout: 'corner' });

            await user.click(screen.getByRole('button', { name: /^raise$/i }));
            expect(screen.getByTestId('corner-raise-controls')).toBeInTheDocument();

            await user.keyboard('{Escape}');
            expect(screen.queryByTestId('corner-raise-controls')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^raise$/i })).toHaveFocus();
        });

        it('wraps a rejection message cleanly in the corner dock instead of clipping to one line', () => {
            const message = "You can't check: there's 20 to call. Call, raise or fold.";
            renderActionPanel({
                layout: 'corner',
                actionError: { type: 'ACTION_ERROR', code: 'CHECK_NOT_AVAILABLE', action: 'CHECK', message },
            });

            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent(message);
            expect(alert).not.toHaveClass('whitespace-nowrap');
            expect(alert).toHaveClass('line-clamp-3');
            expect(alert).toHaveAttribute('title', message);
        });

        it('highlights urgent turns with an inset amber ring in the corner dock', () => {
            renderActionPanel({ layout: 'corner', turnSecondsRemaining: 5 });

            const dock = screen.getByTestId('corner-dock');
            expect(dock).toHaveClass('ring-2', 'ring-inset', 'ring-amber-400/80');
            expect(dock).not.toHaveClass('border-amber-400/80');
        });
    });

    describe('street label and contrast (F7-3)', () => {
        const phases = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'] as const;

        it('shows a high-contrast street label on the left of the action dock across all phases', () => {
            for (const phase of phases) {
                const { unmount } = renderActionPanel({
                    layout: 'dock',
                    gameState: { ...mockGameState, phase },
                });

                const dock = screen.getByRole('region', { name: 'Action dock' });
                const label = screen.getByTestId('dock-phase');
                expect(dock.firstElementChild).toBe(label);
                expect(label).toHaveTextContent(phase.replace(/_/g, ' '));
                expect(label).toHaveClass('bg-black/50', 'border-white/10', 'text-zinc-200', 'font-bold');
                expect(label).not.toHaveClass('text-emerald-primary/60');
                unmount();
            }
        });
    });

    it('omits duplicate Call button when server sends both CALL and ALL_IN for short or exact stacks', () => {
        renderActionPanel({
            gameState: {
                ...mockGameState,
                currentBet: 1010,
                pot: 1030,
                legalActions: ['FOLD', 'CALL', 'ALL_IN'],
            },
            me: { ...mockMe, chips: 970, currentBet: 20 },
        });

        expect(screen.getByRole('button', { name: /^fold$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^all in 970$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^call\b/i })).not.toBeInTheDocument();
    });
});
