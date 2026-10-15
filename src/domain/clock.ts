export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface Clock {
    now(): number;
    setTimeout(callback: () => void, ms: number): TimerHandle;
    clearTimeout(id: TimerHandle): void;
    setInterval?(callback: () => void, ms: number): TimerHandle;
    clearInterval?(id: TimerHandle): void;
}

export class SystemClock implements Clock {
    now(): number {
        return Date.now();
    }

    setTimeout(callback: () => void, ms: number): TimerHandle {
        return setTimeout(callback, ms);
    }

    clearTimeout(id: TimerHandle): void {
        clearTimeout(id as ReturnType<typeof setTimeout>);
    }

    setInterval(callback: () => void, ms: number): TimerHandle {
        return setInterval(callback, ms);
    }

    clearInterval(id: TimerHandle): void {
        clearInterval(id as ReturnType<typeof setInterval>);
    }
}

interface ScheduledTimer {
    id: number;
    dueTime: number;
    callback: () => void;
    repeatMs?: number;
}

export class TestClock implements Clock {
    private currentTime: number;
    private nextId = 1;
    private timers = new Map<number, ScheduledTimer>();

    constructor(initialTime = 0) {
        this.currentTime = initialTime;
    }

    now(): number {
        return this.currentTime;
    }

    setTimeout(callback: () => void, ms: number): number {
        if (!Number.isFinite(ms)) throw new RangeError('Timeout delay must be finite');
        ms = Math.max(0, ms);
        const id = this.nextId++;
        this.timers.set(id, {
            id,
            dueTime: this.currentTime + ms,
            callback,
        });
        return id;
    }

    clearTimeout(id: number | TimerHandle): void {
        this.timers.delete(id as number);
    }

    setInterval(callback: () => void, ms: number): number {
        if (!Number.isFinite(ms)) throw new RangeError('Interval delay must be finite');
        ms = Math.max(1, ms);
        const id = this.nextId++;
        this.timers.set(id, {
            id,
            dueTime: this.currentTime + ms,
            callback,
            repeatMs: ms,
        });
        return id;
    }

    clearInterval(id: number | TimerHandle): void {
        this.timers.delete(id as number);
    }

    tick(ms: number): void {
        if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Tick must be finite and nonnegative');
        const targetTime = this.currentTime + ms;
        while (true) {
            let earliest: ScheduledTimer | null = null;
            for (const timer of this.timers.values()) {
                if (timer.dueTime <= targetTime) {
                    if (
                        !earliest ||
                        timer.dueTime < earliest.dueTime ||
                        (timer.dueTime === earliest.dueTime && timer.id < earliest.id)
                    ) {
                        earliest = timer;
                    }
                }
            }
            if (!earliest) break;

            this.currentTime = earliest.dueTime;
            if (earliest.repeatMs !== undefined) {
                earliest.dueTime = this.currentTime + earliest.repeatMs;
            } else {
                this.timers.delete(earliest.id);
            }
            earliest.callback();
        }
        this.currentTime = targetTime;
    }
}
