import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { confirmLeave } from '../confirmDialog';

describe('shared test infrastructure (jsdom)', () => {
    describe('global afterEach cleanup', () => {
        it('mutates storage and viewport dimensions without local teardown', () => {
            sessionStorage.setItem('poker-auth', '{"token":"t"}');
            localStorage.setItem('poker-recent-seats', '[]');
            Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 480 });
            Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 320 });

            expect(window.innerWidth).toBe(480);
            expect(window.innerHeight).toBe(320);
        });

        it('restores empty storage and default viewport dimensions on the next test', () => {
            expect(sessionStorage.getItem('poker-auth')).toBeNull();
            expect(localStorage.getItem('poker-recent-seats')).toBeNull();
            expect(window.innerWidth).toBe(1024);
            expect(window.innerHeight).toBe(768);
        });
    });

    describe('HTMLDialogElement polyfill fidelity', () => {
        it('closes topmost opened modal on Escape even when opened earlier-vs-later out of DOM order', async () => {
            const user = userEvent.setup();
            render(
                <>
                    <dialog aria-label="Dialog B">
                        <button type="button">B Action</button>
                    </dialog>
                    <dialog aria-label="Dialog A">
                        <button type="button">A Action</button>
                    </dialog>
                </>
            );

            const dialogA = document.querySelector<HTMLDialogElement>('dialog[aria-label="Dialog A"]')!;
            const dialogB = document.querySelector<HTMLDialogElement>('dialog[aria-label="Dialog B"]')!;

            dialogA.showModal();
            dialogB.showModal();

            expect(dialogA.open).toBe(true);
            expect(dialogB.open).toBe(true);
            expect(dialogB.hasAttribute('data-test-modal')).toBe(false);

            await user.keyboard('{Escape}');
            expect(dialogB.open).toBe(false);
            expect(dialogA.open).toBe(true);

            await user.keyboard('{Escape}');
            expect(dialogA.open).toBe(false);
        });

        it('skips disabled buttons (including disabled fieldsets) and prioritizes [autofocus] in showModal()', () => {
            render(
                <dialog aria-label="Focus Dialog">
                    <button type="button" disabled>Disabled</button>
                    <fieldset disabled>
                        <button type="button">Fieldset Disabled</button>
                    </fieldset>
                    <button type="button">First Enabled</button>
                    <button type="button">Auto Focused</button>
                </dialog>
            );

            const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Focus Dialog"]')!;
            screen.getByRole('button', { name: 'Auto Focused', hidden: true }).setAttribute('autofocus', '');
            dialog.showModal();

            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Auto Focused' }));
        });

        it('respects defaultPrevented and case-insensitive form method="DIALOG"', async () => {
            const user = userEvent.setup();
            const onCancel = vi.fn((e: Event) => e.preventDefault());
            render(
                <dialog aria-label="Form Dialog">
                    <form method="DIALOG">
                        <button type="submit" value="ok">Done</button>
                    </form>
                </dialog>
            );

            const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Form Dialog"]')!;
            dialog.addEventListener('cancel', onCancel);
            dialog.showModal();

            await user.keyboard('{Escape}');
            expect(onCancel).toHaveBeenCalledTimes(1);
            expect(dialog.open).toBe(true);

            await user.click(screen.getByRole('button', { name: 'Done' }));
            expect(dialog.open).toBe(false);
            expect(dialog.returnValue).toBe('ok');
        });
    });

    describe('confirmLeave()', () => {
        it('clicks Leave using the provided userEvent instance without manual act()', async () => {
            const onLeave = vi.fn();
            const user = userEvent.setup();
            const clickSpy = vi.spyOn(user, 'click');

            render(
                <dialog open>
                    <button type="button" onClick={onLeave}>Leave</button>
                </dialog>
            );

            await confirmLeave(user);

            expect(clickSpy).toHaveBeenCalledTimes(1);
            expect(onLeave).toHaveBeenCalledTimes(1);
        });
    });
});
