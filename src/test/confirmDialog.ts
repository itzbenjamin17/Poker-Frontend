import { act, screen, within } from '@testing-library/react';

/** Accepts the leave confirmation dialog opened by a Leave Table button. */
export async function confirmLeave(): Promise<void> {
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
        within(dialog).getByRole('button', { name: 'Leave' }).click();
    });
}
