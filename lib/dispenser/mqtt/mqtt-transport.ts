import type { IClientOptions, MqttClient } from "mqtt";
import type { MqttSettings } from "@/config/runtime";
import { GatewayError, withTimeout } from "../errors";
import { ConnectionStateStore, type MessageTransport } from "../message-gateway";
import { TopicRouter } from "../topic-router";

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

/**
 * MQTT over WebSockets (MQTT.js). The `mqtt` package is loaded lazily so it
 * never lands in the bundle when another transport is configured.
 *
 * Reconnection is handled by MQTT.js (`reconnectPeriod`); subscriptions are
 * re-established on every (re)connect because we use clean sessions.
 */
export class MqttTransport implements MessageTransport {
  private client: MqttClient | null = null;
  private readonly state = new ConnectionStateStore();
  private readonly decoder = new TextDecoder();
  private readonly router = new TopicRouter({
    onFirst: (topic) => this.brokerSubscribe(topic),
    onLast: (topic) => this.brokerUnsubscribe(topic),
  });

  constructor(private readonly settings: MqttSettings) {}

  getConnectionState = () => this.state.get();

  onConnectionStateChange(listener: Parameters<ConnectionStateStore["subscribe"]>[0]) {
    return this.state.subscribe(listener);
  }

  async connect() {
    if (!this.client) await this.createClient();
    if (this.state.get() === "connected") return;
    await this.waitUntilConnected();
  }

  private async createClient() {
    this.state.set("connecting");

    let connect: typeof import("mqtt").connect;
    try {
      const mod = await import("mqtt");
      // The browser ESM build only exposes `connect` on the default export.
      connect = mod.connect ?? mod.default.connect;
      if (typeof connect !== "function") throw new Error("mqtt.connect not found");
    } catch (cause) {
      this.state.set("error");
      throw new GatewayError("CONNECTION_FAILED", "Failed to load the MQTT client", { cause });
    }

    const options: IClientOptions = {
      clientId: `${this.settings.clientIdPrefix}-${randomSuffix()}`,
      username: this.settings.username,
      password: this.settings.password,
      keepalive: this.settings.keepaliveSeconds,
      reconnectPeriod: this.settings.reconnectPeriodMs,
      connectTimeout: this.settings.connectTimeoutMs,
      clean: true,
      // We resubscribe ourselves on "connect" so the topic list stays in sync with the router.
      resubscribe: false,
    };

    const client = connect(this.settings.url, options);
    this.client = client;

    client.on("connect", () => {
      this.state.set("connected");
      for (const topic of this.router.topics()) this.brokerSubscribe(topic);
    });
    client.on("reconnect", () => this.state.set("reconnecting"));
    client.on("offline", () => this.state.set("disconnected"));
    client.on("close", () => {
      if (this.state.get() === "connected") this.state.set("disconnected");
    });
    client.on("error", (error) => {
      console.error("[mqtt] client error", error);
      if (this.state.get() !== "connected") this.state.set("error");
    });
    client.on("message", (topic, payload) => {
      this.router.dispatch(topic, this.decoder.decode(payload));
    });
  }

  private waitUntilConnected() {
    let off = () => {};
    const connected = new Promise<void>((resolve) => {
      off = this.state.subscribe((s) => {
        if (s === "connected") resolve();
      });
    });
    return withTimeout(connected, this.settings.connectTimeoutMs, "MQTT connect")
      .catch((cause: unknown) => {
        // MQTT.js keeps retrying in the background; the UI follows state changes.
        throw new GatewayError(
          "CONNECTION_FAILED",
          `Could not connect to MQTT broker at ${this.settings.url}`,
          { cause },
        );
      })
      .finally(() => off());
  }

  async disconnect() {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.endAsync();
    } finally {
      this.state.set("disconnected");
    }
  }

  async publish(topic: string, payload: string, options: { retain?: boolean } = {}) {
    const client = this.client;
    if (!client?.connected) {
      throw new GatewayError("NOT_CONNECTED", "MQTT client is not connected");
    }
    try {
      await withTimeout(
        client.publishAsync(topic, payload, { qos: this.settings.qos, retain: options.retain ?? false }),
        this.settings.publishTimeoutMs,
        `Publish to ${topic}`,
      );
    } catch (cause) {
      if (cause instanceof GatewayError) throw cause;
      throw new GatewayError("PUBLISH_FAILED", `Failed to publish to ${topic}`, { cause });
    }
  }

  subscribe(topic: string, handler: (payload: string) => void) {
    return this.router.add(topic, handler);
  }

  private brokerSubscribe(topic: string) {
    const client = this.client;
    if (!client?.connected) return; // will subscribe on "connect"
    client.subscribeAsync(topic, { qos: this.settings.qos }).catch((error: unknown) => {
      console.error(`[mqtt] subscribe to "${topic}" failed`, error);
    });
  }

  private brokerUnsubscribe(topic: string) {
    const client = this.client;
    if (!client?.connected) return;
    client.unsubscribeAsync(topic).catch((error: unknown) => {
      console.error(`[mqtt] unsubscribe from "${topic}" failed`, error);
    });
  }
}
