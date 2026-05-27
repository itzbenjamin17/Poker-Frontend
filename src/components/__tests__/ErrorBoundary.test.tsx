
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test boundary crash');
    }
    return <div>Working Fine</div>;
};

describe('ErrorBoundary', () => {
    test('renders children when there is no error', () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={false} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Working Fine')).toBeInTheDocument();
    });

    test('catches error and renders custom fallback when provided', () => {
        // Suppress console.error inside Vitest run for this crash
        const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <ErrorBoundary fallback={<div>Custom Error Layout</div>}>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom Error Layout')).toBeInTheDocument();
        expect(screen.queryByText('Working Fine')).not.toBeInTheDocument();
        spyConsole.mockRestore();
    });

    test('catches error and renders default recovery UI with Try Again / Reload buttons', () => {
        const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText('An unexpected application error occurred.')).toBeInTheDocument();

        const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
        const reloadBtn = screen.getByRole('button', { name: /reload/i });

        expect(tryAgainBtn).toBeInTheDocument();
        expect(reloadBtn).toBeInTheDocument();

        spyConsole.mockRestore();
    });

    test('clicking Try Again resets the error state', () => {
        const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { rerender } = render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();

        const tryAgainBtn = screen.getByRole('button', { name: /try again/i });

        // Rerender with component fixed (shouldThrow = false)
        rerender(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={false} />
            </ErrorBoundary>
        );

        fireEvent.click(tryAgainBtn);

        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
        expect(screen.getByText('Working Fine')).toBeInTheDocument();

        spyConsole.mockRestore();
    });

    test('clicking Reload triggers window.location.reload', () => {
        const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
        const reloadSpy = vi.fn();
        
        // Mock window.location
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...originalLocation, reload: reloadSpy }
        });

        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        const reloadBtn = screen.getByRole('button', { name: /reload/i });
        fireEvent.click(reloadBtn);

        expect(reloadSpy).toHaveBeenCalledTimes(1);

        // Restore window.location
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation
        });
        spyConsole.mockRestore();
    });
});
