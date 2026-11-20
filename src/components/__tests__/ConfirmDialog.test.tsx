import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';
import '@testing-library/jest-dom';

function renderDialog(open: boolean) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const utils = render(
        <ConfirmDialog
            open={open}
            title="Leave the table?"
            message="This will abandon your seat."
            confirmLabel="Leave"
            cancelLabel="Stay"
            onConfirm={onConfirm}
            onCancel={onCancel}
        />,
    );
    return { ...utils, onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
    it('is not shown while closed', () => {
        renderDialog(false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens as a named, described modal with focus on the safe action', () => {
        renderDialog(true);

        const dialog = screen.getByRole('dialog', { name: 'Leave the table?' });
        expect(dialog).toHaveAccessibleDescription('This will abandon your seat.');
        expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    });

    it('confirms only when the confirm button is chosen', async () => {
        const user = userEvent.setup();
        const { onConfirm, onCancel } = renderDialog(true);

        await user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancels from the cancel button', async () => {
        const user = userEvent.setup();
        const { onConfirm, onCancel } = renderDialog(true);

        await user.click(screen.getByRole('button', { name: 'Stay' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('cancels on Escape', async () => {
        const user = userEvent.setup();
        const { onConfirm, onCancel } = renderDialog(true);

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not report a previous choice when it is dismissed later', async () => {
        const user = userEvent.setup();
        const { onConfirm, onCancel, rerender } = renderDialog(true);

        await user.click(screen.getByRole('button', { name: 'Leave' }));
        rerender(
            <ConfirmDialog open={false} title="Leave the table?" message="This will abandon your seat." confirmLabel="Leave" cancelLabel="Stay" onConfirm={onConfirm} onCancel={onCancel} />,
        );
        rerender(
            <ConfirmDialog open title="Leave the table?" message="This will abandon your seat." confirmLabel="Leave" cancelLabel="Stay" onConfirm={onConfirm} onCancel={onCancel} />,
        );
        await user.keyboard('{Escape}');

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
