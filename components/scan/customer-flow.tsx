"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { brand } from "@/config/brand";
import { litreOptionsFor, flowRateFor, type DispenserDefinition } from "@/config/dispensers";
import { runtimeConfig } from "@/config/runtime";
import { CountdownRing } from "@/components/kiosk/countdown-ring";
import { Button } from "@/components/ui/button";
import { AlertIcon, CheckIcon, CupIcon, DropIcon, PauseIcon, PhoneIcon, QrIcon } from "@/components/ui/icons";
import { ScreenHeading } from "@/components/ui/screen-heading";
import { describeAmount, formatLitres } from "@/lib/format";
import { useLoaderProgress, type LoaderState, type PourClock } from "@/lib/loader";
import { dispenserPathFromQr } from "@/lib/qr/scan-url";
import { QrScanner } from "./qr-scanner";
import { useCustomerSession } from "./use-customer-session";

/**
 * Everything the customer does happens here, on their phone: connect, pick an
 * amount, follow the pour. The kiosk screen mirrors the session.
 *
 * The QR link carries a one-time token (`?t=`). We read it once and strip it
 * from the address bar right away, so reloading or navigating back lands on
 * the "scan again" prompt instead of reconnecting — the controller would
 * reject the used token anyway.
 */
export function CustomerFlow({ dispenser }: { dispenser: DispenserDefinition }) {
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get("t"));

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("t")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!token) {
    return (
      <StatusCard
        key="scan"
        tone="neutral"
        icon={<QrIcon className="size-10" />}
        title={brand.copy.scanAgainTitle}
        message={brand.copy.scanAgainMessage}
      >
        <ScanAgainButton />
      </StatusCard>
    );
  }

  return <Session dispenser={dispenser} token={token} />;
}

