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
    onLeave?: (originatingToken?: string) => void;
    onRequestLeave?: (originatingToken?: string) => Promise<boolean>;
    leaveError?: string | null;
    session?: GameSession;
};

// ─── Inner component (connects to GameSession / GameContext) ──────────────────

function GameViewInner() {
    const {
        auth,
        leaveError,
        gameState,
        roomState,
        privateState,
        showdown,
        showdownResult,
        notification,
        notificationSequence,
        loadingStatus,
        myPlayerId,
        claimPending,
        wsStatus,
        isHydrated,
        gameEndResult,
        recoveryFailed,
        retryConnection,
        session,
        isLobbyInactivityWarningActive,
    } = useGameContext();

    const [nowMs, setNowMs] = useState(() => session?.displayNow() ?? Date.now());

    // Table sizing, scale and seat layout are owned by LiveTableStage (measured stage).

    // ── Disconnect countdown clock ──────────────────────────────────────────────
    const hasDisconnectedPlayer = Boolean(gameState?.players?.some(p => p.status === 'DISCONNECTED'));
    const hasReadyCountdown = gameState?.phase === 'SHOWDOWN' && Boolean(gameState?.isReadyCountdownActive);

    useEffect(() => {
        if (gameEndResult) return;
        if (!hasDisconnectedPlayer && !hasReadyCountdown) return;

        const update = () => setNowMs(session?.displayNow() ?? Date.now());
        update();
        const id = window.setInterval(update, 1000);
        return () => window.clearInterval(id);
    }, [hasDisconnectedPlayer, hasReadyCountdown, gameEndResult, session]);

    // ── Session hydration ───────────────────────────────────────────────────────
    const { initialLoadFailed, retryInitialLoad } = useSessionHydration();

    // ── WebSocket & Dispatcher ──────────────────────────────────────────────────
    useGameWebSocket();
    const dispatcher = useGameDispatcher();
    const handleLeaveRequest = () => {
        void dispatcher.dispatch({ type: 'LEAVE_GAME' });
    };

    // ── Routing (no hooks below this line) ──────────────────────────────────────

    if (gameEndResult && !dispatcher.isPending('LEAVE_GAME')) {
        return (
            <GameReviewView
                gameEndResult={gameEndResult}
                gameState={gameEndResult.finalState ?? gameState}
                leaveError={leaveError ?? notification}
                onRetryLeave={handleLeaveRequest}
                onLeave={() => dispatcher.dispatch({ type: 'LEAVE_REVIEW' })}
            />
        );
    }

    if (!isHydrated) {
        return <LoadingView status={loadingStatus} error={initialLoadFailed} onRetry={initialLoadFailed ? retryInitialLoad : recoveryFailed ? retryConnection : undefined} onLeave={handleLeaveRequest} errorMessage={leaveError} />;
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
                            onLeave={handleLeaveRequest}
                            confirmLeaveMessage="Are you sure you want to leave the lobby?"
                        />
                    }
                    wsStatus={wsStatus}
                    onLeave={handleLeaveRequest}
                >
                    <RoomStage>
                        <GameLobbyView
                            roomState={roomState}
                            playerName={auth.playerName}
                            auth={auth}
                            notification={leaveError ?? notification}
                            onStartGame={() => dispatcher.dispatch({ type: 'START_GAME' })}
                            isStartingGame={dispatcher.isPending('START_GAME')}
                            onLeaveGame={handleLeaveRequest}
                            isLobbyInactivityWarningActive={isLobbyInactivityWarningActive}
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
                        playerCount={roomState?.players?.length ?? 0}
                        wsStatus={wsStatus}
                        onLeave={handleLeaveRequest}
                        confirmLeave={false}
                    />
                }
                wsStatus={wsStatus}
                showReconnectOverlay={false}
                onLeave={handleLeaveRequest}
            >
                <RoomStage>
                    <LoadingView status={loadingStatus} onRetry={recoveryFailed ? retryConnection : undefined} onLeave={handleLeaveRequest} errorMessage={leaveError} />
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
                    onLeave={handleLeaveRequest}
                />
            }
            wsStatus={wsStatus}
            onLeave={handleLeaveRequest}
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
                notification={leaveError ?? notification}
                notificationSequence={notificationSequence}
                wsStatus={wsStatus}
                nowMs={nowMs}
                raiseError={null}
                actionError={dispatcher.error}
                onAction={(action, amount) => dispatcher.dispatch({ type: 'PLAY_ACTION', action, amount })}
                onReady={() => dispatcher.dispatch({ type: 'READY' })}
                onUnready={() => dispatcher.dispatch({ type: 'UNREADY' })}
                onClaimWin={() => dispatcher.dispatch({ type: 'CLAIM_WIN' })}
                onLeaveGame={handleLeaveRequest}
                onClearRaiseError={() => dispatcher.clearError()}
                isActionPending={dispatcher.isPending('PLAY_ACTION') || dispatcher.isPending('READY') || dispatcher.isPending('UNREADY') || dispatcher.isPending('START_GAME') || dispatcher.isPending('CLAIM_WIN') || dispatcher.isPending('LEAVE_GAME')}
                hasShellHeader={true}
            />
        </PokerRoomLayout>
    );
}

// ─── Public export ─────────────────────────────────────────────────────────────

export function GameView({ auth, onLeave, onRequestLeave, leaveError, session }: GameViewProps) {
    return (
        <GameProvider
            key={`${auth.roomId}:${auth.playerName}:${auth.token}`}
            auth={auth}
            onLeave={onLeave}
            requestLeave={onRequestLeave}
            leaveError={leaveError}
            session={session}
        >
            <GameViewInner />
        </GameProvider>
    );
}

export default GameView;
