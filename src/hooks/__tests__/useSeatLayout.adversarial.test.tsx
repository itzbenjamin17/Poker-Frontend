import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSeatLayout } from '../useSeatLayout';
import { SCALE_FLOOR, placeOpponentSeat } from '../../lib/tableGeometry';
import { HeroSeat } from '../../components/HeroSeat';
import { LiveTableStage } from '../../components/LiveTableStage';
import type { Player, GameState } from '../../types';
import '@testing-library/jest-dom';

const STANDARD = { width: 900, height: 419 };

describe('Adversarial Verification: useSeatLayout & Geometry Decoupling', () => {
    // 1. HeroSeat Fixed Pinning
    describe('1. HeroSeat Layout Anchor Pinning (50%, 86%)', () => {
        const dummyPlayer: Player = {
            id: 'p-hero',
            name: 'HeroPlayer',
            chips: 5000,
            status: 'ACTIVE',
            currentBet: 0,
            hasFolded: false,
            isReadyForNextHand: false,
        };

        it('HeroSeat renders strictly at style left: 50%, top: 86% for any scale and density flag', () => {
            for (const scale of [0.4, 0.8, 1, 1.15]) {
                for (const isCompactTable of [true, false]) {
                    const { unmount } = render(
                        <HeroSeat
                            player={dummyPlayer}
                            isCompactTable={isCompactTable}
                            nowMs={Date.now()}
                            tableScale={{ overall: scale, avatar: scale, heroCard: scale, opponentCard: scale, text: scale, badge: scale, spacing: scale }}
                        />
                    );

                    const heroEl = screen.getByTestId('hero-seat');
                    expect(heroEl).toBeInTheDocument();
                    expect(heroEl.style.left).toBe('50%');
                    expect(heroEl.style.top).toBe('86%');

                    unmount();
                }
            }
        });

        it('LiveTableStage renders HeroSeat at (50%, 86%) across all player counts (2-10) and hero positions', () => {
            let view: ReturnType<typeof render> | null = null;
            for (let total = 2; total <= 10; total++) {
                const players: Player[] = Array.from({ length: total }, (_, i) => ({
                    id: `p-${i}`,
                    name: `Player_${i}`,
                    chips: 1000,
                    status: 'ACTIVE',
                    currentBet: 0,
                    hasFolded: false,
                    isReadyForNextHand: false,
                }));

                const mockGameState: GameState = {
                    gameId: 'test-game',
                    phase: 'PRE_FLOP',
                    pot: 100,
                    communityCards: [],
                    currentPlayerId: 'p-0',
                    currentPlayerName: 'Player_0',
                    currentBet: 0,
                    maxPlayers: total,
                    players,
                };

                for (let hIdx = 0; hIdx < total; hIdx++) {
                    const ui = (
                        <LiveTableStage
                            nowMs={Date.now()}
                            gameState={mockGameState}
                            orderedPlayers={players}
                            myPlayerId={`p-${hIdx}`}
                        />
                    );
                    if (!view) {
                        view = render(ui);
                    } else {
                        view.rerender(ui);
                    }

                    const heroEl = screen.getByTestId('hero-seat');
                    expect(heroEl).toBeInTheDocument();
                    if (total === 2 && hIdx === 0) {
                        expect(heroEl).toHaveAccessibleName(`Player_${hIdx} hero seat`);
                    } else {
                        expect(heroEl).toHaveAttribute('aria-label', `Player_${hIdx} hero seat`);
                    }
                    expect(heroEl.style.left).toBe('50%');
                    expect(heroEl.style.top).toBe('86%');
                    expect(screen.getAllByTestId(/^opponent-seat-/)).toHaveLength(total - 1);
                }
            }
            view?.unmount();
        });
    });

    // 2. Ellipse Geometry Bounds Across 2-10 Players
    describe('2. Ellipse Geometry Bounds (2 through 10 players)', () => {
        it('keeps all opponent seats inside the sanity bound [2, 98] x [2, 80] (it never engages) and cards facing inwards (or below, top centre)', () => {
            for (let total = 2; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(STANDARD, total));
                for (let heroIndex = 0; heroIndex < total; heroIndex++) {
                    for (let seatIdx = 0; seatIdx < total; seatIdx++) {
                        const pos = result.current.getSeatPosition(seatIdx, total, heroIndex);

                        expect(pos.left).toBeGreaterThanOrEqual(2);
                        expect(pos.left).toBeLessThanOrEqual(98);
                        expect(pos.top).toBeGreaterThanOrEqual(2);
                        if (seatIdx !== heroIndex) {
                            expect(pos.top).toBeLessThanOrEqual(80);
                            // The bound never engages: the seat is exactly where the fitted ellipse puts it.
                            const hasHero = heroIndex >= 0 && heroIndex < total;
                            const opponentIndex = (seatIdx - heroIndex - 1 + total) % total;
                            const placed = placeOpponentSeat(opponentIndex, hasHero ? total - 1 : total, result.current.getSeatEllipse(total, heroIndex));
                            expect({ left: pos.left, top: pos.top }).toEqual(placed);
                        }

                        if (pos.cardPlacement === 'below') {
                            expect(Math.abs(pos.left - 50)).toBeLessThanOrEqual(14);
                            expect(pos.top).toBeLessThan(35);
                        } else if (pos.left <= 50) {
                            expect(pos.cardPlacement).toBe('right');
                        } else {
                            expect(pos.cardPlacement).toBe('left');
                        }
                    }
                }
            }
        });
    });

    // 3. Clockwise Turn-Order Monotonicity & Symmetry
    describe('3. Turn-Order Clockwise Monotonicity & Symmetry', () => {
        it('verifies turn order progresses strictly clockwise around the table for 3 through 10 players', () => {
            for (let total = 3; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(STANDARD, total));
                for (let heroIndex = 0; heroIndex < total; heroIndex++) {
                    for (let step = 0; step < total; step++) {
                        const currentIdx = (heroIndex + step) % total;
                        const nextIdx = (heroIndex + step + 1) % total;

                        const currentPos = result.current.getSeatPosition(currentIdx, total, heroIndex);
                        const nextPos = result.current.getSeatPosition(nextIdx, total, heroIndex);

                        // In screen coordinates (+x right, +y down), clockwise gives a positive cross product
                        const vx1 = currentPos.left - 50;
                        const vy1 = currentPos.top - 50;
                        const vx2 = nextPos.left - 50;
                        const vy2 = nextPos.top - 50;

                        expect(vx1 * vy2 - vy1 * vx2).toBeGreaterThan(0);
                    }
                }
            }
        });

        it('verifies bilateral symmetry across the vertical centre line for hero at index 0', () => {
            for (let total = 2; total <= 10; total++) {
                const { result } = renderHook(() => useSeatLayout(STANDARD, total));

                for (let k = 1; k < total; k++) {
                    const mirrorK = total - k;
                    const pos = result.current.getSeatPosition(k, total, 0);
                    const mirrorPos = result.current.getSeatPosition(mirrorK, total, 0);

                    expect(Math.abs(pos.left + mirrorPos.left - 100)).toBeLessThanOrEqual(0.2);
                    expect(Math.abs(pos.top - mirrorPos.top)).toBeLessThanOrEqual(0.2);

                    if (pos.cardPlacement === 'below') {
                        expect(mirrorPos.cardPlacement).toBe('below');
                    } else if (pos.left < 50) {
                        expect(pos.cardPlacement).toBe('right');
                        expect(mirrorPos.cardPlacement).toBe('left');
                    } else if (pos.left > 50) {
                        expect(pos.cardPlacement).toBe('left');
                        expect(mirrorPos.cardPlacement).toBe('right');
                    }
                }
            }
        });

        it('heads-up (2 players) sits directly opposite along the vertical centreline', () => {
            const { result } = renderHook(() => useSeatLayout(STANDARD, 2));

            expect(result.current.getSeatPosition(0, 2, 0)).toMatchObject({ left: 50, top: 86 });
            // The heads-up opponent sits at the top of the fitted ellipse (it used to be the constant 12).
            const ellipse = result.current.getSeatEllipse(2, 0);
            const pos = result.current.getSeatPosition(1, 2, 0);
            expect(pos.left).toBe(50);
            expect(pos.top).toBeCloseTo(ellipse.cy - ellipse.ry, 1);
        });

        it('even player counts have the opponent directly across from the hero at the top of the ellipse', () => {
            for (const total of [4, 6, 8, 10]) {
                const { result } = renderHook(() => useSeatLayout(STANDARD, total));
                const acrossPos = result.current.getSeatPosition(total / 2, total, 0);

                expect(acrossPos.left).toBe(50);
                // the top of the fitted ellipse: centre-y minus radius-y
                const ellipse = result.current.getSeatEllipse(total, 0);
                expect(acrossPos.top).toBeCloseTo(ellipse.cy - ellipse.ry, 1);
            }
        });
    });

    // 4. Adversarial Input Stress
    describe('4. Adversarial Input Robustness', () => {
        it('treats the hero index as hero even for degenerate player counts', () => {
            const { result } = renderHook(() => useSeatLayout(STANDARD, 1));

            expect(result.current.getSeatPosition(0, 1, 0)).toMatchObject({ left: 50, top: 86 });
            expect(result.current.getSeatPosition(0, 0, 0)).toMatchObject({ left: 50, top: 86 });
            expect(result.current.getSeatPosition(-1, -5, -1)).toMatchObject({ left: 50, top: 86 });
        });

        it('treats everyone as an opponent when the hero is missing or out of range', () => {
            const { result } = renderHook(() => useSeatLayout(STANDARD, 6));

            const seats = Array.from({ length: 6 }, (_, i) => result.current.getSeatPosition(i, 6, -1));
            for (const seat of seats) {
                expect(seat.top).toBeLessThanOrEqual(72);
            }
            expect(new Set(seats.map((s) => `${s.left}/${s.top}`)).size).toBe(6);

            expect(result.current.getSeatPosition(100, 6, 100)).toMatchObject({ left: 50, top: 86 });
            expect(result.current.getSeatPosition(2, 6, 100).top).toBeLessThanOrEqual(72);
        });

        it('handles extreme table dimensions without invalid scale or coordinate errors', () => {
            const extremeDimensions = [
                { width: 100, height: 100 },
                { width: 4000, height: 500 },
                { width: 500, height: 4000 },
                { width: 0, height: 0 },
            ];

            for (const dim of extremeDimensions) {
                const { result } = renderHook(() => useSeatLayout(dim, 6));
                expect(result.current.scale).toBeGreaterThanOrEqual(SCALE_FLOOR);
                expect(result.current.scale).toBeLessThanOrEqual(1.15);

                const pos = result.current.getSeatPosition(1, 6, 0);
                expect(pos.left).toBeGreaterThanOrEqual(2);
                expect(pos.left).toBeLessThanOrEqual(98);
                expect(pos.top).toBeGreaterThanOrEqual(2);
                expect(pos.top).toBeLessThanOrEqual(80);
                expect(Number.isFinite(pos.left) && Number.isFinite(pos.top)).toBe(true);
            }
        });
    });
});
