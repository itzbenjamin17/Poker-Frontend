import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NotificationBanner } from '../NotificationBanner'

describe('NotificationBanner', () => {
    it('renders nothing when notification is null', () => {
        const { container } = render(<NotificationBanner notification={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders notification text and accessibility attributes when present', () => {
        render(<NotificationBanner notification="Dealer buttons updated!" />)
        
        const banner = screen.getByRole('alert')
        expect(banner).toBeInTheDocument()
        expect(banner).toHaveAttribute('aria-live', 'assertive')
        expect(screen.getByText('Dealer buttons updated!')).toBeInTheDocument()
    })

    it('immediately removes the alert from the DOM when rerendered with null', () => {
        const { rerender } = render(<NotificationBanner notification="Temporary alert" />)
        expect(screen.getByRole('alert')).toBeInTheDocument()

        rerender(<NotificationBanner notification={null} />)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('offers a Close button that dismisses the notification', async () => {
        const user = userEvent.setup()
        const onDismiss = vi.fn()
        render(<NotificationBanner notification="Claim failed" onDismiss={onDismiss} />)

        await user.click(screen.getByRole('button', { name: /close notification/i }))
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('keeps the Close button out of the announced alert text', () => {
        render(<NotificationBanner notification="Claim failed" onDismiss={vi.fn()} />)

        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('Claim failed')
        expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    })

    it('holds auto-dismiss while hovered and releases it when the pointer leaves', async () => {
        const user = userEvent.setup()
        const onHold = vi.fn()
        const onRelease = vi.fn()
        render(<NotificationBanner notification="Claim failed" onDismiss={vi.fn()} onHold={onHold} onRelease={onRelease} />)

        await user.hover(screen.getByRole('alert'))
        expect(onHold).toHaveBeenCalledTimes(1)
        await user.unhover(screen.getByRole('alert'))
        expect(onRelease).toHaveBeenCalledTimes(1)
    })

    it('holds auto-dismiss while its Close button has keyboard focus', async () => {
        const user = userEvent.setup()
        const onHold = vi.fn()
        const onRelease = vi.fn()
        render(
            <>
                <NotificationBanner notification="Claim failed" onDismiss={vi.fn()} onHold={onHold} onRelease={onRelease} />
                <button type="button">Elsewhere</button>
            </>
        )

        await user.tab()
        expect(screen.getByRole('button', { name: /close notification/i })).toHaveFocus()
        expect(onHold).toHaveBeenCalledTimes(1)

        await user.tab()
        expect(onRelease).toHaveBeenCalledTimes(1)
    })
})
