import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LoadingView } from '../LoadingView'

describe('LoadingView', () => {
  it('renders with status role and aria-busy set to true', () => {
    render(<LoadingView status="Connecting to Game" />)
    const element = screen.getByRole('status')
    expect(element).toBeInTheDocument()
    expect(element).toHaveAttribute('aria-busy', 'true')
  })

  it('renders the status text in uppercase', () => {
    render(<LoadingView status="Restoring session" />)
    expect(screen.getByText('Restoring session')).toBeInTheDocument()
  })
})
