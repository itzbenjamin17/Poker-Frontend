import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Lobby from '../Lobby'
import { server } from '../test/mocks/server'
import { http, HttpResponse } from 'msw'

describe('Lobby Integration', () => {
  it('allows a user to join a room successfully', async () => {
    const handleAuth = vi.fn()
    render(<Lobby onAuth={handleAuth} />)

    // Find the "Quick Join" section inputs
    // Since there are two forms, we need to be careful with labels if they are identical
    // But RTL queryByLabelText finds by text content, and we have two "Room Name" labels.
    // We can use the section context or just get all and pick.
    
    const roomInputs = screen.getAllByLabelText(/room name/i)
    const playerInputs = screen.getAllByLabelText(/player alias/i)

    // Join form is the second one in the DOM (lg:col-span-5)
    const joinRoomInput = roomInputs[1]
    const joinPlayerInput = playerInputs[1]

    fireEvent.change(joinRoomInput, { target: { value: 'POKER123' } })
    fireEvent.change(joinPlayerInput, { target: { value: 'TestPlayer' } })

    const joinButton = screen.getByRole('button', { name: /enter vault/i })
    fireEvent.click(joinButton)

    // Expect loading state
    expect(joinButton).toHaveTextContent(/entering/i)

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

    render(<Lobby onAuth={() => {}} />)

    const roomInputs = screen.getAllByLabelText(/room name/i)
    const playerInputs = screen.getAllByLabelText(/player alias/i)

    fireEvent.change(roomInputs[1], { target: { value: 'NONEXISTENT' } })
    fireEvent.change(playerInputs[1], { target: { value: 'TestPlayer' } })

    fireEvent.click(screen.getByRole('button', { name: /enter vault/i }))

    // Error message from the mock should appear
    await waitFor(() => {
      expect(screen.getByText(/Vault is sealed/i)).toBeInTheDocument()
    })
  })
})
