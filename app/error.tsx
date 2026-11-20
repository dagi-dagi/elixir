"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button, buttonClasses } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import { ScreenHeading } from "@/components/ui/screen-heading";
import { CountdownRing } from "@/components/kiosk/countdown-ring";

const AUTO_RELOAD_MS = 30_000;

/**
 * Unexpected-error screen. Kiosks are unattended, so after a while we do a
 * full reload to recover instead of leaving the screen stuck.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const timer = setTimeout(() => window.location.reload(), AUTO_RELOAD_MS);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandMark />
      <div className="grid size-20 place-items-center rounded-full bg-danger-soft text-danger animate-scale-in">
        <AlertIcon className="size-10" />
      </div>
      <div className="animate-fade-up">
        <ScreenHeading className="text-3xl font-bold tracking-tight">Something went wrong</ScreenHeading>
        <p className="mt-2 text-lg text-muted-foreground">
          Sorry about that. Please try again in a moment.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Back to start
        </Link>
      </div>
      <CountdownRing durationMs={AUTO_RELOAD_MS} label="Reloading automatically" />
    </div>
  );
}
