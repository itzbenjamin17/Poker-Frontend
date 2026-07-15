import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { AuthResponse } from './types';
import {
    LOBBY_HERO_SUBTITLE,
    LOBBY_HERO_TITLE_1,
    LOBBY_HERO_TITLE_2,
} from './constants/strings';
import { CreateRoomForm } from './components/lobby/CreateRoomForm';
import { JoinRoomForm } from './components/lobby/JoinRoomForm';

export default function Lobby({
    onAuth,
    initialError,
    onClearInitialError,
}: {
    onAuth: (data: AuthResponse) => void;
    initialError?: string | null;
    onClearInitialError?: () => void;
}) {
    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [error, setErrorState] = useState<string | null>(null);
    const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setError = (msg: string | null) => {
        setErrorState(msg);
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = null;
        }
        if (msg) {
            errorTimeoutRef.current = setTimeout(() => {
                setErrorState(null);
            }, 5000);
        }
    };

    useEffect(() => {
        if (initialError) {
            const timer = setTimeout(() => {
                setError(initialError);
                onClearInitialError?.();
            }, 0);
            return () => clearTimeout(timer);
        }
    }, [initialError, onClearInitialError]);

    useEffect(() => {
        return () => {
            if (errorTimeoutRef.current) {
                clearTimeout(errorTimeoutRef.current);
            }
        };
    }, []);

    const loading = isCreating || isJoining;

    return (
        <div className="min-h-screen pt-24 pb-32 px-6 flex flex-col items-center justify-center">
            <AnimatePresence>
                {error && (
                    <motion.div
                        role="alert"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-4 rounded-xl font-headline font-bold shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-4"
                    >
                        <span>{error}</span>
                        <button
                            aria-label="Close error notification"
                            onClick={() => setError(null)}
                            className="bg-black/20 hover:bg-black/40 rounded-full w-6 h-6 flex items-center justify-center transition-colors"
                        >
                            &times;
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-6xl mb-16"
            >
                <span className="block text-gold-secondary font-headline text-[10px] tracking-[0.2em] uppercase font-bold mb-4">
                    {LOBBY_HERO_SUBTITLE}
                </span>
                <h1 className="font-headline text-5xl md:text-7xl font-bold tracking-tighter leading-none text-white max-w-3xl">
                    {LOBBY_HERO_TITLE_1} <br />
                    <span className="text-emerald-primary/60">{LOBBY_HERO_TITLE_2}</span>
                </h1>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full max-w-6xl">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="lg:col-span-7"
                >
                    <CreateRoomForm
                        onAuth={onAuth}
                        onError={setError}
                        loading={loading}
                        setLoading={setIsCreating}
                    />
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="lg:col-span-5"
                >
                    <JoinRoomForm
                        onAuth={onAuth}
                        onError={setError}
                        loading={loading}
                        setLoading={setIsJoining}
                    />
                </motion.div>
            </div>
        </div>
    );
}