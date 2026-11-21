import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { brand } from "@/config/brand";
import { dispensers, findDispenser } from "@/config/dispensers";
import { BrandMark, PartnerMark } from "@/components/brand/brand-mark";
import { DispenserGatewayProvider } from "@/components/providers/gateway-provider";
import { CustomerFlow } from "@/components/scan/customer-flow";

/** Every known dispenser gets a prerendered page. */
export function generateStaticParams() {
  return dispensers.map((d) => ({ dispenserId: d.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/scan/[dispenserId]">): Promise<Metadata> {
  const { dispenserId } = await params;
  const dispenser = findDispenser(dispenserId);
  if (!dispenser) return { title: "Dispenser not found" };
  return {
    title: `Start ${dispenser.name}`,
    description: `${brand.tagline} Connect to ${dispenser.name} and refill in seconds.`,
    robots: { index: false, follow: false },
  };
}

/**
 * Opened on the customer's phone after scanning the kiosk QR code.
 * The frame is URL-independent; only the part that reads `params` sits
 * behind Suspense so the shell can be shared and prefetched.
 */
export default function ScanPage({ params }: PageProps<"/scan/[dispenserId]">) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 py-8">
      <header className={`flex items-center gap-4 ${brand.partner ? "justify-between" : "justify-center"}`}>
        <BrandMark className="text-[0.95rem]" priority />
        <PartnerMark className="text-[0.8rem]" />
      </header>
      <main className="flex flex-1 flex-col justify-center py-10">
        <Suspense fallback={<ConnectingSkeleton />}>
          <ScanContent params={params} />
        </Suspense>
      </main>
      <footer className="text-center text-sm text-muted-foreground">
        {brand.name} · {brand.tagline}
      </footer>
    </div>
  );
}

async function ScanContent({ params }: Pick<PageProps<"/scan/[dispenserId]">, "params">) {
  const { dispenserId } = await params;
  const dispenser = findDispenser(dispenserId);
  if (!dispenser) notFound();

  return (
    <DispenserGatewayProvider>
      <CustomerFlow dispenser={dispenser} />
    </DispenserGatewayProvider>
  );
}

function ConnectingSkeleton() {
  return (
    <div
      aria-busy="true"
      className="h-80 rounded-card border border-border bg-surface shadow-card animate-pulse"
    >
      <span className="sr-only">Loading…</span>
    </div>
  );
}
