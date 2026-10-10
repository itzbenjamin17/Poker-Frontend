import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Lobby from '../Lobby'
import { server } from '../test/mocks/server'
import { http, HttpResponse } from 'msw'

describe('Lobby Integration', () => {
  it('allows a user to join a room successfully', async () => {
    const handleAuth = vi.fn()
    const user = userEvent.setup()
    
    render(<Lobby onAuth={handleAuth} />)

    // Scope to "Quick Join" region for robust selectors
    const quickJoinRegion = screen.getByRole('region', { name: /quick join/i })
    const { getByLabelText, getByRole } = within(quickJoinRegion)

    const joinRoomInput = getByLabelText(/room name/i)
    const joinPlayerInput = getByLabelText(/player alias/i)

    fireEvent.change(joinRoomInput, { target: { value: 'POKER123' } })
    fireEvent.change(joinPlayerInput, { target: { value: 'TestPlayer' } })

    const joinButton = getByRole('button', { name: /join game/i })
    await user.click(joinButton)

    // Wait for the onAuth callback to be called (mocked in handlers.ts)
    await waitFor(() => {
      expect(handleAuth).toHaveBeenCalledWith(expect.objectContaining({
        playerName: 'TestPlayer',
        roomId: 'POKER123'
      }))
    })
  })

  it('shows an error message when joining fails', async () => {
    // Override handler for this specific test
    server.use(
      http.post('/api/room/join', () => {
        return HttpResponse.json(
          { message: 'Invalid room name.' },
          { status: 404 }
        )
      })
    )

    const user = userEvent.setup()
    render(<Lobby onAuth={() => {}} />)

    const quickJoinRegion = screen.getByRole('region', { name: /quick join/i })
    const { getByLabelText, getByRole } = within(quickJoinRegion)

    const joinRoomInput = getByLabelText(/room name/i)
    const joinPlayerInput = getByLabelText(/player alias/i)

    fireEvent.change(joinRoomInput, { target: { value: 'NONEXISTENT' } })
    fireEvent.change(joinPlayerInput, { target: { value: 'TestPlayer' } })

    await user.click(getByRole('button', { name: /join game/i }))

    // Error message from the mock should appear
    await waitFor(() => {
      expect(screen.getByText(/Invalid room name/i)).toBeInTheDocument()
    })
  })

  it('allows a user to create a room successfully', async () => {
    const handleAuth = vi.fn()
    const user = userEvent.setup()
    
    render(<Lobby onAuth={handleAuth} />)

    const createRegion = screen.getByRole('region', { name: /create table/i })
    const { getByLabelText, getByRole } = within(createRegion)

    fireEvent.change(getByLabelText(/room name/i), { target: { value: 'NEWROOM' } })
    fireEvent.change(getByLabelText(/player alias/i), { target: { value: 'HostPlayer' } })
    fireEvent.change(getByLabelText(/small blind/i), { target: { value: '10' } })
    fireEvent.change(getByLabelText(/big blind/i), { target: { value: '20' } })
    fireEvent.change(getByLabelText(/buy-in amount/i), { target: { value: '1000' } })

    await user.click(getByRole('button', { name: /create game/i }))

    await waitFor(() => {
      expect(handleAuth).toHaveBeenCalledWith(expect.objectContaining({
        playerName: 'HostPlayer',
        roomId: 'ABCD'
      }))
    })
  })

  it('validates bounds and relationships for creating a room', async () => {
    const handleAuth = vi.fn()
    const user = userEvent.setup()
    
    render(<Lobby onAuth={handleAuth} />)

    const createRegion = screen.getByRole('region', { name: /create table/i })
    const { getByLabelText, getByRole } = within(createRegion)

    fireEvent.change(getByLabelText(/room name/i), { target: { value: 'BOUNDROOM' } })
    fireEvent.change(getByLabelText(/player alias/i), { target: { value: 'HostPlayer' } })

    // 1. Big blind less than 2x small blind (custom business rule validation)
    const smallBlindInput = getByLabelText(/small blind/i)
    const bigBlindInput = getByLabelText(/big blind/i)
    const buyInInput = getByLabelText(/buy-in amount/i)

    fireEvent.change(smallBlindInput, { target: { value: '10' } })
    fireEvent.change(bigBlindInput, { target: { value: '15' } })

    await user.click(getByRole('button', { name: /create game/i }))
    await waitFor(() => {
      expect(screen.getByText(/Big blind must be at least 2×/i)).toBeInTheDocument()
    })

    // Fix big blind and set buy-in less than big blind
    fireEvent.change(bigBlindInput, { target: { value: '40' } })
    fireEvent.change(buyInInput, { target: { value: '30' } })

    await user.click(getByRole('button', { name: /create game/i }))
    await waitFor(() => {
      expect(screen.getByText(/Buy-in must be at least/i)).toBeInTheDocument()
    })
  })
})
