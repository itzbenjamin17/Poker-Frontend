import '@testing-library/jest-dom'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import { beforeAll, afterEach, afterAll } from 'vitest'
import { activeSubscriptions } from './mocks/stomp'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends TestingLibraryMatchers<T, R> {}
}

import.meta.env.VITE_API_BASE_URL = '/api';
import.meta.env.VITE_WS_URL = 'ws://localhost:8080/ws';

if (typeof window !== 'undefined') {
  const { server } = await import('./mocks/server');

  // Start MSW server before all tests
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

  // Reset handlers after each test to ensure test isolation
  afterEach(() => {
    server.resetHandlers()
    activeSubscriptions.clear()
  })

  // Close MSW server after all tests
  afterAll(() => server.close())

  // jsdom has no modal <dialog> support. Mimic the browser behaviour the app relies on:
  // showModal() focuses the first control, <form method="dialog"> closes with the
  // submitter's value, Escape fires a cancelable `cancel` then closes, and close() fires `close`.
  // Real top-layer, inertness and focus return are checked in Playwright.
  if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & { returnValue: string };
    Object.defineProperty(proto, 'open', {
      configurable: true,
      get(this: HTMLDialogElement) { return this.hasAttribute('open'); },
      set(this: HTMLDialogElement, value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
      },
    });
    Object.defineProperty(proto, 'returnValue', { configurable: true, writable: true, value: '' });
    proto.show = function (this: HTMLDialogElement) { this.open = true; };
    proto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
      this.setAttribute('data-test-modal', '');
      this.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
    };
    proto.close = function (this: HTMLDialogElement, returnValue?: string) {
      if (!this.open) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      this.removeAttribute('data-test-modal');
      this.dispatchEvent(new Event('close'));
    };
    document.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement;
      if (form.getAttribute('method') !== 'dialog') return;
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      form.closest('dialog')?.close(submitter?.value ?? '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modals = document.querySelectorAll<HTMLDialogElement>('dialog[data-test-modal][open]');
      const top = modals[modals.length - 1];
      if (!top) return;
      if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
    });
  }

  // Global ResizeObserver mock for jsdom test runner
  if (typeof window.ResizeObserver === 'undefined') {
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(_target: Element) { void _target; }
      unobserve(_target: Element) { void _target; }
      disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }
} else {
  afterEach(() => {
    activeSubscriptions.clear()
  })
}
