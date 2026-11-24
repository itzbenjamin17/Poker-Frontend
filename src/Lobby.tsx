import { useState, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import type { AuthResponse } from './types';
import {
    LOBBY_HERO_SUBTITLE,
    LOBBY_HERO_TITLE_1,
    LOBBY_HERO_TITLE_2,
} from './constants/strings';
import { CreateRoomForm } from './components/lobby/CreateRoomForm';
import { JoinRoomForm } from './components/lobby/JoinRoomForm';
import { RejoinSeats } from './components/lobby/RejoinSeats';

export default function Lobby({
    onAuth,
}: {
    onAuth: (data: AuthResponse) => void;
}) {
    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [isRejoining, setIsRejoining] = useState(false);
    const [error, setErrorState] = useState<string | null>(null);
    const requestLock = useRef<AbortController | null>(null);

    const setError = (msg: string | null) => {
        setErrorState(msg);
    };

    return (
        <MotionConfig reducedMotion="user">
        <main className="min-h-dvh pt-6 md:pt-24 [@media(max-height:500px)]:pt-4 pb-16 md:pb-32 px-4 sm:px-6 flex flex-col items-center justify-center">
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full max-w-6xl mb-10 md:mb-14 [@media(max-height:500px)]:mb-4"
            >
                <span className="block text-gold-secondary font-headline text-[0.625rem] tracking-[0.2em] uppercase font-bold mb-2 md:mb-4 [@media(max-height:500px)]:hidden">
                    {LOBBY_HERO_SUBTITLE}
                </span>
                <h1 className="font-headline text-4xl sm:text-5xl md:text-7xl [@media(max-height:500px)]:text-2xl font-bold tracking-tighter leading-none text-white max-w-3xl">
                    {LOBBY_HERO_TITLE_1}{' '}
                    <br className="[@media(max-height:500px)]:hidden" />
                    <span className="text-emerald-primary/60">{LOBBY_HERO_TITLE_2}</span>
                </h1>
            </motion.div>

            <RejoinSeats
                onAuth={onAuth}
                onError={setError}
                disabled={isCreating || isJoining}
                setLoading={setIsRejoining}
                requestLock={requestLock}
            />

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
                        isSubmitting={isCreating}
                        disabled={isJoining || isRejoining}
                        setLoading={setIsCreating}
                        requestLock={requestLock}
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
                        isSubmitting={isJoining}
                        disabled={isCreating || isRejoining}
                        setLoading={setIsJoining}
                        requestLock={requestLock}
                    />
                </motion.div>
            </div>
        </main>
        </MotionConfig>
    );
}
