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

  it('allows clearing Small Blind, Big Blind, and Buy-In with Backspace and submitting newly typed numbers', async () => {
    const handleAuth = vi.fn()
    const user = userEvent.setup()
    let submittedPayload: Record<string, unknown> | null = null

    server.use(
      http.post('/api/room/create', async ({ request }) => {
        submittedPayload = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          message: 'Room created successfully',
          data: {
            token: 'mock-jwt-token',
            playerName: String(submittedPayload.playerName),
            roomId: 'ABCD',
          },
        })
      })
    )

    render(<Lobby onAuth={handleAuth} />)

    const createRegion = screen.getByRole('region', { name: /create table/i })
    const { getByLabelText, getByRole } = within(createRegion)

    const roomInput = getByLabelText(/room name/i)
    const playerInput = getByLabelText(/player alias/i)
    const smallBlindInput = getByLabelText(/small blind/i) as HTMLInputElement
    const bigBlindInput = getByLabelText(/big blind/i) as HTMLInputElement
    const buyInInput = getByLabelText(/buy-in amount/i) as HTMLInputElement

    await user.type(roomInput, 'ClearTestRoom')
    await user.type(playerInput, 'BackspaceUser')

    await user.clear(smallBlindInput)
    expect(smallBlindInput.value).toBe('')
    await user.type(smallBlindInput, '25')

    await user.clear(bigBlindInput)
    expect(bigBlindInput.value).toBe('')
    await user.type(bigBlindInput, '50')

    await user.clear(buyInInput)
    expect(buyInInput.value).toBe('')
    await user.type(buyInInput, '2000')

    await user.click(getByRole('button', { name: /create game/i }))

    await waitFor(() => {
      expect(submittedPayload).toEqual({
        roomName: 'ClearTestRoom',
        playerName: 'BackspaceUser',
        maxPlayers: 6,
        smallBlind: 25,
        bigBlind: 50,
        buyIn: 2000,
      })
    })
  })

  it('keeps Create button text as CREATE GAME (disabled) while joinRoom is pending', async () => {
    const user = userEvent.setup()
    let resolveJoin!: () => void

    server.use(
      http.post('/api/room/join', async ({ request }) => {
        const { playerName, roomName } = (await request.json()) as { playerName: string; roomName: string }
        await new Promise<void>((resolve) => {
          resolveJoin = resolve
        })
        return HttpResponse.json({
          message: 'Successfully joined room',
          data: {
            token: 'mock-jwt-token',
            playerName,
            roomId: roomName,
          },
        })
      })
    )

    render(<Lobby onAuth={vi.fn()} />)

    const quickJoinRegion = screen.getByRole('region', { name: /quick join/i })
    const createRegion = screen.getByRole('region', { name: /create table/i })

    await user.type(within(quickJoinRegion).getByLabelText(/room name/i), 'POKER123')
    await user.type(within(quickJoinRegion).getByLabelText(/player alias/i), 'Joiner')

    await user.click(within(quickJoinRegion).getByRole('button', { name: /join game/i }))

    // Join button shows JOINING..., Create button remains CREATE GAME (disabled, not CREATING...)
    const joinBtn = await within(quickJoinRegion).findByRole('button', { name: /joining\.\.\./i })
    expect(joinBtn).toBeDisabled()

    const createBtn = within(createRegion).getByRole('button', { name: /create game/i })
    expect(createBtn).toBeDisabled()
    expect(within(createRegion).queryByRole('button', { name: /creating\.\.\./i })).not.toBeInTheDocument()

    resolveJoin()
  })
})
