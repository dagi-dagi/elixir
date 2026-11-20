/**
 * Mock dispenser firmware — runs separately from the Next.js app and talks to
 * the real MQTT broker, playing both the controller (answers scans) and the
 * dispenser hardware (cup sensor + pump).
 *
 *   npm run firmware        (reads .env.local)
 *
 * Dashboard: http://127.0.0.1:4001 (FIRMWARE_UI_HOST / FIRMWARE_UI_PORT)
 */

import mqtt from "mqtt";
import { firmwareConfig as config } from "./config.ts";
import { startDashboard, type BrokerStatus } from "./dashboard.ts";
import { Firmware } from "./firmware.ts";

const redactedUrl = config.mqtt.url.replace(/\/\/[^@/]*@/, "//");
const clientId = `${config.mqtt.clientIdPrefix}-${Math.random().toString(16).slice(2, 10)}`;

const broker: BrokerStatus = { state: "connecting", url: redactedUrl, clientId, lastError: null };

const client = mqtt.connect(config.mqtt.url, {
  clientId,
  username: config.mqtt.username,
  password: config.mqtt.password,
  keepalive: config.mqtt.keepaliveSeconds,
  reconnectPeriod: config.mqtt.reconnectPeriodMs,
  connectTimeout: config.mqtt.connectTimeoutMs,
  clean: true,
});

const firmware = new Firmware(config, async (topic, payload) => {
  if (!client.connected) throw new Error("Not connected to broker");
  await client.publishAsync(topic, payload, { qos: config.mqtt.qos, retain: false });
});

const dashboard = await startDashboard(firmware, () => broker, config.ui);

function setBroker(state: BrokerStatus["state"], lastError: string | null = broker.lastError) {
  broker.state = state;
  broker.lastError = lastError;
  dashboard.refresh();
}

client.on("connect", async () => {
  setBroker("connected", null);
  firmware.log("info", `Connected to ${redactedUrl} as ${clientId}`);
  try {
    await client.subscribeAsync(firmware.subscriptions(), { qos: config.mqtt.qos });
    firmware.log("info", `Subscribed to ${firmware.subscriptions().length} topics for dispensers ${config.dispensers.map((d) => d.id).join(", ")}`);
  } catch (error) {
    firmware.log("warn", `Subscribe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
client.on("reconnect", () => setBroker("reconnecting"));
client.on("offline", () => setBroker("offline"));
client.on("error", (error) => {
  firmware.log("warn", `Broker error: ${error.message}`);
  setBroker(client.connected ? "connected" : "error", error.message);
});
client.on("message", (topic, payload) => firmware.handleMessage(topic, payload.toString("utf8")));

console.log(`\n  Mock firmware dashboard → ${dashboard.url}\n  Broker → ${redactedUrl}\n`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nShutting down…");
  firmware.shutdown();
  await Promise.allSettled([client.endAsync(), dashboard.close()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
