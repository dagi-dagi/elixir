"use client";

import { useEffect, useState } from "react";

/**
 * Classic "trickle" loader (think NProgress). It only knows two events:
 *
 *  - start  → progress rises quickly, then slows down, approaching
 *             `LOADER_CEILING` asymptotically (it never gets there on its own)
 *  - finish → it jumps to 100% with a short ease-out animation
 *
 * The real amount poured is deliberately ignored; the pour views only need
 * "started" and "finished".
 */

/** Where the trickle levels off while waiting for the finish signal. */
export const LOADER_CEILING = 0.92;
/** Time constant of the trickle curve: ~63% of the ceiling after this long. */
export const LOADER_TIME_CONSTANT_MS = 6000;
/** Duration of the quick "fill to 100%" animation on finish. */
export const LOADER_FINISH_MS = 500;
/** How long the full state stays on screen before moving on. */
export const LOADER_FINISH_HOLD_MS = 500;
/** Total time the "finishing" phase lasts. */
export const LOADER_FINISHING_TOTAL_MS = LOADER_FINISH_MS + LOADER_FINISH_HOLD_MS;

const TICK_MS = 50;

export type LoaderState = "running" | "paused" | "finished";

/** Pour timing as tracked by the state machines (pauses excluded from the curve). */
export interface PourClock {
  startedAt: number;
  /** Total time spent paused so far. */
  pausedTotal: number;
  /** Set while currently paused. */
  pausedAt: number | null;
}

/** Trickle progress (0–ceiling) for a pour, at time `now`. Pure — usable from a canvas loop. */
export function trickleProgress(clock: PourClock, now = Date.now()) {
  const active = Math.max(0, (clock.pausedAt ?? now) - clock.startedAt - clock.pausedTotal);
  return LOADER_CEILING * (1 - Math.exp(-active / LOADER_TIME_CONSTANT_MS));
}

/**
 * Returns the loader's progress (0–1) and the CSS transition to animate it
 * with: a short linear one while trickling, a quick ease-out when finishing.
 */
export function useLoaderProgress(state: LoaderState, clock: PourClock) {
  const [trickle, setTrickle] = useState(0);
  const { startedAt, pausedTotal, pausedAt } = clock;

  // Progress is a function of active pour time (not time since mount), so the
  // kiosk and phone stay in step even if a view mounts late; paused time is excluded.
  useEffect(() => {
    if (state === "finished") return;
    const update = () => setTrickle(trickleProgress({ startedAt, pausedTotal, pausedAt }));
    if (state === "paused") {
      const once = setTimeout(update, 0); // frozen value, computed once
      return () => clearTimeout(once);
    }
    const id = setInterval(update, TICK_MS);
    return () => clearInterval(id);
  }, [state, startedAt, pausedTotal, pausedAt]);

  const finished = state === "finished";
  return {
    progress: finished ? 1 : trickle,
    transitionMs: finished ? LOADER_FINISH_MS : TICK_MS + 20,
    easing: finished ? "cubic-bezier(0.2, 0.7, 0.2, 1)" : "linear",
  };
}
