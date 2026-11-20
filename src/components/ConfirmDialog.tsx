import { useEffect, useId, useRef } from 'react';
import { Button } from './UI';

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    onConfirm: () => void;
    /** Called for the cancel button, Escape, and the back gesture. */
    onCancel: () => void;
}

const CONFIRM_VALUE = 'confirm';

/**
 * Modal confirmation on the native <dialog>. showModal() gives the top layer,
 * an inert page, focus containment, Escape and back-gesture dismissal, and focus
 * return to the invoker, so none of those are hand-rolled here. Unlike
 * window.confirm(), it does not block the main thread, so timers and the
 * WebSocket keep running while it is open.
 */
export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const messageId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    const handleClose = () => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const choice = dialog.returnValue;
        // Escape sets no value and browsers differ on clearing the last one, so reset it.
        dialog.returnValue = '';
        if (choice === CONFIRM_VALUE) onConfirm();
        else onCancel();
    };

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            aria-describedby={messageId}
            onClose={handleClose}
            className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-white/10 bg-surface-high p-6 text-white shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <h2 id={titleId} className="font-headline text-xl font-bold">{title}</h2>
            <p id={messageId} className="mt-2 text-sm text-zinc-300">{message}</p>
            <form method="dialog" className="mt-6 flex justify-end gap-3">
                {/* First in the DOM, so showModal() focuses the safe choice. */}
                <Button type="submit" value="cancel" variant="outline" size="sm">
                    {cancelLabel}
                </Button>
                <Button
                    type="submit"
                    value={CONFIRM_VALUE}
                    variant="outline"
                    size="sm"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                >
                    {confirmLabel}
                </Button>
            </form>
        </dialog>
    );
}
