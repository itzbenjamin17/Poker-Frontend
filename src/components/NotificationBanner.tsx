import { motion, AnimatePresence } from 'motion/react';

interface NotificationBannerProps {
    notification: string | null;
}

export function NotificationBanner({ notification }: NotificationBannerProps) {
    return (
        <AnimatePresence>
            {notification && (
                <motion.div
                    role="alert"
                    aria-live="assertive"
                    initial={{ opacity: 0, scale: 0.9, x: '-50%' }}
                    animate={{ opacity: 1, scale: 1, x: '-50%' }}
                    exit={{ opacity: 0, scale: 0.9, x: '-50%' }}
                    className="fixed top-24 left-1/2 z-[100] bg-gold-secondary text-surface px-6 py-3 rounded-2xl md:rounded-full font-headline font-bold shadow-2xl max-w-[90vw] md:max-w-2xl text-center pointer-events-none"
                >
                    {notification}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
