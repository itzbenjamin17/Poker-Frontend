import React, { createContext, useState, useEffect, useContext } from 'react';
import { cn } from '../lib/cn';
import { Button } from './UI';
import { RotatePrompt } from './RotatePrompt';
import { GameContext } from '../context/GameContext';
import { BTN_RETRY_CONNECTION, STATUS_RECOVERING_TABLE } from '../constants/strings';
import type { WsStatus } from '../types';

export { RotatePrompt } from './RotatePrompt';

export interface RoomStageProps {
    children: React.ReactNode;
    className?: string;
}

export function RoomStage({ children, className }: RoomStageProps) {
    return (
        <section
            aria-label="Room stage"
            data-testid="room-stage"
            className={cn(
                'relative isolate flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden',
                className
            )}
        >
            {children}
        </section>
    );
}

export interface RoomDockProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    className?: string;
}

export function RoomDock({ children, className, ...rest }: RoomDockProps) {
    return (
        <section
            aria-label="Room dock"
            data-testid="room-dock"
            className={cn('shrink-0 w-full min-h-16 overflow-visible', className)}
            {...rest}
        >
            {children}
        </section>
    );
}

export const MIN_PORTRAIT_WIDTH = 600;
export const MIN_PORTRAIT_HEIGHT = 800;
export const MIN_DESKTOP_HEIGHT = 600; // Increased pragmatically
export const MIN_MOBILE_WIDTH = 667; // Increased pragmatically (iPhone SE landscape floor)
// Short landscape screens use corner chrome, giving the table the full viewport. 265px fits a 10-seat table
// down to an iPhone 12/13 mini in Safari with the tab bar showing (about 712x265).
export const MIN_MOBILE_HEIGHT = 265;

