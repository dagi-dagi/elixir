import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandMark />
      <h1 className="text-3xl font-bold tracking-tight animate-fade-up">We couldn&apos;t find that page</h1>
      <p className="text-lg text-muted-foreground">
        If you scanned a QR code, please scan it again from the dispenser screen.
      </p>
      <Link href="/" className={buttonClasses({ size: "lg" })}>
        Go home
      </Link>
    </div>
  );
}
