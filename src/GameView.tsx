import { useState, useEffect } from 'react';
import type { AuthResponse } from './types';
import type { GameSession } from './domain/GameSession';
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
    session?: GameSession;
};

// ─── Inner component (connects to GameSession / GameContext) ──────────────────

function GameViewInner() {
    const {
        auth,
        onLeave,
        gameState,
        roomState,
        privateState,
        showdown,
        showdownResult,
        notification,
        loadingStatus,
        myPlayerId,
        claimPending,
        wsStatus,
        isHydrated,
        gameEndResult,
        recoveryFailed,
        retryConnection,
    } = useGameContext();

    const [nowMs, setNowMs] = useState(() => Date.now());

    // Table sizing, scale and seat layout are owned by LiveTableStage (measured stage).

    // ── Disconnect countdown clock ──────────────────────────────────────────────
    const hasDisconnectedPlayer = Boolean(gameState?.players?.some(p => p.status === 'DISCONNECTED'));
    const hasReadyCountdown = gameState?.phase === 'SHOWDOWN' && Boolean(gameState?.isReadyCountdownActive);

    useEffect(() => {
        if (!hasDisconnectedPlayer && !hasReadyCountdown) return;

        const update = () => setNowMs(Date.now());
        update();
        const id = window.setInterval(update, 1000);
        return () => window.clearInterval(id);
    }, [hasDisconnectedPlayer, hasReadyCountdown]);

    // ── Session hydration ───────────────────────────────────────────────────────
    useSessionHydration();

    // ── WebSocket & Dispatcher ──────────────────────────────────────────────────
    useGameWebSocket();
    const dispatcher = useGameDispatcher();

    // ── Routing (no hooks below this line) ──────────────────────────────────────

    if (gameEndResult) {
        return (
            <GameReviewView
                gameEndResult={gameEndResult}
                gameState={gameState}
                onLeave={() => dispatcher.dispatch({ type: 'LEAVE_REVIEW' })}
            />
        );
    }

    if (!isHydrated) {
        return <LoadingView status={loadingStatus} onRetry={recoveryFailed ? retryConnection : undefined} onLeave={onLeave} />;
    }

    if (!gameState || !roomState) {
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
                            roomState={roomState}
                            playerName={auth.playerName}
                            auth={auth}
                            notification={notification}
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
                showReconnectOverlay={false}
                onLeave={onLeave}
            >
                <RoomStage>
                    <LoadingView status={loadingStatus} onRetry={recoveryFailed ? retryConnection : undefined} />
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
                gameState={gameState}
                roomState={roomState}
                auth={auth}
                playerName={auth.playerName}
                myPlayerId={myPlayerId}
                privateState={privateState}
                showdown={showdown}
                showdownResult={showdownResult}
                claimPending={claimPending}
                notification={notification}
                wsStatus={wsStatus}
                nowMs={nowMs}
                raiseError={dispatcher.error?.message ?? null}
                onAction={(action, amount) => dispatcher.dispatch({ type: 'PLAY_ACTION', action, amount })}
                onReady={() => dispatcher.dispatch({ type: 'READY' })}
                onUnready={() => dispatcher.dispatch({ type: 'UNREADY' })}
                onClaimWin={() => dispatcher.dispatch({ type: 'CLAIM_WIN' })}
                onLeaveGame={() => dispatcher.dispatch({ type: 'LEAVE_GAME' })}
                onClearRaiseError={() => dispatcher.clearError()}
                isActionPending={dispatcher.isPending('PLAY_ACTION') || dispatcher.isPending('READY') || dispatcher.isPending('UNREADY') || dispatcher.isPending('START_GAME') || dispatcher.isPending('CLAIM_WIN') || dispatcher.isPending('LEAVE_GAME')}
                hasShellHeader={true}
            />
        </PokerRoomLayout>
    );
}

// ─── Public export ─────────────────────────────────────────────────────────────

export function GameView({ auth, onLeave, session }: GameViewProps) {
    return (
        <GameProvider auth={auth} onLeave={onLeave} session={session}>
            <GameViewInner />
        </GameProvider>
    );
}

export default GameView;
