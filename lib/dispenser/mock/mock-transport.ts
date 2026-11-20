import { ConnectionStateStore, type MessageTransport } from "../message-gateway";
import { GatewayError } from "../errors";
import { getMockBroker } from "./mock-broker";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `MessageTransport` backed by the in-browser mock broker. */
export class MockTransport implements MessageTransport {
  private readonly state = new ConnectionStateStore();
  private readonly unsubscribers = new Set<() => void>();

  constructor(private readonly options: { latencyMs: number }) {}

  getConnectionState = () => this.state.get();

  onConnectionStateChange(listener: Parameters<ConnectionStateStore["subscribe"]>[0]) {
    return this.state.subscribe(listener);
  }

  async connect() {
    if (this.state.get() === "connected") return;
    this.state.set("connecting");
    await delay(Math.min(this.options.latencyMs, 400));
    this.state.set("connected");
  }

  async disconnect() {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.clear();
    this.state.set("disconnected");
  }

  async publish(topic: string, payload: string, options: { retain?: boolean } = {}) {
    if (this.state.get() !== "connected") {
      throw new GatewayError("NOT_CONNECTED", "Mock transport is not connected");
    }
    getMockBroker().publish(topic, payload, options.retain);
  }

  subscribe(topic: string, handler: (payload: string) => void) {
    const off = getMockBroker().subscribe(topic, (payload) => {
      // Like a real client, a disconnected transport receives nothing.
      if (this.state.get() === "connected") handler(payload);
    });
    this.unsubscribers.add(off);
    return () => {
      off();
      this.unsubscribers.delete(off);
    };
  }
}
