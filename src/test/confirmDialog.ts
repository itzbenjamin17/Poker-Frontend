import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type UserEventInstance = ReturnType<typeof userEvent.setup>;

/** Accepts the leave confirmation dialog opened by a Leave Table button. */
export async function confirmLeave(user: UserEventInstance = userEvent.setup()): Promise<void> {
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
}
