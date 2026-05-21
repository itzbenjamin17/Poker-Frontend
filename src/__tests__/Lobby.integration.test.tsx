import { render, screen, waitFor, within } from '@testing-library/react'
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

    await user.type(joinRoomInput, 'POKER123')
    await user.type(joinPlayerInput, 'TestPlayer')

    const joinButton = getByRole('button', { name: /enter vault/i })
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
          { message: 'Vault is sealed. Invalid room name.' },
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

    await user.type(joinRoomInput, 'NONEXISTENT')
    await user.type(joinPlayerInput, 'TestPlayer')

    await user.click(getByRole('button', { name: /enter vault/i }))

    // Error message from the mock should appear
    await waitFor(() => {
      expect(screen.getByText(/Vault is sealed/i)).toBeInTheDocument()
    })
  })

  it('allows a user to create a room successfully', async () => {
    const handleAuth = vi.fn()
    const user = userEvent.setup()
    
    render(<Lobby onAuth={handleAuth} />)

    const createRegion = screen.getByRole('region', { name: /create table/i })
    const { getByLabelText, getByRole } = within(createRegion)

    await user.type(getByLabelText(/room name/i), 'NEWROOM')
    await user.type(getByLabelText(/player alias/i), 'HostPlayer')
    
    const smallBlindInput = getByLabelText(/small blind/i)
    await user.type(smallBlindInput, '10', {
      initialSelectionStart: 0,
      initialSelectionEnd: (smallBlindInput as HTMLInputElement).value.length
    })

    const bigBlindInput = getByLabelText(/big blind/i)
    await user.type(bigBlindInput, '20', {
      initialSelectionStart: 0,
      initialSelectionEnd: (bigBlindInput as HTMLInputElement).value.length
    })

    const buyInInput = getByLabelText(/buy-in amount/i)
    await user.type(buyInInput, '1000', {
      initialSelectionStart: 0,
      initialSelectionEnd: (buyInInput as HTMLInputElement).value.length
    })

    await user.click(getByRole('button', { name: /establish table/i }))

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

    await user.type(getByLabelText(/room name/i), 'BOUNDROOM')
    await user.type(getByLabelText(/player alias/i), 'HostPlayer')

    // 1. Big blind less than 2x small blind (custom business rule validation)
    const smallBlindInput = getByLabelText(/small blind/i)
    await user.type(smallBlindInput, '10', {
      initialSelectionStart: 0,
      initialSelectionEnd: (smallBlindInput as HTMLInputElement).value.length
    })

    const bigBlindInput = getByLabelText(/big blind/i)
    await user.type(bigBlindInput, '15', {
      initialSelectionStart: 0,
      initialSelectionEnd: (bigBlindInput as HTMLInputElement).value.length
    })

    await user.click(getByRole('button', { name: /establish table/i }))
    await waitFor(() => {
      expect(screen.getByText(/Big blind must be at least 2×/i)).toBeInTheDocument()
    })

    // Fix big blind
    await user.type(bigBlindInput, '40', {
      initialSelectionStart: 0,
      initialSelectionEnd: (bigBlindInput as HTMLInputElement).value.length
    })

    // 2. Buy-in less than big blind (custom business rule validation)
    const buyInInput = getByLabelText(/buy-in amount/i)
    await user.type(buyInInput, '30', {
      initialSelectionStart: 0,
      initialSelectionEnd: (buyInInput as HTMLInputElement).value.length
    })

    await user.click(getByRole('button', { name: /establish table/i }))
    await waitFor(() => {
      expect(screen.getByText(/Buy-in must be at least/i)).toBeInTheDocument()
    })
  })
})
