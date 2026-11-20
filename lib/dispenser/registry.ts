import type { RuntimeConfig, TransportName } from "@/config/runtime";
import { GatewayError } from "./errors";
import type { DispenserGateway } from "./types";

export type GatewayFactory = (config: RuntimeConfig) => Promise<DispenserGateway>;

/**
 * Available gateway implementations, keyed by `NEXT_PUBLIC_DISPENSER_TRANSPORT`.
 * Each entry is loaded on demand, so unused transports (and their
 * dependencies, e.g. the MQTT client) are never downloaded.
 *
 * To add a transport: implement `DispenserGateway` (or a `MessageTransport`
 * wrapped in `MessageDispenserGateway`) and add a loader here.
 */
const factories: Record<TransportName, GatewayFactory> = {
  mock: async (config) => {
    const [{ MessageDispenserGateway }, { MockTransport }, { ensureMockController }] =
      await Promise.all([
        import("./message-gateway"),
        import("./mock/mock-transport"),
        import("./mock/mock-controller"),
      ]);
    ensureMockController(config.topics, config.mock);
    return new MessageDispenserGateway("mock", new MockTransport(config.mock), config.topics);
  },
  mqtt: async (config) => {
    const [{ MessageDispenserGateway }, { MqttTransport }] = await Promise.all([
      import("./message-gateway"),
      import("./mqtt/mqtt-transport"),
    ]);
    return new MessageDispenserGateway("mqtt", new MqttTransport(config.mqtt), config.topics);
  },
};

export async function createDispenserGateway(config: RuntimeConfig): Promise<DispenserGateway> {
  const factory = factories[config.transport];
  if (!factory) {
    throw new GatewayError("UNSUPPORTED_TRANSPORT", `Unknown transport "${config.transport}"`);
  }
  return factory(config);
}
