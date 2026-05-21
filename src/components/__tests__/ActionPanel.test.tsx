import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ActionPanel } from '../ActionPanel'
import type { GameState, Player } from '../../types'

const mockGameState: GameState = {
    gameId: 'ROOM123',
    phase: 'PRE_FLOP',
    pot: 30,
    currentBet: 20,
    communityCards: [],
    currentPlayerId: 'p-1',
    players: [],
}

const mockMe: Player = {
    id: 'p-1',
    name: 'TestPlayer',
    chips: 1000,
    currentBet: 10,
    status: 'ACTIVE',
}

describe('ActionPanel', () => {
    it('renders fold, check, raise buttons on my turn', () => {
        const handleAction = vi.fn()
        const handleRaiseChange = vi.fn()

        render(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 10 }}
                me={{ ...mockMe, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                onRaiseChange={handleRaiseChange}
                onAction={handleAction}
            />
        )

        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /check/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /raise/i })).toBeInTheDocument()
    })

    it('renders call button instead of check when currentBet is higher', () => {
        const handleAction = vi.fn()
        render(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 20 }}
                me={{ ...mockMe, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={handleAction}
            />
        )

        expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /call \$10/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument()
    })

    it('shows ALL IN button if call amount exceeds available chips', () => {
        render(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 200 }}
                me={{ ...mockMe, chips: 50, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: /all in \$50/i })).toBeInTheDocument()
    })

    it('displays error messages for invalid raise inputs', () => {
        // 1. More than stack
        const { rerender } = render(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 20 }}
                me={{ ...mockMe, chips: 100, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="150"
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={vi.fn()}
            />
        )
        expect(screen.getByText(/You only have 100 chips/i)).toBeInTheDocument()

        // 2. Less than min raise
        rerender(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 20 }}
                me={{ ...mockMe, chips: 100, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount="5" // min raise: currentBet (20) - me.currentBet (10) + 1 = 11
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={vi.fn()}
            />
        )
        expect(screen.getByText(/Minimum raise is 11 chips/i)).toBeInTheDocument()
    })

    it('triggers onAction callback correctly when clicked', async () => {
        const handleAction = vi.fn()
        const user = userEvent.setup()

        render(
            <ActionPanel
                gameState={{ ...mockGameState, currentBet: 10 }}
                me={{ ...mockMe, currentBet: 10 }}
                isMyTurn={true}
                isSelfDisconnected={false}
                isReadyCountdownActive={false}
                isMobileLandscape={false}
                isCompactTable={false}
                raiseAmount=""
                raiseError={null}
                onRaiseChange={vi.fn()}
                onAction={handleAction}
            />
        )

        await user.click(screen.getByRole('button', { name: /fold/i }))
        expect(handleAction).toHaveBeenCalledWith('FOLD')

        await user.click(screen.getByRole('button', { name: /check/i }))
        expect(handleAction).toHaveBeenCalledWith('CHECK')
    })
})
