import type { CSSProperties } from "react";

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A ring that empties over `durationMs`. Pure CSS animation — no re-renders.
 * Change `key` on the parent to restart it.
 */
export function CountdownRing({ durationMs, label }: { durationMs: number; label: string }) {
  const seconds = Math.round(durationMs / 1000);
  return (
    <span className="inline-flex items-center gap-3 text-xl text-muted-foreground">
      <svg viewBox="0 0 44 44" className="size-10 -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          data-motion="essential"
          className="countdown-ring"
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={
            {
              "--circumference": CIRCUMFERENCE,
              animationDuration: `${durationMs}ms`,
            } as CSSProperties
          }
        />
      </svg>
      <span>
        {label}
        <span className="sr-only"> in about {seconds} seconds</span>
      </span>
    </span>
  );
}
