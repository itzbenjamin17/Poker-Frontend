import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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
})
