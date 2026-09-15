/** Injectable clock for match queue, disconnect grace, and bot auto-play. */
export interface MatchClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const defaultMatchClock: MatchClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Deterministic clock for tests — advance with `tick(ms)`. */
export function createFakeClock(startMs = 0): MatchClock & {
  tick: (ms: number) => void;
} {
  let now = startMs;
  let nextId = 1;
  const timers = new Map<number, { due: number; fn: () => void }>();

  const api = {
    now: () => now,
    setTimeout(fn: () => void, ms: number): unknown {
      const id = nextId++;
      timers.set(id, { due: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(handle: unknown): void {
      timers.delete(handle as number);
    },
    tick(ms: number): void {
      now += Math.max(0, ms);
      // Drain cascading timers scheduled at/before `now` (e.g. bot turn setTimeout(0)).
      for (let safety = 0; safety < 1000; safety += 1) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.due <= now)
          .sort((a, b) => a[1].due - b[1].due);
        if (due.length === 0) break;
        for (const [id, t] of due) {
          if (!timers.has(id)) continue;
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
  return api;
}

/** Prefer humans; after this wait, silently fill remaining seats with Bots. */
export const MATCH_BOT_FILL_MS = 60_000;
