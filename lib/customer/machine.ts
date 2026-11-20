/**
 * State machine for the customer's phone (`/scan/<id>`), which is where all
 * interaction happens:
 *
 *   connecting ─scan─▶ waiting ─session─▶ selecting ─amount sent─▶ placing ─cup detected─▶ dispensing ⇄ paused ─▶ finishing ─▶ completed
 *        │                │                  │                       │                         │
 *        └── fail ────────┴── timeout ───────┴── (expired)     no cup / fail ────────── stall / fail ──▶ failed
 *
 * `paused`: the bottle was taken away mid-pour; the dispenser closed the valve
 * and resumes when it's back (or gives up after its pause timeout).
 *
 * A QR token is good for one session. Failures before the controller accepted
 * the scan are `retryable` (same token); after that — or if the controller
 * rejected the token — the customer must scan the kiosk again.
 *
 * The dispenser starts pouring by itself once a cup is under the nozzle; the
 * first status for this session moves us from "placing" to "dispensing".
 * Every event carries a sessionId; anything for another session is ignored.
 */

import type { PourClock } from "@/lib/loader";

type Pour = { sessionId: string; litres: number } & PourClock;

export type CustomerState =
  | { phase: "connecting"; sessionId: string }
  | { phase: "waiting"; sessionId: string }
  | { phase: "selecting"; sessionId: string }
  | { phase: "placing"; sessionId: string; litres: number }
  /** `lastUpdate`: last status received — restarts the stall timer. */
  | ({ phase: "dispensing"; lastUpdate: number } & Pour)
  | ({ phase: "paused" } & Pour)
  /** Brief: the progress bar plays its quick "fill to 100%" before the done card. */
  | { phase: "finishing"; sessionId: string; litres: number; dispensedLitres: number }
  | { phase: "completed"; sessionId: string; litres: number; dispensedLitres: number }
  | { phase: "expired"; sessionId: string }
  | { phase: "failed"; sessionId: string; reason: string; retryable: boolean };

export type CustomerPhase = CustomerState["phase"];

export type CustomerAction =
  | { type: "SCAN_SENT"; sessionId: string }
  | { type: "SESSION_STARTED"; sessionId: string }
  | { type: "SESSION_REJECTED"; sessionId: string; reason: string }
  | { type: "AMOUNT_CHOSEN"; litres: number }
  | { type: "DISPENSE_PROGRESS"; sessionId: string; at: number }
  | { type: "DISPENSE_PAUSED"; sessionId: string; at: number }
  | { type: "DISPENSE_COMPLETED"; sessionId: string; dispensedLitres?: number }
  | { type: "FAILED"; sessionId: string; reason: string }
  | { type: "TIMEOUT"; phase: CustomerPhase }
  | { type: "RESTART"; sessionId: string };

export const initialCustomerState = (sessionId: string): CustomerState => ({
  phase: "connecting",
  sessionId,
});

const hasAmount = (
  s: CustomerState,
): s is Extract<CustomerState, { phase: "placing" | "dispensing" | "paused" }> =>
  s.phase === "placing" || s.phase === "dispensing" || s.phase === "paused";

export function customerReducer(state: CustomerState, action: CustomerAction): CustomerState {
  if ("sessionId" in action && action.type !== "RESTART" && action.sessionId !== state.sessionId) {
    return state; // another customer's session
  }

  switch (action.type) {
    case "SCAN_SENT":
      return state.phase === "connecting" ? { phase: "waiting", sessionId: state.sessionId } : state;

    case "SESSION_STARTED":
      return state.phase === "waiting" || state.phase === "connecting"
        ? { phase: "selecting", sessionId: state.sessionId }
        : state;

    case "SESSION_REJECTED":
      return state.phase === "waiting" || state.phase === "connecting"
        ? { phase: "failed", sessionId: state.sessionId, reason: action.reason, retryable: false }
        : state;

    case "AMOUNT_CHOSEN":
      return state.phase === "selecting"
        ? { phase: "placing", sessionId: state.sessionId, litres: action.litres }
        : state;

    case "DISPENSE_PROGRESS":
      // First status = bottle detected and pouring began; after a pause = bottle is back.
      if (!hasAmount(state)) return state;
      if (state.phase === "placing") {
        return { ...state, phase: "dispensing", startedAt: action.at, pausedTotal: 0, pausedAt: null, lastUpdate: action.at };
      }
      if (state.phase === "paused") {
        const pausedTotal = state.pausedTotal + (action.at - (state.pausedAt ?? action.at));
        return { ...state, phase: "dispensing", pausedTotal, pausedAt: null, lastUpdate: action.at };
      }
      return { ...state, lastUpdate: action.at };

    case "DISPENSE_PAUSED":
      if (state.phase === "dispensing") return { ...state, phase: "paused", pausedAt: action.at };
      if (state.phase === "placing") {
        return { ...state, phase: "paused", startedAt: action.at, pausedTotal: 0, pausedAt: action.at };
      }
      return state;

    case "DISPENSE_COMPLETED":
      if (!hasAmount(state)) return state;
      return {
        phase: "finishing",
        sessionId: state.sessionId,
        litres: state.litres,
        dispensedLitres: action.dispensedLitres ?? state.litres,
      };

    case "FAILED":
      if (state.phase === "finishing" || state.phase === "completed" || state.phase === "expired" || state.phase === "failed") {
        return state;
      }
      // Before the session was accepted the token is still unused, so a retry may work.
      return {
        phase: "failed",
        sessionId: state.sessionId,
        reason: action.reason,
        retryable: state.phase === "connecting" || state.phase === "waiting",
      };

    case "TIMEOUT":
      if (action.phase !== state.phase) return state; // stale timer
      switch (state.phase) {
        case "waiting":
          return {
            phase: "failed",
            sessionId: state.sessionId,
            reason: "The dispenser didn't respond. It may be busy — please try again in a moment.",
            retryable: true,
          };
        case "selecting":
          return { phase: "expired", sessionId: state.sessionId };
        case "placing":
          return { phase: "failed", sessionId: state.sessionId, reason: "No bottle was detected under the nozzle in time.", retryable: false };
        case "paused":
          return { phase: "failed", sessionId: state.sessionId, reason: "The bottle wasn't put back, so the refill stopped.", retryable: false };
        case "finishing":
          return { ...state, phase: "completed" };
        case "dispensing":
          return { phase: "failed", sessionId: state.sessionId, reason: "We lost contact with the dispenser.", retryable: false };
        default:
          return state;
      }

    case "RESTART":
      return initialCustomerState(action.sessionId);
  }
}
