/**
 * Runtime configuration read from environment variables.
 *
 * All values are `NEXT_PUBLIC_*` because the dispenser gateway runs in the
 * browser (the kiosk talks to the broker directly over WebSockets). Next.js
 * inlines these at build time, so each one must be referenced literally.
 *
 * ⚠️  Anything here is visible to anyone who loads the page. Never put
 * privileged broker credentials here — use broker ACLs that only allow the
 * topics below, or short-lived tokens.
 */

export type TransportName = "mock" | "mqtt";

function int(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function float(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function transport(value: string | undefined): TransportName {
  return value === "mqtt" ? "mqtt" : "mock";
}

function qos(value: string | undefined): 0 | 1 | 2 {
  const n = int(value, 1);
  return n === 0 || n === 2 ? n : 1;
}

export interface TopicTemplates {
  /** Kiosk → controller (retained): the one-time token currently in the QR code. */
  qrToken: string;
  /** Customer phone → broker, when the QR page is opened. */
  scan: string;
  /** Controller → kiosk + phone, when a session may start (phone shows the litre picker). */
  session: string;
  /** Phone → controller (kiosk listens too), the selected amount. The dispenser waits for a cup, then pours. */
  dispense: string;
  /** Controller → kiosk + phone, progress / completed / failed. */
  status: string;
}

export interface MqttSettings {
  url: string;
  username?: string;
  password?: string;
  clientIdPrefix: string;
  qos: 0 | 1 | 2;
  keepaliveSeconds: number;
  reconnectPeriodMs: number;
  connectTimeoutMs: number;
  publishTimeoutMs: number;
}

export interface MockSettings {
  /** Delay before the simulated controller answers a scan. */
  latencyMs: number;
  /** Simulated time for the customer to place their cup (cup sensor trips → pouring starts). */
  cupDelayMs: number;
  /** Simulated flow rate (L/s). */
  flowRateLitresPerSecond: number;
  /** 0–1 probability that a simulated dispense fails, to exercise error UI. */
  failureRate: number;
}

export interface FlowTimings {
  /** Phone: how long to wait for the "session" signal after scanning. */
  sessionAckTimeoutMs: number;
  /** How long the customer has to choose an amount on their phone. */
  selectionTimeoutMs: number;
  /** After the amount is sent: how long to wait for a cup under the nozzle (first "dispensing" status). */
  cupTimeoutMs: number;
  /** Cup removed mid-pour: how long the firmware waits for it to come back before ending the refill. */
  pauseTimeoutMs: number;
  /** Max silence between status messages while dispensing. */
  dispenseStallTimeoutMs: number;
  /** Kiosk: rotate the QR token this often while idle, so a photographed code goes stale. */
  qrTokenRotateMs: number;
  /** Kiosk "FULLY CHARGED!" beat (burst + shockwaves) after the finish signal. */
  completeHoldMs: number;
  /** Kiosk "THANKS FOR REFILLING!" beat before returning to the QR. */
  thankYouDurationMs: number;
  /** Kiosk error screen before returning to the QR. */
  errorDurationMs: number;
}

const prefix = process.env.NEXT_PUBLIC_MQTT_TOPIC_PREFIX || "elixir";

export const runtimeConfig = {
  transport: transport(process.env.NEXT_PUBLIC_DISPENSER_TRANSPORT),
  /** Base URL encoded into QR codes. Falls back to the current origin. */
  publicUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  /** Show developer helpers (e.g. "simulate scan") on the kiosk. */
  devTools:
    process.env.NEXT_PUBLIC_KIOSK_DEV_TOOLS === "true" ||
    (process.env.NEXT_PUBLIC_KIOSK_DEV_TOOLS !== "false" &&
      process.env.NODE_ENV !== "production"),
  topics: {
    qrToken:
      process.env.NEXT_PUBLIC_MQTT_TOPIC_QR_TOKEN ||
      `${prefix}/dispensers/{dispenserId}/qr-token`,
    scan:
      process.env.NEXT_PUBLIC_MQTT_TOPIC_SCAN ||
      `${prefix}/dispensers/{dispenserId}/scan`,
    session:
      process.env.NEXT_PUBLIC_MQTT_TOPIC_SESSION ||
      `${prefix}/dispensers/{dispenserId}/session`,
    dispense:
      process.env.NEXT_PUBLIC_MQTT_TOPIC_DISPENSE ||
      `${prefix}/dispensers/{dispenserId}/dispense`,
    status:
      process.env.NEXT_PUBLIC_MQTT_TOPIC_STATUS ||
      `${prefix}/dispensers/{dispenserId}/status`,
  } satisfies TopicTemplates,
  mqtt: {
    url: process.env.NEXT_PUBLIC_MQTT_URL || "ws://localhost:9001",
    username: process.env.NEXT_PUBLIC_MQTT_USERNAME || undefined,
    password: process.env.NEXT_PUBLIC_MQTT_PASSWORD || undefined,
    clientIdPrefix: process.env.NEXT_PUBLIC_MQTT_CLIENT_ID_PREFIX || prefix,
    qos: qos(process.env.NEXT_PUBLIC_MQTT_QOS),
    keepaliveSeconds: int(process.env.NEXT_PUBLIC_MQTT_KEEPALIVE_SECONDS, 30),
    reconnectPeriodMs: int(process.env.NEXT_PUBLIC_MQTT_RECONNECT_PERIOD_MS, 2000),
    connectTimeoutMs: int(process.env.NEXT_PUBLIC_MQTT_CONNECT_TIMEOUT_MS, 10_000),
    publishTimeoutMs: int(process.env.NEXT_PUBLIC_MQTT_PUBLISH_TIMEOUT_MS, 8000),
  } satisfies MqttSettings,
  mock: {
    latencyMs: int(process.env.NEXT_PUBLIC_MOCK_LATENCY_MS, 600),
    cupDelayMs: int(process.env.NEXT_PUBLIC_MOCK_CUP_DELAY_MS, 3000),
    flowRateLitresPerSecond: float(process.env.NEXT_PUBLIC_MOCK_FLOW_RATE, 1),
    failureRate: Math.min(1, Math.max(0, float(process.env.NEXT_PUBLIC_MOCK_FAILURE_RATE, 0))),
  } satisfies MockSettings,
  timings: {
    sessionAckTimeoutMs: int(process.env.NEXT_PUBLIC_SESSION_ACK_TIMEOUT_MS, 10_000),
    selectionTimeoutMs: int(process.env.NEXT_PUBLIC_KIOSK_SELECTION_TIMEOUT_MS, 60_000),
    cupTimeoutMs: int(process.env.NEXT_PUBLIC_CUP_TIMEOUT_MS, 60_000),
    dispenseStallTimeoutMs: int(process.env.NEXT_PUBLIC_KIOSK_DISPENSE_STALL_TIMEOUT_MS, 30_000),
    pauseTimeoutMs: int(process.env.NEXT_PUBLIC_PAUSE_TIMEOUT_MS, 15_000),
    qrTokenRotateMs: int(process.env.NEXT_PUBLIC_QR_TOKEN_ROTATE_MS, 5 * 60_000),
    completeHoldMs: int(process.env.NEXT_PUBLIC_KIOSK_COMPLETE_MS, 2600),
    thankYouDurationMs: int(process.env.NEXT_PUBLIC_KIOSK_THANK_YOU_MS, 2000),
    errorDurationMs: int(process.env.NEXT_PUBLIC_KIOSK_ERROR_MS, 10_000),
  } satisfies FlowTimings,
};

export type RuntimeConfig = typeof runtimeConfig;
