/**
 * Pure state machine for the (non-interactive) kiosk display. The kiosk only
 * observes: every transition is driven by a gateway message or a timer, and
 * the reducer ignores anything that doesn't fit the current phase — e.g. a
 * status for a stale session or a second scan while someone is mid-pour.
 *
 *   idle ─session─▶ selecting ─amount sent─▶ placing ─cup detected─▶ dispensing ⇄ paused (cup removed / back)
 *                                                                        │ finish            │ pause timeout
 *                                                                        ▼                   ▼
 *                                                   completed (FULLY CHARGED!) ─▶ thanks ─▶ idle
 *   Other timeouts and failures go to `failed`, which returns to idle on its own.
 *
 * A fresh one-time QR token is generated (outside the reducer) every time the
 * kiosk returns to idle.
 */

import type { PourClock } from "@/lib/loader";

type Pour = { sessionId: string; litres: number } & PourClock;

export type KioskState =
  /** `qrToken`: one-time token in the QR code; a new one every time the kiosk returns here. */
  | { phase: "idle"; qrToken: string }
  | { phase: "selecting"; sessionId: string }
  | { phase: "placing"; sessionId: string; litres: number }
  | ({ phase: "dispensing"; lastUpdate: number } & Pour)
  | ({ phase: "paused" } & Pour)
  /** "FULLY CHARGED!" — the fill-to-100% + burst beat. */
  | { phase: "completed"; sessionId: string; litres: number; dispensedLitres: number }
  /** "THANKS FOR REFILLING!" — the bottle drains, then back to the QR. */
  | { phase: "thanks"; sessionId: string; litres: number; dispensedLitres: number }
  | { phase: "failed"; reason: string; sessionId?: string; litres?: number };

export type KioskPhase = KioskState["phase"];

export type KioskAction =
  | { type: "SESSION_STARTED"; sessionId: string }
  | { type: "DISPENSE_REQUESTED"; sessionId: string; litres: number }
  | { type: "DISPENSE_PROGRESS"; sessionId: string; at: number }
  | { type: "DISPENSE_PAUSED"; sessionId: string; at: number }
  | { type: "DISPENSE_COMPLETED"; sessionId: string; dispensedLitres?: number }
  /** `qrToken` is used if the failure returns the kiosk straight to idle (pause ran out). */
  | { type: "DISPENSE_FAILED"; sessionId: string; reason: string; qrToken: string }
  /** `qrToken` is used if the timeout returns the kiosk to idle. */
  | { type: "TIMEOUT"; phase: KioskPhase; qrToken: string }
  | { type: "ROTATE_QR"; qrToken: string };

export const initialKioskState = (qrToken: string): KioskState => ({ phase: "idle", qrToken });

const sameSession = (state: KioskState, sessionId: string) =>
  "sessionId" in state && state.sessionId === sessionId;

const isActive = (
  s: KioskState,
): s is Extract<KioskState, { phase: "placing" | "dispensing" | "paused" }> =>
  s.phase === "placing" || s.phase === "dispensing" || s.phase === "paused";

export function kioskReducer(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "SESSION_STARTED":
      // A new customer may start whenever the machine isn't busy.
      if (state.phase === "idle" || state.phase === "thanks" || state.phase === "failed") {
        return { phase: "selecting", sessionId: action.sessionId };
      }
      return state;

    case "DISPENSE_REQUESTED":
      if (state.phase !== "selecting" || !sameSession(state, action.sessionId)) return state;
      return { phase: "placing", sessionId: state.sessionId, litres: action.litres };

    case "DISPENSE_PROGRESS":
      // First status = cup detected and pouring began; after a pause = cup is back.
      if (!isActive(state) || !sameSession(state, action.sessionId)) return state;
      if (state.phase === "placing") {
        return { ...state, phase: "dispensing", startedAt: action.at, pausedTotal: 0, pausedAt: null, lastUpdate: action.at };
      }
      if (state.phase === "paused") {
        const pausedTotal = state.pausedTotal + (action.at - (state.pausedAt ?? action.at));
        return { ...state, phase: "dispensing", pausedTotal, pausedAt: null, lastUpdate: action.at };
      }
      return { ...state, lastUpdate: action.at };

    case "DISPENSE_PAUSED":
      if (!sameSession(state, action.sessionId)) return state;
      if (state.phase === "dispensing") return { ...state, phase: "paused", pausedAt: action.at };
      // Cup removed before the first status arrived — treat it as paused from the start.
      if (state.phase === "placing") {
        return { ...state, phase: "paused", startedAt: action.at, pausedTotal: 0, pausedAt: action.at };
      }
      return state;

    case "DISPENSE_COMPLETED":
      if (!isActive(state) || !sameSession(state, action.sessionId)) return state;
      return {
        phase: "completed",
        sessionId: state.sessionId,
        litres: state.litres,
        dispensedLitres: action.dispensedLitres ?? state.litres,
      };

    case "DISPENSE_FAILED":
      if ((state.phase !== "selecting" && !isActive(state)) || !sameSession(state, action.sessionId)) {
        return state;
      }
      // Like the original station: an abandoned pause just returns to standby.
      if (state.phase === "paused") return initialKioskState(action.qrToken);
      return {
        phase: "failed",
        reason: action.reason,
        sessionId: state.sessionId,
        litres: "litres" in state ? state.litres : undefined,
      };

    case "ROTATE_QR":
      return state.phase === "idle" ? { phase: "idle", qrToken: action.qrToken } : state;

    case "TIMEOUT":
      if (action.phase !== state.phase) return state; // stale timer
      switch (state.phase) {
        case "selecting":
        case "thanks":
        case "failed":
        case "paused":
          return initialKioskState(action.qrToken);
        case "completed":
          return { ...state, phase: "thanks" };
        case "placing":
          return { phase: "failed", reason: "No bottle was detected under the nozzle.", sessionId: state.sessionId, litres: state.litres };
        case "dispensing":
          return { phase: "failed", reason: "We lost contact with the dispenser.", sessionId: state.sessionId, litres: state.litres };
        default:
          return state;
      }
  }
}
