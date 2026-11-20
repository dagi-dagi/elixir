import type { ReactNode } from "react";

/**
 * Fixed-aspect canvas for the kiosk display (see `.kiosk-stage` in
 * globals.css). Centered and letterboxed when the window ratio differs.
 */
export function KioskStage({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-0 grid place-items-center bg-[var(--stage-backdrop)]">
      <div
        className="kiosk-stage relative isolate overflow-hidden text-[var(--stage-fg)]"
        style={{ background: "linear-gradient(160deg, var(--stage-from) 10%, var(--stage-to) 100%)" }}
      >
        {children}
      </div>
    </div>
  );
}
