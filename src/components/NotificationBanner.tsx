import type { FocusEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { ARIA_CLOSE_NOTIFICATION } from '../constants/strings';

export interface NotificationControls {
    /** Removes the notification. When given, the banner shows a Close button. */
    onDismiss?: () => void;
    /** Pauses auto-dismiss while the banner is hovered or holds focus. */
    onHold?: () => void;
    /** Resumes auto-dismiss once hover and focus have left. */
    onRelease?: () => void;
}

interface NotificationBannerProps extends NotificationControls {
    notification?: string | null;
    sequence?: number;
}

const DISPLAY_MS = 4000;

export function NotificationBanner({
    notification = null,
    sequence = 0,
    onDismiss,
    onHold,
    onRelease,
}: NotificationBannerProps) {
    const prefersReducedMotion = useReducedMotion();

    if (!notification) {
        return null;
    }

    const interactive = Boolean(onDismiss);

    const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
        // Focus moving between children of the banner is not leaving it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onRelease?.();
    };

    return (
        <motion.div
            key={`${sequence}:${notification}`}
            onMouseEnter={onHold}
            onMouseLeave={onRelease}
            onFocus={onHold}
            onBlur={handleBlur}
            initial={prefersReducedMotion ? false : { opacity: 0, y: -24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={
                prefersReducedMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 380, damping: 28 }
            }
            className={cn(
                'group fixed top-16 md:top-20 short:top-10 left-1/2 -translate-x-1/2 z-[100] bg-gold-secondary text-surface py-2.5 rounded-full font-headline font-bold shadow-lg max-w-[85vw] md:max-w-xl text-center text-sm md:text-base border border-amber-300/20 flex items-center gap-2',
                interactive ? 'pointer-events-auto pl-6 pr-2' : 'pointer-events-none px-6',
            )}
        >
            {/* Only the message is the live region, so the Close button's name is not announced with it. */}
            <p role="alert" aria-live="assertive" className="flex-1">
                {notification}
            </p>

            {onDismiss && (
                <button
                    type="button"
                    aria-label={ARIA_CLOSE_NOTIFICATION}
                    onClick={onDismiss}
                    className="shrink-0 min-w-6 min-h-6 rounded-full flex items-center justify-center hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
                >
                    <X aria-hidden="true" className="w-4 h-4" />
                </button>
            )}

            {/* Countdown bar. It pauses with the auto-dismiss timer while the banner is hovered or focused. */}
            {!prefersReducedMotion && (
                <span
                    aria-hidden="true"
                    className="notification-countdown absolute bottom-0 left-0 h-[3px] w-full rounded-full bg-black/20 origin-left group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
                    style={{ animationDuration: `${DISPLAY_MS}ms` }}
                />
            )}
        </motion.div>
    );
}
