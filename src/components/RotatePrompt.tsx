import { RotateCcw, LogOut } from 'lucide-react';
import { cn } from '../lib/cn';
import {
    APP_NAME,
    ROTATE_REQUIRED,
    ROTATE_INSTRUCTIONS,
    ARIA_ROTATE_PROMPT,
    BTN_LEAVE,
} from '../constants/strings';

export interface RotatePromptProps {
    className?: string;
    brandTitle?: string;
    message?: string;
    subMessage?: string;
    onLeave?: () => void;
}

export function RotatePrompt({
    className,
    brandTitle = APP_NAME,
    message = ROTATE_REQUIRED,
    subMessage = ROTATE_INSTRUCTIONS,
    onLeave,
}: RotatePromptProps) {
    return (
        <div
            role="region"
            aria-label={ARIA_ROTATE_PROMPT}
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
                className="w-16 h-16 rounded-2xl bg-emerald-primary/10 border border-emerald-primary/20 flex items-center justify-center text-emerald-primary shadow-[0_0_24px_rgba(170,234,208,0.15)] animate-pulse motion-reduce:animate-none"
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
                    <span className="text-sm font-semibold tracking-wide">{BTN_LEAVE}</span>
                </button>
            )}
        </div>
    );
}
