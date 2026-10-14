import React, { type ReactNode } from 'react';
import { logger } from '../security/logger';
import {
    ERROR_BOUNDARY_HEADING,
    ERROR_BOUNDARY_MESSAGE,
    BTN_TRY_AGAIN,
    BTN_RELOAD,
    BTN_RETURN_TO_LOBBY,
} from '../constants/strings';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: (error: unknown) => void;
    onLeave?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        logger.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
    }

    handleReset = () => {
        this.props.onReset?.(this.state.error);
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="min-h-screen flex items-center justify-center p-8">
                    <div className="glass-card rounded-2xl p-10 max-w-md w-full text-center space-y-6">
                        <div className="text-5xl">♠</div>
                        <h1 className="font-headline text-2xl font-bold text-white">{ERROR_BOUNDARY_HEADING}</h1>
                        <p className="text-zinc-500 text-sm">
                            {ERROR_BOUNDARY_MESSAGE}
                        </p>
                        <div className="flex flex-wrap gap-3 justify-center">
                            <button
                                onClick={this.handleReset}
                                className="px-6 py-2.5 rounded-xl bg-emerald-container text-surface font-headline font-bold text-sm uppercase tracking-tight transition-all hover:opacity-90 active:scale-95"
                            >
                                {BTN_TRY_AGAIN}
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2.5 rounded-xl border border-emerald-primary/20 text-emerald-primary font-headline font-bold text-sm uppercase tracking-tight transition-all hover:bg-emerald-primary/10 active:scale-95"
                            >
                                {BTN_RELOAD}
                            </button>
                            {this.props.onLeave && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        this.props.onLeave?.();
                                        this.setState({ hasError: false, error: null });
                                    }}
                                    className="px-6 py-2.5 rounded-xl border border-emerald-primary/20 text-emerald-primary font-headline font-bold text-sm"
                                >
                                    {BTN_RETURN_TO_LOBBY}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
