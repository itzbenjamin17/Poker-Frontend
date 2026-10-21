import { useEffect, useRef, useState } from 'react';
import { ERROR_MALFORMED_RESPONSE } from '../../constants/strings';
import type { AuthResponse } from '../../types';
import { logger } from '../../security/logger';
import { isAuthResponse, normalizeErrorMessage } from '../../lib/payloads';

/** Shared lock used by the create and join forms to prevent overlapping requests. */
export type LobbyRequestLock = { current: AbortController | null };

interface UseLobbyRequestOptions {
    requestLock?: LobbyRequestLock;
    onAuth: (data: AuthResponse) => void;
    onError: (message: string | null) => void;
    setLoading: (loading: boolean) => void;
}

export function useLobbyRequest({
    requestLock,
    onAuth,
    onError,
    setLoading,
}: UseLobbyRequestOptions) {
    const localRequestLock = useRef<AbortController | null>(null);
    const lock = requestLock ?? localRequestLock;
    const ownedController = useRef<AbortController | null>(null);
    const mounted = useRef(true);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            const controller = ownedController.current;
            if (controller) {
                controller.abort();
                ownedController.current = null;
            }
        };
    }, [lock]);

    const isBusy = () => pending || lock.current !== null;

    const run = async (
        request: (signal: AbortSignal) => Promise<AuthResponse>,
        fallback: string,
    ): Promise<void> => {
        if (isBusy()) return;

        const controller = new AbortController();
        lock.current = controller;
        controller.signal.addEventListener('abort', () => {
            if (lock.current === controller) lock.current = null;
        }, { once: true });
        ownedController.current = controller;
        setPending(true);
        setLoading(true);

        let authenticated = false;
        try {
            const response = await request(controller.signal);
            if (!mounted.current || controller.signal.aborted) return;
            if (!isAuthResponse(response)) {
                throw new Error(ERROR_MALFORMED_RESPONSE);
            }
            onAuth(response);
            authenticated = true;
        } catch (error) {
            if (mounted.current && !controller.signal.aborted) {
                logger.error('Lobby request failed:', error);
                const rawMessage = error instanceof Error ? error.message : null;
                const normalized = normalizeErrorMessage(rawMessage);
                onError(normalized && normalized.trim().length > 0 ? normalized : fallback);
            }
        } finally {
            if (mounted.current) {
                setPending(false);
                setLoading(false);
            }
            if (!authenticated && lock.current === controller) lock.current = null;
            if (ownedController.current === controller) ownedController.current = null;
        }
    };

    return { isBusy, run };
}
