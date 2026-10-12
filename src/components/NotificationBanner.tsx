import { motion, useReducedMotion } from 'motion/react';

interface NotificationBannerProps {
    notification?: string | null;
}

const DISPLAY_MS = 4000;

export function NotificationBanner({ notification = null }: NotificationBannerProps) {
    const prefersReducedMotion = useReducedMotion();

    if (!notification) {
        return null;
    }

    return (
        <motion.div
            key={notification}
            role="alert"
            aria-live="assertive"
            initial={prefersReducedMotion ? false : { opacity: 0, y: -24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={
                prefersReducedMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 380, damping: 28 }
            }
            className="fixed top-16 md:top-20 short:top-10 left-1/2 -translate-x-1/2 z-[100] bg-gold-secondary text-surface px-6 py-2.5 rounded-full font-headline font-bold shadow-lg max-w-[85vw] md:max-w-xl text-center pointer-events-none text-sm md:text-base border border-amber-300/20"
        >
            {notification}

            {/* Progress bar */}
            {!prefersReducedMotion && (
                <motion.div
                    className="absolute bottom-0 left-0 h-[3px] rounded-full bg-black/20"
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    style={{ transformOrigin: 'left', width: '100%' }}
                    transition={{ duration: DISPLAY_MS / 1000, ease: 'linear' }}
                />
            )}
        </motion.div>
    );
}
