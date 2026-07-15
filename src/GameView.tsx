import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AuthResponse } from './types';
import { GameProvider } from './context/GameProvider';
import { useGameContext } from './context/GameContext';
import { useSessionHydration } from './hooks/useSessionHydration';
import { useGameWebSocket } from './hooks/useGameWebSocket';
import { useGameDispatcher } from './hooks/useGameDispatcher';
import { useSeatLayout } from './hooks/useSeatLayout';
import { LoadingView } from './components/LoadingView';
import { GameLobbyView } from './components/GameLobbyView';
import { GameTableView } from './components/GameTableView';

type GameViewProps = {
    auth: AuthResponse;
    onLeave?: () => void;
};

// ─── Inner component (has access to GameContext) ──────────────────────────────

function GameViewInner() {
    // ALL hooks must be called unconditionally at the top — no hooks after returns.
    const { gameState, loadingStatus, roomState } = useGameContext();

    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
    const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
    const [raiseAmount, setRaiseAmount] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());

    // ── Layout ──────────────────────────────────────────────────────────────────
    const { tableTier, isCompactTable, isMobileLandscape, getSeatPosition, scale } = useSeatLayout({
        width: windowWidth,
        height: windowHeight,
    });

    // ── Window resize ───────────────────────────────────────────────────────────
    useEffect(() => {
        const onResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // ── Disconnect countdown clock ──────────────────────────────────────────────
    useEffect(() => {
        const hasDisconnected = Boolean(gameState?.players.some(p => p.status === 'DISCONNECTED'));
        const hasReadyCountdown = gameState?.phase === 'SHOWDOWN' && Boolean(gameState.isReadyCountdownActive);
        if (!hasDisconnected && !hasReadyCountdown) return;

        const update = () => setNowMs(Date.now());
        update();
        const id = window.setInterval(update, 1000);
        return () => window.clearInterval(id);
    }, [gameState]);

    // ── Session hydration ───────────────────────────────────────────────────────
    useSessionHydration();

    // ── WebSocket & Dispatcher ──────────────────────────────────────────────────
    const dispatcherRef = useRef<ReturnType<typeof useGameDispatcher> | null>(null);
    const handleSocketError = useCallback((msg: string) => {
        dispatcherRef.current?.onSocketError(msg);
    }, []);

    const { stompClientRef } = useGameWebSocket({ onSocketError: handleSocketError });

    const publisherAdapter = useMemo(() => ({
        publish: (dest: string, body: string) => {
            stompClientRef.current?.publish({ destination: dest, body });
        },
        isConnected: () => stompClientRef.current?.connected ?? false
    }), [stompClientRef]);

    const dispatcher = useGameDispatcher(publisherAdapter);
    
    useEffect(() => {
        dispatcherRef.current = dispatcher;
    }, [dispatcher]);

    // ── Routing (no hooks below this line) ──────────────────────────────────────

    if (!gameState) {
        // Show lobby if room is known but game hasn't started yet
        if (roomState && !roomState.gameStarted) {
            return (
                <GameLobbyView
                    onStartGame={() => dispatcher.dispatch({ type: 'START_GAME' })}
                    onLeaveGame={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                    isStartingGame={dispatcher.isPending('START_GAME')}
                />
            );
        }
        // Show loading spinner while connecting / hydrating
        return <LoadingView status={loadingStatus} />;
    }

    // ── Active game table ───────────────────────────────────────────────────────
    return (
        <GameTableView
            tableTier={tableTier}
            isCompactTable={isCompactTable}
            isMobileLandscape={isMobileLandscape}
            scale={scale}
            nowMs={nowMs}
            raiseAmount={raiseAmount}
            raiseError={dispatcher.error?.message ?? null}
            getSeatPosition={getSeatPosition}
            onAction={(action, amount) => dispatcher.dispatch({ type: 'PLAY_ACTION', action, amount })}
            onReady={() => dispatcher.dispatch({ type: 'READY' })}
            onClaimWin={() => dispatcher.dispatch({ type: 'CLAIM_WIN' })}
            onLeaveGame={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
            onRaiseChange={(val) => {
                setRaiseAmount(val);
                dispatcher.clearError();
            }}
            isActionPending={dispatcher.isPending('PLAY_ACTION') || dispatcher.isPending('READY') || dispatcher.isPending('START_GAME') || dispatcher.isPending('CLAIM_WIN') || dispatcher.isPending('LEAVE_GAME')}
        />
    );
}

// ─── Public export ─────────────────────────────────────────────────────────────

export default function GameView({ auth, onLeave }: GameViewProps) {
    return (
        <GameProvider auth={auth} onLeave={onLeave}>
            <GameViewInner />
        </GameProvider>
    );
}
