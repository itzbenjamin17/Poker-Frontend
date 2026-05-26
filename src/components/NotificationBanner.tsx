import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

interface NotificationBannerProps {
    notification: string | null;
}

const DISPLAY_MS = 4000;

export function NotificationBanner({ notification }: NotificationBannerProps) {
    const [visible, setVisible] = useState(false);
    const [frozen, setFrozen] = useState<string | null>(null);
    const [prevNotification, setPrevNotification] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (notification !== prevNotification) {
        setPrevNotification(notification);
        if (notification) {
            setFrozen(notification);
            setVisible(true);
        }
    }

    useEffect(() => {
        if (!visible) return;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(false), DISPLAY_MS);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [visible, frozen]); // re-run timer if visible or frozen string changes

    return (
        <AnimatePresence>
            {visible && frozen && (
                <motion.div
                    role="alert"
                    aria-live="assertive"
                    initial={{ opacity: 0, scale: 0.88 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.88 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-gold-secondary text-surface px-8 py-4 rounded-2xl font-headline font-bold shadow-2xl max-w-[85vw] md:max-w-xl text-center pointer-events-none text-base md:text-lg"
                >
                    {frozen}

                    {/* Progress bar */}
                    <motion.div
                        className="absolute bottom-0 left-0 h-[3px] rounded-full bg-black/20"
                        initial={{ scaleX: 1 }}
                        animate={{ scaleX: 0 }}
                        style={{ transformOrigin: 'left', width: '100%' }}
                        transition={{ duration: DISPLAY_MS / 1000, ease: 'linear' }}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}