"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { runtimeConfig } from "@/config/runtime";
import { LOADER_FINISHING_TOTAL_MS } from "@/lib/loader";
import { useDispenserGateway } from "@/components/providers/gateway-provider";
import { customerReducer, initialCustomerState, type CustomerState } from "@/lib/customer/machine";
import { describeError } from "@/lib/dispenser/errors";
import { createId } from "@/lib/id";

function timeoutFor(state: CustomerState, flowRate: number): number | null {
  const t = runtimeConfig.timings;
  switch (state.phase) {
    case "waiting":
      return t.sessionAckTimeoutMs;
    case "selecting":
      return t.selectionTimeoutMs;
    case "placing":
      return t.cupTimeoutMs;
    case "paused":
      // The firmware ends a too-long pause itself; this is only a safety net.
      return t.pauseTimeoutMs + 10_000;
    case "finishing":
      return LOADER_FINISHING_TOTAL_MS;
    case "dispensing":
      return Math.max(t.dispenseStallTimeoutMs, (state.litres / flowRate) * 1000 * 1.5);
    default:
      return null;
  }
}

/** Runs the customer's side of a refill session against the gateway. */
/**
 * `token` is the one-time code from the scanned QR. It's only sent with the
 * scan; reusing it (reload, back, copied link) gets rejected by the controller.
 */
export function useCustomerSession(dispenserId: string, token: string, flowRate: number) {
  const { gateway, connectionState, reconnect } = useDispenserGateway();
  const [state, dispatch] = useReducer(customerReducer, undefined, () => initialCustomerState(createId()));
  // The scan for a session is published once, even if effects re-run.
  const scannedSession = useRef<string | null>(null);

  // Listen for this session's signals. Subscribed before the scan is published.
  useEffect(() => {
    if (!gateway) return;
    const offs = [
      gateway.onSession(dispenserId, (e) =>
        dispatch(
          e.type === "started"
            ? { type: "SESSION_STARTED", sessionId: e.sessionId }
            : { type: "SESSION_REJECTED", sessionId: e.sessionId, reason: e.reason },
        ),
      ),
      gateway.onDispenseEvent(dispenserId, (e) => {
        if (e.type === "progress") {
          dispatch({ type: "DISPENSE_PROGRESS", sessionId: e.sessionId, at: Date.now() });
        } else if (e.type === "paused") {
          dispatch({ type: "DISPENSE_PAUSED", sessionId: e.sessionId, at: Date.now() });
        } else if (e.type === "completed") {
          dispatch({ type: "DISPENSE_COMPLETED", sessionId: e.sessionId, dispensedLitres: e.dispensedLitres });
        } else {
          dispatch({ type: "FAILED", sessionId: e.sessionId, reason: e.reason });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [gateway, dispenserId]);

  // Announce the scan as soon as we're connected.
  const { phase, sessionId } = state;
  useEffect(() => {
    if (phase !== "connecting" || !gateway || connectionState !== "connected") return;
    if (scannedSession.current === sessionId) return;
    scannedSession.current = sessionId;
    gateway
      .requestSession({ dispenserId, sessionId, token })
      .then(() => dispatch({ type: "SCAN_SENT", sessionId }))
      .catch((error: unknown) => {
        console.error("[customer] scan failed", error);
        dispatch({ type: "FAILED", sessionId, reason: describeError(error) });
      });
  }, [phase, sessionId, gateway, connectionState, dispenserId, token]);

  // Phase timers
  const timeout = timeoutFor(state, flowRate);
  const timerKey = state.phase === "dispensing" ? state.lastUpdate : 0;
  useEffect(() => {
    if (timeout === null) return;
    const id = setTimeout(() => dispatch({ type: "TIMEOUT", phase }), timeout);
    return () => clearTimeout(id);
  }, [phase, timeout, timerKey]);

  /**
   * Send the chosen amount. The customer is then asked to place their cup;
   * the dispenser starts pouring on its own when it detects it.
   */
  const chooseAmount = useCallback(
    (litres: number) => {
      if (state.phase !== "selecting" || !gateway) return;
      const { sessionId } = state;
      dispatch({ type: "AMOUNT_CHOSEN", litres });
      gateway.requestDispense({ dispenserId, sessionId, litres }).catch((error: unknown) => {
        console.error("[customer] dispense request failed", error);
        dispatch({ type: "FAILED", sessionId, reason: describeError(error) });
      });
    },
    [state, gateway, dispenserId],
  );

  /** Retry with the same QR token — only meaningful when the failure is `retryable`. */
  const retry = useCallback(() => {
    if (connectionState !== "connected") reconnect();
    dispatch({ type: "RESTART", sessionId: createId() });
  }, [connectionState, reconnect]);

  return { state, connectionState, chooseAmount, retry };
}
