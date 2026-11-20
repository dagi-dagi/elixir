"use client";

import { createContext, use, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { flowRateFor, type DispenserDefinition } from "@/config/dispensers";
import { runtimeConfig } from "@/config/runtime";
import { createId } from "@/lib/id";
import { initialKioskState, kioskReducer, type KioskState } from "@/lib/kiosk/machine";
import { useDispenserGateway } from "@/components/providers/gateway-provider";

interface KioskContextValue {
  dispenser: DispenserDefinition;
  state: KioskState;
}

const KioskContext = createContext<KioskContextValue | null>(null);

/** How long the current phase may last before the machine moves on. */
function timeoutFor(state: KioskState, dispenser: DispenserDefinition): number | null {
  const t = runtimeConfig.timings;
  switch (state.phase) {
    case "selecting":
      return t.selectionTimeoutMs;
    case "placing":
      return t.cupTimeoutMs;
    case "dispensing": {
      // Allow at least the expected pour time between updates for devices that only report start/finish.
      const expected = (state.litres / flowRateFor(dispenser)) * 1000 * 1.5;
      return Math.max(t.dispenseStallTimeoutMs, expected);
    }
    case "paused":
      // The firmware ends the pause at the same moment; a little grace for its message.
      return t.pauseTimeoutMs + 1500;
    case "completed":
      return t.completeHoldMs;
    case "thanks":
      return t.thankYouDurationMs;
    case "failed":
      return t.errorDurationMs;
    default:
      return null;
  }
}

/**
 * Drives the display-only kiosk (a single page): listens to the gateway, runs
 * phase timers and manages the one-time QR token. The kiosk never takes
 * customer input — customers interact from their phone.
 */
export function KioskProvider({
  dispenser,
  children,
}: {
  dispenser: DispenserDefinition;
  children: ReactNode;
}) {
  const { gateway, connectionState } = useDispenserGateway();
  const [state, dispatch] = useReducer(kioskReducer, undefined, () => initialKioskState(createId()));

  // Gateway → state machine
  useEffect(() => {
    if (!gateway) return;
    const offs = [
      gateway.onSession(dispenser.id, (event) => {
        // Rejections (used QR code, busy) are the phone's business.
        if (event.type === "started") dispatch({ type: "SESSION_STARTED", sessionId: event.sessionId });
      }),
      gateway.onDispenseRequested(dispenser.id, (command) =>
        dispatch({ type: "DISPENSE_REQUESTED", sessionId: command.sessionId, litres: command.litres }),
      ),
      gateway.onDispenseEvent(dispenser.id, (event) => {
        const at = Date.now();
        switch (event.type) {
          case "progress":
            return dispatch({ type: "DISPENSE_PROGRESS", sessionId: event.sessionId, at });
          case "paused":
            return dispatch({ type: "DISPENSE_PAUSED", sessionId: event.sessionId, at });
          case "completed":
            return dispatch({ type: "DISPENSE_COMPLETED", sessionId: event.sessionId, dispensedLitres: event.dispensedLitres });
          case "failed":
            return dispatch({ type: "DISPENSE_FAILED", sessionId: event.sessionId, reason: event.reason, qrToken: createId() });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [gateway, dispenser.id]);

  // Phase timers. While dispensing, every status update restarts the stall timer.
  const timeout = timeoutFor(state, dispenser);
  const timerKey = state.phase === "dispensing" ? state.lastUpdate : 0;
  useEffect(() => {
    if (timeout === null) return;
    const phase = state.phase;
    const id = setTimeout(() => dispatch({ type: "TIMEOUT", phase, qrToken: createId() }), timeout);
    return () => clearTimeout(id);
  }, [state.phase, timeout, timerKey]);

  // One-time QR token: announce the current one (retained) whenever we're idle and
  // connected, and rotate it periodically so a photographed code goes stale.
  const qrToken = state.phase === "idle" ? state.qrToken : null;
  useEffect(() => {
    if (!gateway || connectionState !== "connected" || !qrToken) return;
    gateway.announceQrToken(dispenser.id, qrToken).catch((error: unknown) => {
      console.error("[kiosk] failed to announce QR token", error);
    });
  }, [gateway, connectionState, dispenser.id, qrToken]);

  const idle = state.phase === "idle";
  useEffect(() => {
    if (!idle) return;
    const id = setInterval(
      () => dispatch({ type: "ROTATE_QR", qrToken: createId() }),
      runtimeConfig.timings.qrTokenRotateMs,
    );
    return () => clearInterval(id);
  }, [idle]);

  const value = useMemo(() => ({ dispenser, state }), [dispenser, state]);
  return <KioskContext value={value}>{children}</KioskContext>;
}

/**
 * Renders its children only inside a configured kiosk. The page always
 * renders (so it's part of the static shell); the scene appears once the
 * dispenser has been read from local storage.
 */
export function KioskGate({ children }: { children: ReactNode }) {
  return use(KioskContext) ? children : null;
}

export function useKiosk() {
  const ctx = use(KioskContext);
  if (!ctx) throw new Error("useKiosk must be used inside <KioskProvider>");
  return ctx;
}
