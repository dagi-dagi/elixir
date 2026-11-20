import type { Unsubscribe } from "./types";

type Handler = (payload: string) => void;

/**
 * Fan-out of incoming messages to any number of local handlers per topic.
 * Calls `onFirst` / `onLast` so the transport only holds broker subscriptions
 * for topics someone is actually listening to.
 */
export class TopicRouter {
  private handlers = new Map<string, Set<Handler>>();

  constructor(
    private readonly hooks: {
      onFirst?: (topic: string) => void;
      onLast?: (topic: string) => void;
    } = {},
  ) {}

  add(topic: string, handler: Handler): Unsubscribe {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      this.hooks.onFirst?.(topic);
    }
    set.add(handler);

    return () => {
      const current = this.handlers.get(topic);
      if (!current?.delete(handler) || current.size > 0) return;
      this.handlers.delete(topic);
      this.hooks.onLast?.(topic);
    };
  }

  has(topic: string) {
    return this.handlers.has(topic);
  }

  topics() {
    return [...this.handlers.keys()];
  }

  dispatch(topic: string, payload: string) {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (error) {
        // One faulty listener must never break delivery to the others.
        console.error(`[dispenser] Handler for "${topic}" threw`, error);
      }
    }
  }
}
