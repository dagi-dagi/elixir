/**
 * Simulated dispenser firmware (plus the controller that answers scans).
 *
 * One `Unit` per physical dispenser:
 *
 * Scans must carry the one-time token the kiosk is showing in its QR code
 * (announced on the retained qr-token topic); otherwise they're rejected.
 *
 *   idle ─scan─▶ session ─dispense─▶ awaiting_cup ─cup detected─▶ pouring ─▶ idle (completed)
 *    ▲             │ timeout            │ timeout                   ⇅ cup removed / put back
 *    │             │                    │                         paused ── pause timeout ──┐
 *    └─────────────┴────────────────────┴──────────── fault ─────────┴──────────────────────┴──▶ idle (failed)
 *
 * Removing the cup mid-pour closes the valve and reports `paused`; putting it
 * back resumes from where it stopped and reports `dispensing` again.
 *
 * Transport-agnostic: messages go out through the `publish` callback and come
 * in through `handleMessage`, so main.ts owns the MQTT client.
 */

import { EventEmitter } from "node:events";
import type { DispenserDefinition } from "../../config/dispensers.ts";
import { decode, encode, topicsFor } from "../../lib/dispenser/protocol.ts";
import { BUSY_REASON, QrTokenGate } from "../../lib/dispenser/qr-token-gate.ts";
import type { DispenseEvent } from "../../lib/dispenser/types.ts";
import type { FirmwareConfig } from "./config.ts";

export type UnitPhase = "idle" | "session" | "awaiting_cup" | "pouring" | "paused";

export interface UnitSnapshot {
  id: string;
  name: string;
  location: string;
  phase: UnitPhase;
  phaseSince: number;
  sessionId: string | null;
  targetLitres: number | null;
  pouredLitres: number;
  cupPresent: boolean;
  /** Token currently accepted for this dispenser (null = none / just consumed). */
  qrToken: string | null;
  flowRate: number;
  lastResult: { at: number; ok: boolean; message: string } | null;
}

export interface LogEntry {
  id: number;
  at: number;
  kind: "in" | "out" | "info" | "warn";
  dispenserId?: string;
  topic?: string;
  message: string;
}

type Publish = (topic: string, payload: string) => Promise<void>;

/** A status message before dispenserId/timestamp are filled in. */
type StatusInput =
  | { type: "progress"; sessionId: string; dispensedLitres?: number }
  | { type: "paused"; sessionId: string; dispensedLitres?: number; reason?: string }
  | { type: "completed"; sessionId: string; dispensedLitres?: number }
  | { type: "failed"; sessionId: string; reason: string };

type ResultInput = { ok: boolean; message: string } | null;

interface Unit {
  def: DispenserDefinition;
  topics: ReturnType<typeof topicsFor>;
  phase: UnitPhase;
  phaseSince: number;
  sessionId: string | null;
  targetLitres: number | null;
  pouredLitres: number;
  cupPresent: boolean;
  failAt: number;
  lastResult: UnitSnapshot["lastResult"];
  timers: Set<ReturnType<typeof setTimeout>>;
  pourTimer: ReturnType<typeof setInterval> | null;
}

const LOG_LIMIT = 200;

export class Firmware extends EventEmitter {
  readonly config: FirmwareConfig;
  autoCup: boolean;
  private readonly publishRaw: Publish;
  private readonly units = new Map<string, Unit>();
  private readonly logs: LogEntry[] = [];
  private readonly tokens = new QrTokenGate();
  private logSeq = 0;

  constructor(config: FirmwareConfig, publish: Publish) {
    super();
    this.config = config;
    this.publishRaw = publish;
    this.autoCup = config.autoCup;
    for (const def of config.dispensers) {
      this.units.set(def.id, {
        def,
        topics: topicsFor(config.topics, def.id),
        phase: "idle",
        phaseSince: Date.now(),
        sessionId: null,
        targetLitres: null,
        pouredLitres: 0,
        cupPresent: false,
        failAt: Infinity,
        lastResult: null,
        timers: new Set(),
        pourTimer: null,
      });
    }
  }

  /** Topics the firmware must subscribe to. */
  subscriptions() {
    return [...this.units.values()].flatMap((u) => [u.topics.qrToken, u.topics.scan, u.topics.dispense]);
  }

  // ---------------------------------------------------------------- inbound

  handleMessage(topic: string, payload: string) {
    for (const unit of this.units.values()) {
      if (topic === unit.topics.qrToken) {
        const token = decode.qrToken(payload, unit.def.id);
        if (token) {
          this.tokens.set(unit.def.id, token);
          this.log("in", `QR token updated: ${token.slice(0, 8)}…`, unit, topic);
          this.changed();
        }
        return;
      }
      if (topic === unit.topics.scan) {
        this.log("in", payload, unit, topic);
        const request = decode.scan(payload, unit.def.id);
        if (request) this.onScan(unit, request.sessionId, request.token);
        else this.log("warn", "Ignored malformed scan payload", unit);
        return;
      }
      if (topic === unit.topics.dispense) {
        this.log("in", payload, unit, topic);
        const command = decode.dispense(payload, unit.def.id);
        if (command) this.onDispense(unit, command.sessionId, command.litres);
        else this.log("warn", "Ignored malformed dispense payload", unit);
        return;
      }
    }
  }

