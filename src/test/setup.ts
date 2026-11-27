import type {} from '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './mocks/server';

import.meta.env.VITE_API_BASE_URL = '/api';
import.meta.env.VITE_WS_URL = 'ws://localhost:8080/ws';

// Start MSW server before all tests (both Node and JSDOM environments)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Reset handlers, timers, mocks, globals, and env stubs after each test
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Close MSW server after all tests
afterAll(() => server.close());

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  const initialInnerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const initialInnerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const openModalStack: HTMLDialogElement[] = [];

  afterEach(() => {
    openModalStack.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();
    if (initialInnerWidthDescriptor) {
      Object.defineProperty(window, 'innerWidth', initialInnerWidthDescriptor);
    }
    if (initialInnerHeightDescriptor) {
      Object.defineProperty(window, 'innerHeight', initialInnerHeightDescriptor);
    }
  });

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
      const existingIndex = openModalStack.indexOf(this);
      if (existingIndex !== -1) openModalStack.splice(existingIndex, 1);
      openModalStack.push(this);
      const focusTarget =
        this.querySelector<HTMLElement>('[autofocus]:not(:disabled)') ??
        this.querySelector<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)'
        );
      focusTarget?.focus();
    };
    proto.close = function (this: HTMLDialogElement, returnValue?: string) {
      const stackIndex = openModalStack.indexOf(this);
      if (stackIndex !== -1) openModalStack.splice(stackIndex, 1);
      if (!this.open) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    document.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.getAttribute('method') ?? '').toLowerCase() !== 'dialog') return;
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      form.closest('dialog')?.close(submitter?.value ?? '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      while (openModalStack.length > 0) {
        const candidate = openModalStack[openModalStack.length - 1];
        if (candidate.isConnected && candidate.open) {
          if (candidate.dispatchEvent(new Event('cancel', { cancelable: true }))) {
            candidate.close();
          }
          return;
        }
        openModalStack.pop();
      }
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
}
