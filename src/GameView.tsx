import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AuthResponse } from './types';
import { GameProvider } from './context/GameProvider';
import { useGameContext } from './context/GameContext';
import { useSessionHydration } from './hooks/useSessionHydration';
import { useGameWebSocket } from './hooks/useGameWebSocket';
import { useGameDispatcher } from './hooks/useGameDispatcher';
import { LoadingView } from './components/LoadingView';
import { GameLobbyView } from './components/GameLobbyView';
import { GameTableView } from './components/GameTableView';
import { GameReviewView } from './components/GameReviewView';
import { PokerRoomLayout, RoomStage } from './components/PokerRoomLayout';
import { RoomHeader } from './components/RoomHeader';

type GameViewProps = {
    auth: AuthResponse;
    onLeave?: () => void;
};

// ─── Inner component (has access to GameContext) ──────────────────────────────

function GameViewInner() {
    // ALL hooks must be called unconditionally at the top — no hooks after returns.
    const { gameState, loadingStatus, roomState, isHydrated, onLeave, gameEndResult, wsStatus } = useGameContext();

    const [raiseAmount, setRaiseAmount] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());

    // Table sizing, scale and seat layout are owned by LiveTableStage (measured stage).

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

    const { stompClientRef, transportRef } = useGameWebSocket({ onSocketError: handleSocketError });

    const publisherAdapter = useMemo(() => ({
        publish: (dest: string, body: string) => {
            if (transportRef.current) {
                transportRef.current.publish(dest, body);
            } else {
                stompClientRef.current?.publish({ destination: dest, body });
            }
        },
        isConnected: () => transportRef.current?.isConnected?.() ?? stompClientRef.current?.connected ?? false
    }), [transportRef, stompClientRef]);

    const dispatcher = useGameDispatcher(publisherAdapter);
    
    useEffect(() => {
        dispatcherRef.current = dispatcher;
    }, [dispatcher]);

    // ── Routing (no hooks below this line) ──────────────────────────────────────

    if (gameEndResult) {
        return <GameReviewView onLeave={() => dispatcher.dispatch({ type: 'LEAVE_REVIEW' })} />;
    }

    if (!isHydrated) {
        return <LoadingView status={loadingStatus} onLeave={onLeave} />;
    }

    if (!gameState) {
        // Show lobby if room is known but game hasn't started yet
        if (roomState && !roomState.gameStarted) {
            return (
                <PokerRoomLayout
                    header={
                        <RoomHeader
                            roomName={roomState?.roomName}
                            playerCount={roomState?.players?.length || 0}
                            wsStatus={wsStatus}
                            onLeave={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                            confirmLeaveMessage="Are you sure you want to leave the lobby?"
                        />
                    }
                    wsStatus={wsStatus}
                    onLeave={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                >
                    <RoomStage>
                        <GameLobbyView
                            onStartGame={() => dispatcher.dispatch({ type: 'START_GAME' })}
                            isStartingGame={dispatcher.isPending('START_GAME')}
                            onLeaveGame={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                        />
                    </RoomStage>
                </PokerRoomLayout>
            );
        }
        // Show loading spinner while connecting / hydrating
        return (
            <PokerRoomLayout
                header={
                    <RoomHeader
                        roomName={roomState?.roomName}
                        playerCount={0}
                        wsStatus={wsStatus}
                        onLeave={onLeave}
                        confirmLeave={false}
                    />
                }
                wsStatus={wsStatus}
                onLeave={onLeave}
            >
                <RoomStage>
                    <LoadingView status={loadingStatus} />
                </RoomStage>
            </PokerRoomLayout>
        );
    }

    // ── Active game table ───────────────────────────────────────────────────────
    return (
        <PokerRoomLayout
            header={
                <RoomHeader
                    roomName={roomState?.roomName}
                    playerCount={gameState.players.length}
                    wsStatus={wsStatus}
                    onLeave={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                />
            }
            wsStatus={wsStatus}
            onLeave={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
        >
            <GameTableView
                nowMs={nowMs}
                raiseAmount={raiseAmount}
                raiseError={dispatcher.error?.message ?? null}
                onAction={(action, amount) => dispatcher.dispatch({ type: 'PLAY_ACTION', action, amount })}
                onReady={() => dispatcher.dispatch({ type: 'READY' })}
                onUnready={() => dispatcher.dispatch({ type: 'UNREADY' })}
                onClaimWin={() => dispatcher.dispatch({ type: 'CLAIM_WIN' })}
                onLeaveGame={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                onRaiseChange={(val) => {
                    setRaiseAmount(val);
                    dispatcher.clearError();
                }}
                isActionPending={dispatcher.isPending('PLAY_ACTION') || dispatcher.isPending('READY') || dispatcher.isPending('START_GAME') || dispatcher.isPending('CLAIM_WIN') || dispatcher.isPending('LEAVE_GAME')}
                hasShellHeader={true}
            />
        </PokerRoomLayout>
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
