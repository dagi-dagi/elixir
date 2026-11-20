import type { MockSettings, TopicTemplates } from "@/config/runtime";
import { dispensers } from "@/config/dispensers";
import { decode, encode, topicsFor } from "../protocol";
import { BUSY_REASON, QrTokenGate } from "../qr-token-gate";
import type { DispenseEvent } from "../types";
import { getMockBroker } from "./mock-broker";

const TICK_MS = 250;
const LOCK_NAME = "elixir-mock-controller";

/**
 * Simulates the backend + dispenser hardware that would sit on the other side
 * of the broker:
 *
 *   scan     → (latency) → session started (valid one-time QR token) | rejected
 *   dispense → (cupDelayMs: customer places their cup, sensor trips)
 *            → status: dispensing … → completed | failed
 *
 * Only one tab runs the simulator (elected with the Web Locks API) so opening
 * several tabs doesn't produce duplicate responses.
 */
class MockController {
  /** Dispensers currently busy (waiting for a cup, or pouring). */
  private readonly active = new Map<string, ReturnType<typeof setInterval> | undefined>();
  private readonly tokens = new QrTokenGate();

  constructor(
    private readonly topics: TopicTemplates,
    private readonly settings: MockSettings,
  ) {}

  start() {
    const broker = getMockBroker();
    for (const { id } of dispensers) {
      const t = topicsFor(this.topics, id);
      broker.subscribe(t.qrToken, (raw) => {
        const token = decode.qrToken(raw, id);
        if (token) this.tokens.set(id, token);
      });
      broker.subscribe(t.scan, (raw) => {
        const request = decode.scan(raw, id);
        if (!request) return;
        const reason = this.active.has(id) ? BUSY_REASON : this.tokens.consume(id, request.token);
        const timestamp = new Date().toISOString();
        const base = { dispenserId: id, sessionId: request.sessionId, timestamp };
        setTimeout(() => {
          broker.publish(
            t.session,
            encode.session(reason ? { ...base, type: "rejected", reason } : { ...base, type: "started" }),
          );
        }, this.settings.latencyMs);
      });
      broker.subscribe(t.dispense, (raw) => {
        const command = decode.dispense(raw, id);
        if (command) this.dispense(id, command.sessionId, command.litres);
      });
    }
  }

  private dispense(dispenserId: string, sessionId: string, litres: number) {
    const broker = getMockBroker();
    const { status } = topicsFor(this.topics, dispenserId);
    const emit = (event: DispenseEvent) => broker.publish(status, encode.status(event));
    const base = () => ({ dispenserId, sessionId, timestamp: new Date().toISOString() });

    if (this.active.has(dispenserId)) {
      emit({ ...base(), type: "failed", reason: "Dispenser is busy" });
      return;
    }

    const failAt =
      Math.random() < this.settings.failureRate ? litres * (0.2 + Math.random() * 0.6) : Infinity;
    const perTick = Math.max(0.01, this.settings.flowRateLitresPerSecond * (TICK_MS / 1000));
    let poured = 0;

    // Reserve the dispenser while we "wait for the cup".
    this.active.set(dispenserId, undefined);

    // Simulates the customer placing their cup: pouring starts automatically when it's detected.
    setTimeout(() => {
      emit({ ...base(), type: "progress", dispensedLitres: 0 });
      const timer = setInterval(() => {
        poured = Math.min(litres, poured + perTick);
        if (poured >= failAt) {
          this.stop(dispenserId);
          emit({ ...base(), type: "failed", reason: "Simulated fault: low water pressure" });
        } else if (poured >= litres) {
          this.stop(dispenserId);
          emit({ ...base(), type: "completed", dispensedLitres: litres });
        } else {
          emit({ ...base(), type: "progress", dispensedLitres: Number(poured.toFixed(2)) });
        }
      }, TICK_MS);
      this.active.set(dispenserId, timer);
    }, this.settings.cupDelayMs);
  }

  private stop(dispenserId: string) {
    clearInterval(this.active.get(dispenserId));
    this.active.delete(dispenserId);
  }
}

let started = false;

export function ensureMockController(topics: TopicTemplates, settings: MockSettings) {
  if (started || typeof window === "undefined") return;
  started = true;
  const controller = new MockController(topics, settings);

  if (navigator.locks?.request) {
    // Holds the lock for the tab's lifetime; another tab takes over when this one closes.
    navigator.locks
      .request(LOCK_NAME, () => {
        controller.start();
        return new Promise<never>(() => {});
      })
      .catch((error: unknown) => console.error("[mock] controller lock failed", error));
  } else {
    controller.start();
  }
}