// eslint-disable-next-line react-refresh/only-export-components
export function useOrientationGating() {
    const [dimensions, setDimensions] = useState(() => ({
        width: typeof window !== 'undefined' ? window.innerWidth : 1024,
        height: typeof window !== 'undefined' ? window.innerHeight : 768,
    }));

    useEffect(() => {
        const handleResize = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const isPortrait = dimensions.height > dimensions.width;
    
    // Portrait gate (phones and short squarish windows)
    const isGatedPortrait = isPortrait && (
        dimensions.width < MIN_PORTRAIT_WIDTH || dimensions.height < MIN_PORTRAIT_HEIGHT
    );
    
    // Landscape/Desktop gates
    const isGatedDesktopHeight = dimensions.width >= 1024 && dimensions.height < MIN_DESKTOP_HEIGHT;
    const isGatedMobile = !isPortrait && dimensions.width < 1024 && (
        dimensions.width < MIN_MOBILE_WIDTH || dimensions.height < MIN_MOBILE_HEIGHT
    );

    const isGated = isGatedPortrait || isGatedDesktopHeight || isGatedMobile;
    const isMobileLandscape = !isPortrait && dimensions.height < 500;
    // Phones in landscape have limited height and width: chrome moves into the corners outside the oval felt.
    const isCornerChrome = isMobileLandscape;
    const isCompactViewport = dimensions.width < 960 || dimensions.height < 640;

    return {
        dimensions,
        isPortrait,
        isBelowWidth: isGatedPortrait,
        isGated,
        isMobileLandscape,
        isCornerChrome,
        isCompactViewport,
    };
}

/**
 * Whether the reconnect overlay is up. In the corner-chrome layout the shell does not freeze its whole content,
 * because the corner header (with Leave) must stay usable; the table view freezes everything else instead.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const RoomShellContext = createContext<{ isContentFrozen: boolean }>({ isContentFrozen: false });

export interface PokerRoomLayoutProps {
    header?: React.ReactNode;
    stage?: React.ReactNode;
    dock?: React.ReactNode;
    children?: React.ReactNode;
    wsStatus?: WsStatus;
    isReconnecting?: boolean;
    isRecovering?: boolean;
    recoveryFailed?: boolean;
    onRetryConnection?: () => void;
    showReconnectOverlay?: boolean;
    isCompact?: boolean;
    forceOrientation?: 'portrait' | 'landscape';
    /** The content overlays its own corner header and freezes its own non-header parts during a reconnect. */
    cornerChrome?: boolean;
    className?: string;
    onLeave?: () => void;
}

export interface ReconnectOverlayProps {
    recoveryFailed?: boolean;
    onRetry?: () => void;
    role?: 'status' | 'alert';
    className?: string;
}

export function ReconnectOverlay({
    recoveryFailed = false,
    onRetry,
    role = 'status',
    className,
}: ReconnectOverlayProps) {
    return (
        <div
            className={cn(
                'absolute inset-0 bg-surface/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center gap-4 text-center pointer-events-auto',
                className,
            )}
            role={role}
            aria-live="assertive"
        >
            <div
                className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
            />
            <h2 className="font-headline text-2xl font-bold text-white tracking-tight">
                Connection lost
            </h2>
            <p className="text-zinc-400 text-sm uppercase tracking-widest animate-pulse motion-reduce:animate-none">
                {STATUS_RECOVERING_TABLE}
            </p>
            {recoveryFailed && onRetry && (
                <Button variant="primary" size="sm" onClick={onRetry}>
                    {BTN_RETRY_CONNECTION}
                </Button>
            )}
        </div>
    );
}

export function PokerRoomLayout({
    header,
    stage,
    dock,
    children,
    wsStatus,
    isReconnecting,
    isRecovering,
    recoveryFailed,
    onRetryConnection,
    showReconnectOverlay = true,
    forceOrientation,
    cornerChrome = false,
    className,
    onLeave,
}: PokerRoomLayoutProps) {
    const gameContext = useContext(GameContext);
    const { isGated } = useOrientationGating();

    const effectiveWsStatus = wsStatus ?? gameContext?.wsStatus ?? 'connected';
    const effectiveIsRecovering = isRecovering ?? gameContext?.isRecovering ?? false;
    const effectiveRecoveryFailed = recoveryFailed ?? gameContext?.recoveryFailed ?? false;
    const effectiveOnRetry = onRetryConnection ?? gameContext?.retryConnection;
    const isDisconnectedOrReconnecting =
        isReconnecting ?? (effectiveWsStatus !== 'connected');
    const shouldShowOverlay =
        showReconnectOverlay &&
        (isDisconnectedOrReconnecting || effectiveIsRecovering || effectiveRecoveryFailed);

    const gated =
        forceOrientation === 'portrait'
            ? true
            : forceOrientation === 'landscape'
            ? false
            : isGated;

    // Orientation Gating: Portrait below the supported breakpoint renders ONLY the rotate prompt
    if (gated) {
        return <RotatePrompt onLeave={onLeave} />;
    }

    return (
        <div
            data-testid="poker-room-layout"
            className={cn(
                'isolate flex h-dvh w-full max-w-full flex-col relative overflow-hidden overscroll-none bg-surface',
                'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
                className
            )}
        >
            {/* Reconnect overlay owned by the shell (below header with z-30, header has z-40) */}
            {shouldShowOverlay && (
                <ReconnectOverlay
                    recoveryFailed={effectiveRecoveryFailed}
                    onRetry={effectiveOnRetry}
                />
            )}

            {/* Region 1: Fixed Header Region */}
            {header}

            {/* Region 2 & 3: Flexible Stage Region & Bounded Dock Region */}
            <div
                className="flex flex-1 min-h-0 min-w-0 flex-col"
                inert={shouldShowOverlay && !cornerChrome}
            >
                <RoomShellContext.Provider value={{ isContentFrozen: shouldShowOverlay }}>
                    {stage || dock ? (
                        <>
                            {stage}
                            {dock}
                        </>
                    ) : (
                        children
                    )}
                </RoomShellContext.Provider>
            </div>
        </div>
    );
}

