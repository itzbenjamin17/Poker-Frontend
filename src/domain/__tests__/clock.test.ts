// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SystemClock, TestClock, type Clock } from '../clock';

describe('Clock abstractions', () => {
    describe('TestClock', () => {
        it('starts at specified initial time or zero', () => {
            const clock1 = new TestClock();
            expect(clock1.now()).toBe(0);

            const clock2 = new TestClock(1000);
            expect(clock2.now()).toBe(1000);
        });

        it('schedules and executes timeouts when ticked', () => {
            const clock = new TestClock(500);
            const fn1 = vi.fn();
            const fn2 = vi.fn();

            clock.setTimeout(fn1, 100);
            clock.setTimeout(fn2, 200);

            clock.tick(50);
            expect(clock.now()).toBe(550);
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).not.toHaveBeenCalled();

            clock.tick(50);
            expect(clock.now()).toBe(600);
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).not.toHaveBeenCalled();

            clock.tick(100);
            expect(clock.now()).toBe(700);
            expect(fn2).toHaveBeenCalledTimes(1);
        });

        it('allows clearing scheduled timeouts before they execute', () => {
            const clock = new TestClock();
            const fn = vi.fn();

            const timerId = clock.setTimeout(fn, 100);
            clock.clearTimeout(timerId);

            clock.tick(200);
            expect(fn).not.toHaveBeenCalled();
        });

        it('executes multiple timers in chronological order', () => {
            const clock = new TestClock();
            const order: number[] = [];

            clock.setTimeout(() => order.push(2), 200);
            clock.setTimeout(() => order.push(1), 100);
            clock.setTimeout(() => order.push(3), 300);

            clock.tick(300);
            expect(order).toEqual([1, 2, 3]);
        });

        it('supports repeating intervals', () => {
            const clock = new TestClock();
            const fn = vi.fn();

            const id = clock.setInterval(fn, 50);
            clock.tick(120);
            expect(fn).toHaveBeenCalledTimes(2);

            clock.clearInterval(id);
            clock.tick(100);
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('handles timers scheduled inside timer callbacks during same tick', () => {
            const clock = new TestClock();
            const order: string[] = [];

            clock.setTimeout(() => {
                order.push('first');
                clock.setTimeout(() => {
                    order.push('nested');
                }, 50);
            }, 100);

            clock.tick(160);
            expect(order).toEqual(['first', 'nested']);
        });
    });

    describe('SystemClock', () => {
        it('implements Clock interface using real system time', () => {
            const clock: Clock = new SystemClock();
            const before = Date.now();
            const clockNow = clock.now();
            const after = Date.now();

            expect(clockNow).toBeGreaterThanOrEqual(before);
            expect(clockNow).toBeLessThanOrEqual(after);
        });
    });
});
