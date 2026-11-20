import type { TopicTemplates } from "@/config/runtime";
import { GatewayError } from "./errors";
import { decode, encode, topicsFor } from "./protocol";
import type {
  ConnectionState,
  DispenseCommand,
  DispenseEvent,
  DispenserGateway,
  SessionEvent,
  SessionRequest,
  Unsubscribe,
} from "./types";

/**
 * Minimal publish/subscribe transport. MQTT, the mock broker, or any other
 * topic-based bus can implement this and get a full `DispenserGateway` via
 * `MessageDispenserGateway`.
 */
export interface MessageTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  onConnectionStateChange(listener: (state: ConnectionState) => void): Unsubscribe;
  /** `retain`: the broker keeps the last message and delivers it to new subscribers. */
  publish(topic: string, payload: string, options?: { retain?: boolean }): Promise<void>;
  subscribe(topic: string, handler: (payload: string) => void): Unsubscribe;
}

/** Small observable used by transports to track connection state. */
export class ConnectionStateStore {
  private state: ConnectionState = "idle";
  private listeners = new Set<(state: ConnectionState) => void>();

  get = () => this.state;

  set(next: ConnectionState) {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: (state: ConnectionState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function warnInvalid(topic: string, payload: string) {
  console.warn(`[dispenser] Ignoring invalid payload on "${topic}":`, payload);
}

/** Maps the domain-level gateway API onto topic-based messages. */
export class MessageDispenserGateway implements DispenserGateway {
  constructor(
    readonly name: string,
    private readonly transport: MessageTransport,
    private readonly topics: TopicTemplates,
  ) {}

  connect() {
    return this.transport.connect();
  }

  disconnect() {
    return this.transport.disconnect();
  }

  getConnectionState() {
    return this.transport.getConnectionState();
  }

  onConnectionStateChange(listener: (state: ConnectionState) => void) {
    return this.transport.onConnectionStateChange(listener);
  }

  private ensureConnected() {
    if (this.transport.getConnectionState() !== "connected") {
      throw new GatewayError("NOT_CONNECTED", "Gateway is not connected");
    }
  }

  async requestSession(request: SessionRequest) {
    this.ensureConnected();
    const { scan } = topicsFor(this.topics, request.dispenserId);
    await this.transport.publish(scan, encode.scan(request));
  }

  onSession(dispenserId: string, listener: (event: SessionEvent) => void) {
    const { session } = topicsFor(this.topics, dispenserId);
    return this.transport.subscribe(session, (payload) => {
      const event = decode.session(payload, dispenserId);
      if (event) listener(event);
      else warnInvalid(session, payload);
    });
  }

  async announceQrToken(dispenserId: string, token: string) {
    this.ensureConnected();
    const { qrToken } = topicsFor(this.topics, dispenserId);
    await this.transport.publish(qrToken, encode.qrToken(dispenserId, token), { retain: true });
  }

  onQrToken(dispenserId: string, listener: (token: string) => void) {
    const { qrToken } = topicsFor(this.topics, dispenserId);
    return this.transport.subscribe(qrToken, (payload) => {
      const token = decode.qrToken(payload, dispenserId);
      if (token) listener(token);
      else warnInvalid(qrToken, payload);
    });
  }

  async requestDispense(command: DispenseCommand) {
    if (!(command.litres > 0)) {
      throw new GatewayError("INVALID_PAYLOAD", `Invalid amount: ${command.litres}`);
    }
    this.ensureConnected();
    const { dispense } = topicsFor(this.topics, command.dispenserId);
    await this.transport.publish(dispense, encode.dispense(command));
  }

  onDispenseRequested(dispenserId: string, listener: (command: DispenseCommand) => void) {
    const { dispense } = topicsFor(this.topics, dispenserId);
    return this.transport.subscribe(dispense, (payload) => {
      const command = decode.dispense(payload, dispenserId);
      if (command) listener(command);
      else warnInvalid(dispense, payload);
    });
  }

  onDispenseEvent(dispenserId: string, listener: (event: DispenseEvent) => void) {
    const { status } = topicsFor(this.topics, dispenserId);
    return this.transport.subscribe(status, (payload) => {
      const event = decode.status(payload, dispenserId);
      if (event) listener(event);
      else warnInvalid(status, payload);
    });
  }
}
