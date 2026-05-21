import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Button, Input } from '../UI'

describe('Button component', () => {
  it('renders children correctly', () => {
    render(<Button>Click Me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={handleClick}>Click Me</Button>)

    await user.click(screen.getByRole('button', { name: /click me/i }))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when the disabled prop is passed', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('Input component', () => {
  it('renders label and input correctly', () => {
    render(<Input label="Username" placeholder="Enter username" />)
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/enter username/i)).toBeInTheDocument()
  })

  it('shows an error state semantically', () => {
    render(<Input label="Email" error="Invalid email" />)

    const input = screen.getByLabelText(/email/i)
    const errorMsg = screen.getByRole('alert')

    // Test behavior/accessibility, not specific CSS classes
    expect(input).toBeInvalid()
    expect(errorMsg).toHaveTextContent(/invalid email/i)
  })

  it('handles typing correctly', async () => {
    const handleChange = vi.fn()
    const user = userEvent.setup()
    render(<Input label="Name" onChange={handleChange} />)
    const input = screen.getByLabelText(/name/i)

    await user.type(input, 'John')
    expect(handleChange).toHaveBeenCalled()
  })
})