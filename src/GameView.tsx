import { useState, useEffect, useRef, useCallback } from 'react';
import type { AuthResponse } from './types';
import { GameProvider, useGameContext } from './context/GameContext';
import { useSessionHydration } from './hooks/useSessionHydration';
import { useGameWebSocket } from './hooks/useGameWebSocket';
import { useGameActions } from './hooks/useGameActions';
import { useSeatLayout } from './hooks/useSeatLayout';
import { useShowdownModal } from './hooks/useShowdownModal';
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
    const [raiseError, setRaiseError] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());

    // ── Layout ──────────────────────────────────────────────────────────────────
    const { tableTier, isCompactTable, isMobileLandscape, getSeatPosition } = useSeatLayout({
        width: windowWidth,
        height: windowHeight,
    });

    // ── Showdown modal ──────────────────────────────────────────────────────────
    const showdownModal = useShowdownModal();

    // ── Window resize ───────────────────────────────────────────────────────────
    useEffect(() => {
        const onResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
            showdownModal.onWindowResize();
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [showdownModal]);

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

    // ── WebSocket ───────────────────────────────────────────────────────────────
    // actionsRef + handleRaiseError breaks the circular dep between
    // useGameWebSocket (needs onRaiseError) and useGameActions (needs stompClientRef).
    const actionsRef = useRef<ReturnType<typeof useGameActions> | null>(null);
    const handleRaiseError = useCallback((msg: string) => {
        actionsRef.current?.handleRaiseError(msg);
    }, []);

    const { stompClientRef } = useGameWebSocket({ onRaiseError: handleRaiseError });

    // ── Actions ─────────────────────────────────────────────────────────────────
    const actions = useGameActions(stompClientRef, setRaiseAmount, setRaiseError);
    useEffect(() => {
        actionsRef.current = actions;
    }, [actions]);

    // ── Routing (no hooks below this line) ──────────────────────────────────────

    if (!gameState) {
        // Show lobby if room is known but game hasn't started yet
        if (roomState && !roomState.gameStarted) {
            return (
                <GameLobbyView
                    onStartGame={actions.handleStartGame}
                    onLeaveGame={actions.handleLeaveGame}
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
            nowMs={nowMs}
            raiseAmount={raiseAmount}
            raiseError={raiseError}
            showdownLayout={showdownModal.layout}
            showdownModalRef={showdownModal.modalRef}
            getSeatPosition={getSeatPosition}
            onAction={actions.handleAction}
            onReady={actions.handleReady}
            onClaimWin={actions.handleClaimWin}
            onLeaveGame={actions.handleLeaveGame}
            onRaiseChange={(val) => {
                setRaiseAmount(val);
                setRaiseError(null);
            }}
            onShowdownDragPointerDown={showdownModal.onDragPointerDown}
            onShowdownResizePointerDown={showdownModal.onResizePointerDown}
            onShowdownPointerMove={showdownModal.onPointerMove}
            onShowdownPointerUp={showdownModal.onPointerUp}
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
