"use client";

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { runtimeConfig } from "@/config/runtime";
import { describeError } from "@/lib/dispenser/errors";
import { createDispenserGateway } from "@/lib/dispenser/registry";
import type { ConnectionState, DispenserGateway } from "@/lib/dispenser/types";

interface GatewayContextValue {
  gateway: DispenserGateway | null;
  connectionState: ConnectionState;
  /** Customer-safe description of the last connection failure. */
  error: string | null;
  /** Tear down and recreate the gateway. */
  reconnect: () => void;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

const defaultCreateGateway = () => createDispenserGateway(runtimeConfig);

/**
 * Owns the lifetime of a `DispenserGateway` and exposes it to the tree.
 *
 * Pass `createGateway` to inject a different implementation (tests,
 * storybook, a custom transport) without touching any consumer.
 */
export function DispenserGatewayProvider({
  children,
  createGateway = defaultCreateGateway,
}: {
  children: ReactNode;
  createGateway?: () => Promise<DispenserGateway>;
}) {
  const [gateway, setGateway] = useState<DispenserGateway | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let instance: DispenserGateway | null = null;
    let offState = () => {};

    (async () => {
      try {
        instance = await createGateway();
        if (disposed) {
          await instance.disconnect();
          return;
        }
        offState = instance.onConnectionStateChange((state) => {
          setConnectionState(state);
          if (state === "connected") setError(null);
        });
        setGateway(instance);
        setConnectionState(instance.getConnectionState());
        await instance.connect();
      } catch (err) {
        console.error("[gateway] connection failed", err);
        if (!disposed) {
          setError(describeError(err));
          setConnectionState((s) => (s === "connected" ? s : "error"));
        }
      }
    })();

    return () => {
      disposed = true;
      offState();
      instance?.disconnect().catch((err: unknown) => console.error("[gateway] disconnect failed", err));
    };
  }, [createGateway, attempt]);

  const reconnect = useCallback(() => {
    setGateway(null);
    setError(null);
    setConnectionState("connecting");
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ gateway, connectionState, error, reconnect }),
    [gateway, connectionState, error, reconnect],
  );

  return <GatewayContext value={value}>{children}</GatewayContext>;
}

export function useDispenserGateway() {
  const ctx = use(GatewayContext);
  if (!ctx) throw new Error("useDispenserGateway must be used inside <DispenserGatewayProvider>");
  return ctx;
}
