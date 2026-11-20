"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { findDispenser } from "@/config/dispensers";
import { BrandMark } from "@/components/brand/brand-mark";
import { DispenserGatewayProvider } from "@/components/providers/gateway-provider";
import { useStoredDispenserId } from "@/lib/kiosk/dispenser-storage";
import { KioskStage } from "./kiosk-stage";
import { KioskProvider } from "./kiosk-provider";

/**
 * Resolves which dispenser this kiosk controls (from local storage) and sets
 * up the gateway + session state for every kiosk screen. Sends the admin to
 * `/setup` when nothing (or an unknown id) is stored.
 */
export function KioskShell({ children }: { children: ReactNode }) {
  const storedId = useStoredDispenserId();
  const dispenser = findDispenser(storedId);
  const needsSetup = storedId !== undefined && !dispenser;
  const router = useRouter();

  useEffect(() => {
    if (needsSetup) router.replace("/setup");
  }, [needsSetup, router]);

  if (!dispenser) {
    // Children are gated pages (<KioskGate>) and render nothing until configured.
    return (
      <KioskStage>
        <Splash />
        {children}
      </KioskStage>
    );
  }

  return (
    <KioskStage>
      <DispenserGatewayProvider key={dispenser.id}>
        <KioskProvider dispenser={dispenser}>{children}</KioskProvider>
      </DispenserGatewayProvider>
    </KioskStage>
  );
}

function Splash() {
  return (
    <div className="grid h-full place-items-center" aria-busy="true">
      <div className="animate-pulse">
        <BrandMark className="text-6xl" priority />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
