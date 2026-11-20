/**
 * Firmware service configuration.
 *
 * Shares the app's topic templates, timings and broker settings
 * (`config/runtime.ts`, read from the same `.env.local`) so both sides always
 * agree. `FIRMWARE_*` variables override where the firmware should differ —
 * e.g. its own broker user with a broader ACL.
 */

import { dispensers, flowRateFor, type DispenserDefinition } from "../../config/dispensers.ts";
import { runtimeConfig } from "../../config/runtime.ts";

function int(value: string | undefined, fallback: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function float(value: string | undefined, fallback: number) {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

function selectDispensers(list: string | undefined): DispenserDefinition[] {
  if (!list) return [...dispensers];
  const ids = new Set(list.split(",").map((s) => s.trim()).filter(Boolean));
  const selected = dispensers.filter((d) => ids.has(d.id));
  if (selected.length === 0) throw new Error(`FIRMWARE_DISPENSERS="${list}" matches no dispenser in config/dispensers.ts`);
  return selected;
}

const env = process.env;

export const firmwareConfig = {
  mqtt: {
    url: env.FIRMWARE_MQTT_URL || runtimeConfig.mqtt.url,
    username: env.FIRMWARE_MQTT_USERNAME || runtimeConfig.mqtt.username,
    password: env.FIRMWARE_MQTT_PASSWORD || runtimeConfig.mqtt.password,
    clientIdPrefix: env.FIRMWARE_MQTT_CLIENT_ID_PREFIX || `${runtimeConfig.mqtt.clientIdPrefix}-firmware`,
    qos: runtimeConfig.mqtt.qos,
    keepaliveSeconds: runtimeConfig.mqtt.keepaliveSeconds,
    reconnectPeriodMs: runtimeConfig.mqtt.reconnectPeriodMs,
    connectTimeoutMs: runtimeConfig.mqtt.connectTimeoutMs,
  },
  topics: runtimeConfig.topics,
  dispensers: selectDispensers(env.FIRMWARE_DISPENSERS),
  /** Flow rate per dispenser; FIRMWARE_FLOW_RATE overrides all of them (handy for quick demos). */
  flowRateFor: (d: DispenserDefinition) => float(env.FIRMWARE_FLOW_RATE, flowRateFor(d)),
  /** Delay before answering a scan with "session". */
  responseLatencyMs: int(env.FIRMWARE_LATENCY_MS, runtimeConfig.mock.latencyMs),
  /** Auto mode: the simulated customer places their cup after this delay. */
  autoCup: env.FIRMWARE_AUTO_CUP !== "false",
  cupDelayMs: int(env.FIRMWARE_CUP_DELAY_MS, runtimeConfig.mock.cupDelayMs),
  /** Auto mode: the cup is taken away this long after pouring finishes. */
  cupRemoveDelayMs: int(env.FIRMWARE_CUP_REMOVE_DELAY_MS, 2500),
  /** 0–1 chance that a pour faults part-way. */
  failureRate: Math.min(1, Math.max(0, float(env.FIRMWARE_FAILURE_RATE, runtimeConfig.mock.failureRate))),
  /** How often progress is published while pouring. */
  progressIntervalMs: int(env.FIRMWARE_PROGRESS_INTERVAL_MS, 500),
  /** Firmware gives up on an open session / missing cup after these (kept in line with the app). */
  sessionTimeoutMs: runtimeConfig.timings.selectionTimeoutMs,
  cupTimeoutMs: runtimeConfig.timings.cupTimeoutMs,
  /** Cup removed mid-pour: end the refill if it isn't back within this time. */
  pauseTimeoutMs: int(env.FIRMWARE_PAUSE_TIMEOUT_MS, runtimeConfig.timings.pauseTimeoutMs),
  ui: {
    host: env.FIRMWARE_UI_HOST || "127.0.0.1",
    port: int(env.FIRMWARE_UI_PORT, 4001),
  },
};

export type FirmwareConfig = typeof firmwareConfig;