  private onScan(unit: Unit, sessionId: string, token: string) {
    const reject = (reason: string) => {
      this.log("warn", `Scan rejected: ${reason}`, unit);
      void this.send(unit, unit.topics.session, encode.session({
        type: "rejected",
        dispenserId: unit.def.id,
        sessionId,
        reason,
        timestamp: new Date().toISOString(),
      }));
    };
    if (unit.phase !== "idle") return reject(BUSY_REASON);
    const invalid = this.tokens.consume(unit.def.id, token);
    if (invalid) return reject(invalid);

    this.enter(unit, "session", { sessionId });
    this.after(unit, this.config.responseLatencyMs, () => {
      void this.send(unit, unit.topics.session, encode.session({
        type: "started",
        dispenserId: unit.def.id,
        sessionId,
        timestamp: new Date().toISOString(),
      }));
    });
    // Nobody chose an amount in time: free the dispenser.
    this.after(unit, this.config.sessionTimeoutMs + 2000, () => {
      if (unit.phase === "session" && unit.sessionId === sessionId) {
        this.log("info", "Session expired without a selection", unit);
        this.toIdle(unit, { ok: false, message: "Session expired" });
      }
    });
  }

  private onDispense(unit: Unit, sessionId: string, litres: number) {
    const sameSession = unit.sessionId === sessionId;
    if (unit.phase !== "idle" && !(unit.phase === "session" && sameSession)) {
      this.log("warn", `Busy (${unit.phase}) — rejecting dispense`, unit);
      void this.status(unit, { type: "failed", sessionId, reason: "Dispenser is busy" });
      return;
    }
    // Accept from idle too (e.g. the firmware restarted after the session started).
    this.enter(unit, "awaiting_cup", { sessionId, targetLitres: litres, pouredLitres: 0 });
    this.log("info", `Waiting for a cup to pour ${litres} L`, unit);

    if (unit.cupPresent) {
      this.startPour(unit);
      return;
    }
    if (this.autoCup) this.after(unit, this.config.cupDelayMs, () => this.placeCup(unit.def.id));
    this.after(unit, this.config.cupTimeoutMs, () => {
      if (unit.phase === "awaiting_cup" && unit.sessionId === sessionId) {
        this.fail(unit, "No cup detected");
      }
    });
  }

  // ---------------------------------------------------- operator controls

  placeCup(id: string) {
    const unit = this.unit(id);
    if (unit.cupPresent) return;
    unit.cupPresent = true;
    this.log("info", "Cup sensor: cup detected", unit);
    if (unit.phase === "awaiting_cup") this.startPour(unit);
    else if (unit.phase === "paused") this.resumePour(unit);
    else this.changed();
  }

  removeCup(id: string) {
    const unit = this.unit(id);
    if (!unit.cupPresent) return;
    unit.cupPresent = false;
    this.log("info", "Cup sensor: cup removed", unit);
    if (unit.phase === "pouring") this.pausePour(unit);
    else this.changed();
  }

  triggerFault(id: string) {
    const unit = this.unit(id);
    if (unit.phase === "idle") return;
    this.fail(unit, "Simulated fault: low water pressure");
  }

  reset(id: string) {
    const unit = this.unit(id);
    this.log("info", "Reset by operator", unit);
    this.toIdle(unit, null);
  }

  setAutoCup(enabled: boolean) {
    this.autoCup = enabled;
    this.log("info", `Auto cup placement ${enabled ? "enabled" : "disabled"}`);
    this.changed();
  }

  // -------------------------------------------------------------- pouring

  private startPour(unit: Unit) {
    const litres = unit.targetLitres ?? 0;
    unit.failAt =
      Math.random() < this.config.failureRate ? litres * (0.2 + Math.random() * 0.6) : Infinity;
    this.enter(unit, "pouring", { pouredLitres: 0 });
    this.log("info", `Pouring ${litres} L at ${this.config.flowRateFor(unit.def)} L/s`, unit);
    this.runPump(unit);
  }

  /** Cup removed mid-pour: valve closed, wait for it to come back. */
  private pausePour(unit: Unit) {
    const sessionId = unit.sessionId!;
    this.enter(unit, "paused", {}); // clears the pump timer
    this.log("warn", `Paused at ${unit.pouredLitres.toFixed(2)} L — waiting for the cup`, unit);
    void this.status(unit, { type: "paused", sessionId, dispensedLitres: Number(unit.pouredLitres.toFixed(2)), reason: "cup_removed" });
    this.after(unit, this.config.pauseTimeoutMs, () => {
      if (unit.phase === "paused" && unit.sessionId === sessionId) {
        this.fail(unit, "The bottle wasn't put back, so the refill stopped.");
      }
    });
  }

  /** Cup is back: continue from where we stopped. */
  private resumePour(unit: Unit) {
    this.enter(unit, "pouring", {});
    this.log("info", `Resuming at ${unit.pouredLitres.toFixed(2)} L`, unit);
    this.runPump(unit);
  }

