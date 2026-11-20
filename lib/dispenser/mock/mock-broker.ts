import { TopicRouter } from "../topic-router";
import type { Unsubscribe } from "../types";

const CHANNEL_NAME = "elixir-mock-broker";

interface WireMessage {
  topic: string;
  payload: string;
  retain?: boolean;
}

/**
 * A tiny in-browser pub/sub "broker". Messages are delivered to subscribers in
 * the same tab and mirrored to other tabs of the same origin through
 * BroadcastChannel — so you can open the kiosk and `/scan/<id>` side by side
 * and watch the full flow without a real broker. Supports retained messages
 * like MQTT (last one per topic is replayed to new subscribers).
 */
class MockBroker {
  private readonly router = new TopicRouter();
  private readonly retained = new Map<string, string>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<WireMessage>) => {
        const { topic, payload, retain } = event.data ?? {};
        if (typeof topic === "string" && typeof payload === "string") {
          if (retain) this.retained.set(topic, payload);
          this.router.dispatch(topic, payload);
        }
      };
    }
  }

  publish(topic: string, payload: string, retain = false) {
    if (retain) this.retained.set(topic, payload);
    // Deliver asynchronously, like a real network round-trip.
    setTimeout(() => this.router.dispatch(topic, payload), 0);
    this.channel?.postMessage({ topic, payload, retain } satisfies WireMessage);
  }

  subscribe(topic: string, handler: (payload: string) => void): Unsubscribe {
    const off = this.router.add(topic, handler);
    const last = this.retained.get(topic);
    if (last !== undefined) setTimeout(() => handler(last), 0);
    return off;
  }
}

let broker: MockBroker | null = null;

export function getMockBroker() {
  broker ??= new MockBroker();
  return broker;
}