function Session({ dispenser, token }: { dispenser: DispenserDefinition; token: string }) {
  const { state, connectionState, chooseAmount, retry } = useCustomerSession(
    dispenser.id,
    token,
    flowRateFor(dispenser),
  );

  const unreachable = state.phase === "connecting" && connectionState === "error";

  if (state.phase === "failed" || unreachable) {
    const retryable = state.phase !== "failed" || state.retryable;
    return (
      <StatusCard
        key="failed"
        tone="danger"
        icon={<AlertIcon className="size-10" />}
        title={retryable ? "Something went wrong" : "Please scan again"}
        message={state.phase === "failed" ? state.reason : "We couldn't reach the dispenser network."}
      >
        <div className="grid gap-3">
          {retryable && (
            <Button size="lg" className="w-full" onClick={retry}>
              Try again
            </Button>
          )}
          <ScanAgainButton variant={retryable ? "secondary" : "primary"} />
        </div>
      </StatusCard>
    );
  }

  switch (state.phase) {
    case "connecting":
    case "waiting":
      return (
        <StatusCard
          key="connecting"
          tone="neutral"
          icon={<PhoneIcon className="size-10 animate-pulse" />}
          title={brand.copy.phoneConnectingTitle}
          message={`${dispenser.name} · ${dispenser.location}`}
          busy
        />
      );

    case "selecting":
      return <AmountPicker key={state.sessionId} dispenser={dispenser} onChoose={chooseAmount} />;

    case "placing":
      return (
        <StatusCard
          key="placing"
          tone="neutral"
          icon={<CupIcon className="size-10 animate-bounce" />}
          title={brand.copy.placeCupTitle}
          message={brand.copy.placeCupSubtitle}
          busy
        >
          <p className="inline-block rounded-full bg-surface-muted px-4 py-1.5 font-semibold tabular-nums">
            {formatLitres(state.litres)} L · {dispenser.name}
          </p>
        </StatusCard>
      );

    case "dispensing":
    case "paused":
    case "finishing": {
      const finished = state.phase === "finishing";
      const paused = state.phase === "paused";
      return (
        <StatusCard
          key="dispensing"
          tone={finished ? "success" : paused ? "warning" : "neutral"}
          icon={
            finished ? (
              <CheckIcon className="size-10" />
            ) : paused ? (
              <PauseIcon className="size-10" />
            ) : (
              <DropIcon className="size-10 animate-bounce" />
            )
          }
          title={finished ? "All done!" : paused ? brand.copy.phonePausedTitle : brand.copy.phoneDispensingTitle}
          message={
            finished ? "Your refill is ready." : paused ? brand.copy.phonePausedMessage : brand.copy.phoneDispensingMessage
          }
          busy={!finished}
        >
          <PourProgress
            litres={state.litres}
            clock={state.phase === "finishing" ? DONE_CLOCK : state}
            loader={finished ? "finished" : paused ? "paused" : "running"}
          />
          {state.phase === "paused" && (
            <div className="mt-5 flex justify-center">
              <PauseCountdown key={state.pausedAt ?? 0} pausedAt={state.pausedAt ?? state.startedAt} />
            </div>
          )}
        </StatusCard>
      );
    }

    case "completed":
      return (
        <StatusCard
          key="completed"
          tone="success"
          icon={<CheckIcon className="size-10" />}
          title={brand.copy.phoneDoneTitle}
          message={brand.copy.phoneDoneMessage}
        >
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-muted-foreground">
            You received <strong className="text-foreground">{formatLitres(state.dispensedLitres)} L</strong> from{" "}
            {dispenser.name}.
          </p>
          <ul className="mt-6 grid gap-2 text-left">
            {brand.promo.highlights.map((h) => (
              <li key={h.title} className="flex items-center gap-3 text-sm">
                <DropIcon className="size-4 shrink-0 text-primary" />
                <span>
                  <span className="font-semibold">{h.title}</span>{" "}
                  <span className="text-muted-foreground">— {h.description}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-border pt-6">
            <p className="mb-3 text-sm text-muted-foreground">{brand.copy.refillAgainMessage}</p>
            <ScanAgainButton />
          </div>
        </StatusCard>
      );

    case "expired":
      return (
        <StatusCard
          key="expired"
          tone="neutral"
          icon={<AlertIcon className="size-10" />}
          title="Session expired"
          message="You didn't choose an amount in time. Scan the dispenser's QR code to start again."
        >
          <ScanAgainButton />
        </StatusCard>
      );
  }
}

/**
 * Opens the in-app scanner. A valid dispenser code replaces the current page
 * (no history entry), starting a fresh session with the new one-time token.
 */
function ScanAgainButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const handleResult = useCallback((value: string) => {
    const path = dispenserPathFromQr(value);
    if (!path) return false;
    window.location.replace(path);
    return true;
  }, []);

  return (
    <>
      <Button size="lg" variant={variant} className="w-full" onClick={() => setOpen(true)}>
        <QrIcon className="size-5" />
        {brand.copy.scanAgainLabel}
      </Button>
      {open && <QrScanner onResult={handleResult} onClose={close} />}
    </>
  );
}

const DONE_CLOCK: PourClock = { startedAt: 0, pausedTotal: 0, pausedAt: null };

/** Classic loader: trickles while pouring, freezes while paused, fills quickly on finish. */
function PourProgress({ litres, clock, loader }: { litres: number; clock: PourClock; loader: LoaderState }) {
  const { progress, transitionMs, easing } = useLoaderProgress(loader, clock);
  const finished = loader === "finished";
  return (
    <>
      <div
        role="progressbar"
        aria-label={`Dispensing ${formatLitres(litres)} litres`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={finished ? 100 : undefined}
        className="h-4 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          data-motion="essential"
          className="water-fill h-full rounded-full"
          style={{
            width: `${progress * 100}%`,
            transitionProperty: "width",
            transitionDuration: `${transitionMs}ms`,
            transitionTimingFunction: easing,
          }}
        />
      </div>
      <p className="mt-3 text-lg font-semibold tabular-nums">{formatLitres(litres)} L</p>
    </>
  );
}

/** Seconds left to put the cup back (the dispenser ends the refill after the pause timeout). */
function PauseCountdown({ pausedAt }: { pausedAt: number }) {
  const total = runtimeConfig.timings.pauseTimeoutMs;
  const [left, setLeft] = useState(Math.ceil(total / 1000));
  useEffect(() => {
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((total - (Date.now() - pausedAt)) / 1000));
      setLeft(s);
      if (s === 0) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [pausedAt, total]);
  return (
    <p role="timer" className="inline-flex items-baseline gap-2 rounded-full bg-amber-400/15 px-4 py-2 text-amber-200">
      <span className="text-2xl font-bold tabular-nums">{left}s</span>
      <span className="text-sm">left to put your cup back</span>
    </p>
  );
}

function AmountPicker({
  dispenser,
  onChoose,
}: {
  dispenser: DispenserDefinition;
  onChoose: (litres: number) => void;
}) {
  const options = litreOptionsFor(dispenser);
  const max = Math.max(...options);

  return (
    <section className="animate-fade-up">
      <ScreenHeading className="text-3xl font-bold tracking-tight">{brand.copy.selectTitle}</ScreenHeading>
      <p className="mt-1 text-muted-foreground">{brand.copy.selectSubtitle}</p>

      <ul className="mt-6 grid grid-cols-2 gap-3">
        {options.map((litres, i) => (
          <li key={litres} className="animate-fade-up" style={{ animationDelay: `${60 + i * 50}ms` }}>
            <button
              type="button"
              onClick={() => onChoose(litres)}
              aria-label={`${formatLitres(litres)} litres — ${describeAmount(litres)}`}
              className="group relative flex h-32 w-full flex-col justify-end overflow-hidden rounded-card border border-border bg-surface p-4 text-left shadow-card transition-[border-color,transform] duration-200 active:scale-[0.97] hover:border-primary touch-manipulation"
            >
              <span
                aria-hidden="true"
                className="water-fill absolute inset-x-0 bottom-0 opacity-15 transition-opacity group-active:opacity-40"
                style={{ height: `${15 + (litres / max) * 65}%` }}
              />
              <span className="relative text-4xl font-bold tracking-tight tabular-nums">
                {formatLitres(litres)}
                <span className="ml-1 text-xl font-semibold text-muted-foreground">L</span>
              </span>
              <span className="relative text-sm font-medium text-muted-foreground">{describeAmount(litres)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-center">
        <CountdownRing durationMs={runtimeConfig.timings.selectionTimeoutMs} label="Session ends" />
      </div>
    </section>
  );
}

const tones = {
  neutral: "bg-surface-muted text-primary",
  warning: "bg-amber-400/15 text-amber-300",
  success: "bg-success/15 text-success",
  danger: "bg-danger-soft text-danger",
};

function StatusCard({
  tone,
  icon,
  title,
  message,
  busy = false,
  children,
}: {
  tone: keyof typeof tones;
  icon: ReactNode;
  title: string;
  message: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      aria-busy={busy}
      className="rounded-card border border-border bg-surface p-8 text-center shadow-card animate-scale-in"
    >
      <div className={`mx-auto grid size-20 place-items-center rounded-full ${tones[tone]}`}>{icon}</div>
      <ScreenHeading className="mt-6 text-3xl font-bold tracking-tight">{title}</ScreenHeading>
      <p className="mt-3 text-lg text-muted-foreground" aria-live="polite">
        {message}
      </p>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}