  private runPump(unit: Unit) {
    const litres = unit.targetLitres ?? 0;
    const flow = this.config.flowRateFor(unit.def);
    const tickMs = 100;
    let sinceLastPublish = Infinity; // publish "dispensing" immediately (start / resume)

    unit.pourTimer = setInterval(() => {
      unit.pouredLitres = Math.min(litres, unit.pouredLitres + flow * (tickMs / 1000));
      sinceLastPublish += tickMs;

      if (unit.pouredLitres >= unit.failAt) {
        unit.failAt = Infinity;
        this.fail(unit, "Simulated fault: low water pressure");
        return;
      }
      if (unit.pouredLitres >= litres) {
        void this.status(unit, { type: "completed", sessionId: unit.sessionId!, dispensedLitres: litres });
        this.toIdle(unit, { ok: true, message: `Dispensed ${litres} L` });
        if (this.autoCup) this.after(unit, this.config.cupRemoveDelayMs, () => this.removeCup(unit.def.id), true);
        return;
      }
      if (sinceLastPublish >= this.config.progressIntervalMs) {
        sinceLastPublish = 0;
        void this.status(unit, {
          type: "progress",
          sessionId: unit.sessionId!,
          dispensedLitres: Number(unit.pouredLitres.toFixed(2)),
        });
      }
      this.changed();
    }, tickMs);
  }

  // ------------------------------------------------------------- helpers

  private fail(unit: Unit, reason: string) {
    if (unit.sessionId) void this.status(unit, { type: "failed", sessionId: unit.sessionId, reason });
    this.log("warn", reason, unit);
    this.toIdle(unit, { ok: false, message: reason });
  }

  private toIdle(unit: Unit, result: ResultInput) {
    this.clearTimers(unit);
    unit.phase = "idle";
    unit.phaseSince = Date.now();
    unit.sessionId = null;
    unit.targetLitres = null;
    unit.failAt = Infinity;
    if (result) unit.lastResult = { at: Date.now(), ...result };
    this.changed();
  }

  private enter(
    unit: Unit,
    phase: UnitPhase,
    patch: Partial<Pick<Unit, "sessionId" | "targetLitres" | "pouredLitres">>,
  ) {
    // Timers belong to the phase being left (except cup removal, which outlives it).
    this.clearTimers(unit);
    unit.phase = phase;
    unit.phaseSince = Date.now();
    Object.assign(unit, patch);
    this.changed();
  }

  private after(unit: Unit, ms: number, fn: () => void, detached = false) {
    const timer = setTimeout(() => {
      unit.timers.delete(timer);
      fn();
    }, ms);
    if (!detached) unit.timers.add(timer);
  }

  private clearTimers(unit: Unit) {
    for (const t of unit.timers) clearTimeout(t);
    unit.timers.clear();
    if (unit.pourTimer) clearInterval(unit.pourTimer);
    unit.pourTimer = null;
  }

  private status(unit: Unit, event: StatusInput) {
    const full: DispenseEvent = { ...event, dispenserId: unit.def.id, timestamp: new Date().toISOString() };
    return this.send(unit, unit.topics.status, encode.status(full));
  }

  private async send(unit: Unit, topic: string, payload: string) {
    this.log("out", payload, unit, topic);
    try {
      await this.publishRaw(topic, payload);
    } catch (error) {
      this.log("warn", `Publish failed: ${error instanceof Error ? error.message : String(error)}`, unit, topic);
    }
  }

  private unit(id: string) {
    const unit = this.units.get(id);
    if (!unit) throw new Error(`Unknown dispenser "${id}"`);
    return unit;
  }

  hasUnit(id: string) {
    return this.units.has(id);
  }

  log(kind: LogEntry["kind"], message: string, unit?: Unit, topic?: string) {
    const entry: LogEntry = { id: ++this.logSeq, at: Date.now(), kind, message, topic, dispenserId: unit?.def.id };
    this.logs.push(entry);
    if (this.logs.length > LOG_LIMIT) this.logs.shift();
    const tag = unit ? `[${unit.def.id}]` : "[fw]";
    console.log(`${new Date(entry.at).toISOString()} ${kind.padEnd(4)} ${tag} ${topic ? topic + " " : ""}${message}`);
    this.emit("log", entry);
  }

  recentLogs() {
    return [...this.logs];
  }

  snapshot(): UnitSnapshot[] {
    return [...this.units.values()].map((u) => ({
      id: u.def.id,
      name: u.def.name,
      location: u.def.location,
      phase: u.phase,
      phaseSince: u.phaseSince,
      sessionId: u.sessionId,
      targetLitres: u.targetLitres,
      pouredLitres: Number(u.pouredLitres.toFixed(2)),
      cupPresent: u.cupPresent,
      qrToken: this.tokens.peek(u.def.id),
      flowRate: this.config.flowRateFor(u.def),
      lastResult: u.lastResult,
    }));
  }

  private changed() {
    this.emit("change");
  }

  shutdown() {
    for (const unit of this.units.values()) this.clearTimers(unit);
  }
}
