import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
import { KioskStage } from "@/components/kiosk/kiosk-stage";
import { SetupForm } from "@/components/setup/setup-form";

export const metadata: Metadata = {
  title: "Dispenser setup",
  robots: { index: false, follow: false },
};

/** Admin screen, shown on the kiosk display itself — so it uses the same fixed-ratio stage. */
export default function SetupPage() {
  return (
    <KioskStage>
      <div className="flex h-full flex-col px-12 py-12">
        <header className="flex items-center justify-between">
          <BrandMark className="text-4xl" priority />
          <span className="rounded-full border border-border bg-surface px-5 py-2 text-xl font-medium text-muted-foreground">
            Admin
          </span>
        </header>
        <main className="flex flex-1 flex-col justify-center py-10">
          <SetupForm />
        </main>
      </div>
    </KioskStage>
  );
}
