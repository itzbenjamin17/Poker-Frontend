import type {
    AuthResponse,
    GameEndResult,
    PrivatePlayerState,
    PublicGameStateResponse,
    RoomDataResponse,
    RoomState,
} from '../types';
import {
    decodeGameEndResult,
    decodePrivatePlayerState,
    decodePublicGameState,
    decodeRoomDataResponse,
    getErrorStatusCode,
    mapRoomDataToRoomState,
    reportRejectedGameSnapshot,
    validatePrivatePlayerIdentity,
} from '../lib/payloads';
import { HttpError, MalformedResponseError, pokerApi } from '../services/api';
import { SESSION_EXPIRED, SESSION_SEAT_GONE } from '../constants/strings';

export type SyncResult =
    | { type: 'LOBBY'; room: RoomState }
    | {
          type: 'LIVE';
          room?: RoomState;
          publicState: PublicGameStateResponse;
          privateState: PrivatePlayerState;
      }
    | { type: 'TERMINAL'; review: GameEndResult };

export interface SessionSyncDeps {
    auth: AuthResponse;
    isStarted: () => boolean;
    isHydrated: () => boolean;
    signal: AbortSignal;
    pokerApi?: typeof pokerApi;
}

function receivedType(value: unknown): string {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

export async function loadSessionData(deps: SessionSyncDeps): Promise<SyncResult> {
    const api = deps.pokerApi ?? pokerApi;
    const { auth, isStarted, isHydrated, signal } = deps;

    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    let roomData: RoomDataResponse | null = null;
    let roomState: RoomState | undefined = undefined;

    // 1. Fetch Room when the session is still believed to be in the lobby (!session.isStarted())
    const shouldFetchRoom = !isStarted();
    if (shouldFetchRoom) {
        let roomRaw: unknown;
        try {
            roomRaw = typeof api.getRoomData === 'function'
                ? await api.getRoomData(auth.roomId, auth.token, signal)
                : typeof api.getRoomInfo === 'function'
                ? await api.getRoomInfo(auth.roomId, auth.token)
                : await Promise.reject(new Error('api.getRoomInfo is not a function'));
        } catch (err) {
            if (signal.aborted) throw err;
            const status = getErrorStatusCode(err);
            if (status === 403 || status === 404) {
                return handleReviewFallback(api, auth, status, signal);
            }
            throw err;
        }

        // 2. Validate Room before checking membership (decodeRoomDataResponse)
        const decodedRoom = decodeRoomDataResponse(roomRaw);
        if (!decodedRoom) {
            throw new MalformedResponseError(receivedType(roomRaw));
        }
        roomData = decodedRoom;
        roomState = mapRoomDataToRoomState(roomData, auth.roomId);

        // Valid current Room membership excluding hero triggers seat-gone handling during hydration, lobby recovery, and PLAYER_LEFT.
        const playerStillInRoom =
            Array.isArray(roomData.players) &&
            roomData.players.some((p) => p && p.name === auth.playerName);

        if (!playerStillInRoom) {
            throw new HttpError(403, SESSION_SEAT_GONE);
        }
    }

    const gameStarted = isStarted() || (roomData ? Boolean(roomData.gameStarted) : false);
    if (!gameStarted) {
        if (!roomState) {
            throw new Error('Lobby sync without room state');
        }
        return { type: 'LOBBY', room: roomState };
    }

    // 3. If started, fetch public and private state concurrently
    let publicRaw: unknown;
    let privateRaw: unknown;
    try {
        const fetchPublic = typeof api.getPublicGameState === 'function'
            ? api.getPublicGameState(auth.roomId, auth.token, signal)
            : typeof api.getGameState === 'function'
            ? api.getGameState(auth.roomId, auth.token)
            : Promise.reject(new Error('api.getGameState is not a function'));
        const fetchPrivate = typeof api.getPrivatePlayerState === 'function'
            ? api.getPrivatePlayerState(auth.roomId, auth.token, signal)
            : typeof api.getPrivateState === 'function'
            ? api.getPrivateState(auth.roomId, auth.token)
            : Promise.reject(new Error('api.getPrivateState is not a function'));
        [publicRaw, privateRaw] = await Promise.all([fetchPublic, fetchPrivate]);
    } catch (err) {
        if (signal.aborted) throw err;
        const status = getErrorStatusCode(err);
        if (status === 403 || status === 404) {
            return handleReviewFallback(api, auth, status, signal);
        }
        if (err instanceof MalformedResponseError) {
            const snapshotSource = isHydrated() ? 'REST recovery game snapshot' : 'initial REST game snapshot';
            reportRejectedGameSnapshot(snapshotSource, {
                path: '$',
                expected: 'object',
                receivedType: err.receivedType,
            });
        }
        throw err;
    }

    // 4. Validate both responses and their hand/player identity
    const snapshotSource = isHydrated() ? 'REST recovery game snapshot' : 'initial REST game snapshot';
    const publicState = decodePublicGameState(publicRaw, snapshotSource);
    if (!publicState) {
        throw new MalformedResponseError(receivedType(publicRaw));
    }

    const rawToDecode =
        typeof privateRaw === 'object' &&
        privateRaw !== null &&
        !Array.isArray(privateRaw) &&
        (privateRaw as Record<string, unknown>).handNumber === undefined &&
        typeof (privateRaw as Record<string, unknown>).playerId === 'string'
            ? { ...(privateRaw as Record<string, unknown>), handNumber: publicState.handNumber ?? 0 }
            : privateRaw;

    const privateState = decodePrivatePlayerState(rawToDecode);
    if (!privateState) {
        throw new MalformedResponseError(receivedType(privateRaw));
    }

    if (publicState.handNumber === undefined) {
        publicState.handNumber = 0;
    }

    // handNumber equality
    if (publicState.handNumber !== privateState.handNumber) {
        throw new MalformedResponseError('REST public and private hand numbers differ');
    }

    // validatePrivatePlayerIdentity
    if (!validatePrivatePlayerIdentity(privateState, publicState, auth.playerName)) {
        throw new MalformedResponseError('Private player identity mismatch');
    }

    return {
        type: 'LIVE',
        room: roomState,
        publicState,
        privateState,
    };
}

async function handleReviewFallback(
    api: typeof pokerApi,
    auth: AuthResponse,
    originalStatus: number,
    signal: AbortSignal
): Promise<SyncResult> {
    if (typeof api.getReview !== 'function') {
        if (originalStatus === 403) {
            throw new HttpError(403, SESSION_SEAT_GONE);
        }
        throw new HttpError(404, SESSION_EXPIRED);
    }
    try {
        const reviewRaw = await api.getReview(auth.roomId, auth.token, signal);
        const review = decodeGameEndResult(reviewRaw, auth.roomId);
        if (!review) {
            throw new MalformedResponseError(receivedType(reviewRaw));
        }
        return { type: 'TERMINAL', review };
    } catch (reviewErr) {
        if (signal.aborted) throw reviewErr;
        const reviewStatus = getErrorStatusCode(reviewErr);
        if (reviewStatus === 403) {
            // Review HTTP 403 -> Seat-gone handling
            throw new HttpError(403, SESSION_SEAT_GONE);
        }
        if (reviewStatus === 404 || reviewStatus === 409) {
            // Review HTTP 409 or 404 -> Honor original failure: 403 means seat gone; 404 means session expired.
            if (originalStatus === 403) {
                throw new HttpError(403, SESSION_SEAT_GONE);
            }
            throw new HttpError(404, SESSION_EXPIRED);
        }
        // Network, timeout, 500, or MalformedResponseError from getReview
        throw reviewErr;
    }
}
