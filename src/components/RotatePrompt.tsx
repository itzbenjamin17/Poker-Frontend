import { RotateCcw, LogOut } from 'lucide-react';
import { cn } from '../lib/cn';

export interface RotatePromptProps {
    className?: string;
    brandTitle?: string;
    message?: string;
    subMessage?: string;
    onLeave?: () => void;
}

export function RotatePrompt({
    className,
    brandTitle = 'POKER',
    message = 'Landscape mode required.',
    subMessage = 'Please widen your browser window or rotate your device to play.',
    onLeave,
}: RotatePromptProps) {
    return (
        <div
            role="region"
            aria-label="Rotate device prompt"
            data-testid="rotate-prompt"
            className={cn(
                'h-dvh w-full flex flex-col items-center justify-center gap-6 bg-surface px-6 text-center select-none overscroll-none',
                className
            )}
        >
            <span className="text-3xl font-headline font-bold text-emerald-primary tracking-tighter">
                {brandTitle}
            </span>

            <div
                className="w-16 h-16 rounded-2xl bg-emerald-primary/10 border border-emerald-primary/20 flex items-center justify-center text-emerald-primary shadow-[0_0_24px_rgba(170,234,208,0.15)] animate-pulse"
                aria-hidden="true"
            >
                <RotateCcw className="w-8 h-8" />
            </div>

            <div className="space-y-2 max-w-sm">
                <h2 className="text-xl font-headline font-bold text-white tracking-tight">
                    {message}
                </h2>
                <p className="text-zinc-400 text-sm">
                    {subMessage}
                </p>
            </div>

            {onLeave && (
                <button
                    type="button"
                    onClick={onLeave}
                    className="mt-8 flex items-center justify-center gap-2 px-8 py-3 rounded-full bg-surface-highest/80 hover:bg-surface-highest text-zinc-300 transition-colors border border-white/5 shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-primary"
                >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm font-semibold tracking-wide">LEAVE</span>
                </button>
            )}
        </div>
    );
}
