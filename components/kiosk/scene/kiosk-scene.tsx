"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { brand } from "@/config/brand";
import { runtimeConfig } from "@/config/runtime";
import { useDispenserGateway } from "@/components/providers/gateway-provider";
import { BrandMark, PartnerMark } from "@/components/brand/brand-mark";
import { GearIcon } from "@/components/ui/icons";
import type { KioskState } from "@/lib/kiosk/machine";
import { useKiosk } from "../kiosk-provider";
import { fmtL, SceneRenderer, type SceneMode } from "./scene-renderer";

type MessageStyle = "default" | "green" | "complete" | "error";

/**
 * The whole kiosk is this one page: an animated canvas (bottle, water,
 * particles, ring…) with the brand, messages and QR code layered on top as
 * regular DOM. Positions/sizes mirror the original 1080-wide station in rem
 * (1rem = 16 logical px on the 53:94 stage), so everything scales together.
 */
export function KioskScene() {
  const { dispenser, state } = useKiosk();
  const { connectionState } = useDispenserGateway();
  const online = connectionState === "connected";
  const mode = sceneMode(state, online);
  const [almost, setAlmost] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const modeRef = useRef<{ mode: SceneMode; since: number } | null>(null);

  // Start the renderer once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SceneRenderer(
      canvas,
      { mode: "standby", since: performance.now(), pour: null, litres: null, pauseTimeoutMs: 0, resetHoldMs: 0 },
      setAlmost,
    );
    renderer.setLabels({ ring: ringRef.current, pct: pctRef.current, vol: volRef.current });
    rendererRef.current = renderer;
    renderer.resize();
    renderer.start();
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  // Feed it the current state (only when something relevant changes).
  const pour = state.phase === "dispensing" || state.phase === "paused" ? state : null;
  const startedAt = pour?.startedAt;
  const pausedTotal = pour?.pausedTotal;
  const pausedAt = pour?.pausedAt;
  const litres = "litres" in state && typeof state.litres === "number" ? state.litres : null;
  useEffect(() => {
    const prev = modeRef.current;
    const since = prev && prev.mode === mode ? prev.since : performance.now();
    modeRef.current = { mode, since };
    rendererRef.current?.setInput({
      mode,
      since,
      pour: startedAt === undefined ? null : { startedAt, pausedTotal: pausedTotal ?? 0, pausedAt: pausedAt ?? null },
      litres,
      pauseTimeoutMs: runtimeConfig.timings.pauseTimeoutMs,
      resetHoldMs: runtimeConfig.timings.thankYouDurationMs,
    });
  }, [mode, startedAt, pausedTotal, pausedAt, litres]);

  const isAlmost = almost && mode === "filling";
  const [title, subtitle, style] = messageFor(state, online, isAlmost);
  const busy = state.phase === "placing" || state.phase === "dispensing" || state.phase === "paused";

  return (
    <div
      className="relative h-full select-none overflow-hidden text-white"
      style={{ background: "linear-gradient(160deg, var(--stage-from) 10%, var(--stage-to) 100%)" }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />

      {/* Brands (original: top 56px, height 64px, 26px / 800 / .16em) */}
      <header className="absolute inset-x-[3.75rem] top-[3.5rem] flex h-[4rem] items-center justify-between text-[1.625rem] font-extrabold tracking-[0.16em]">
        <BrandMark className="text-[1.625rem]" priority />
        <span className="inline-flex h-full items-center gap-[1.25rem]">
          {brand.partner ? (
            <PartnerMark className="text-[1.625rem]" />
          ) : (
            <span className="text-[1.25rem] uppercase">{dispenser.name}</span>
          )}
          <span
            role="status"
            title={online ? "Online" : "Offline"}
            className={`size-[0.9rem] rounded-full ${online ? "bg-[var(--stage-accent)] shadow-[0_0_0.75rem_var(--stage-accent)]" : "animate-pulse bg-amber-400"}`}
          >
            <span className="sr-only">{online ? "Dispenser online" : "Dispenser offline, reconnecting"}</span>
          </span>
          {!busy && (
            <Link
              href="/setup"
              aria-label="Dispenser settings"
              className="grid size-[3rem] place-items-center rounded-full opacity-25 transition-opacity hover:opacity-90"
            >
              <GearIcon className="size-[1.6rem]" />
            </Link>
          )}
        </span>
      </header>

      {/* Message (original #msg: top 170px, 960px wide, centered) — re-keyed so the entrance animation replays */}
      <div key={`${mode}|${title}`} aria-live="polite" className="absolute left-[3.75rem] top-[10.625rem] w-[60rem] text-center">
        <h1 className={`m-0 font-black leading-[1.02] tracking-[0.01em] ${H1_CLASS[style]}`}>{title}</h1>
        {subtitle && <p className={`mb-0 mt-[1.625rem] text-[2.5rem] leading-[1.25] ${P_CLASS[style]}`}>{subtitle}</p>}
      </div>

      {/* Standby: QR (original: 250px card at 130,1525 with animated green corners) + caption */}
      {state.phase === "idle" && online && <ScanPanel dispenserId={dispenser.id} token={state.qrToken} />}

      {/* Ring label (original #ring: 280px box at 400,1520) — text + opacity written by the renderer */}
      <div
        ref={ringRef}
        aria-hidden="true"
        className="absolute left-[25rem] top-[95rem] flex size-[17.5rem] flex-col items-center justify-center opacity-0"
      >
        <div ref={pctRef} className="text-[4.75rem] font-black leading-none tabular-nums">
          0%
        </div>
        <div ref={volRef} className="mt-[0.625rem] text-[1.75rem] text-[var(--stage-muted)]" />
      </div>
      <BottomCaption state={state} />

      {/* Footer (original: bottom 56px, 24px / 600 / .26em, standby only) */}
      <footer
        className={`absolute inset-x-0 bottom-[3.5rem] text-center text-[1.5rem] font-semibold tracking-[0.26em] text-[var(--stage-muted)] transition-opacity duration-[600ms] ${
          mode === "standby" || mode === "offline" ? "opacity-100" : "opacity-0"
        }`}
      >
        {brand.kiosk.footer}
      </footer>
    </div>
  );
}

// Typography per state, from the original stylesheet.
const H1_CLASS: Record<MessageStyle, string> = {
  default: "text-[6rem] text-white animate-scene-in",
  green: "text-[6rem] text-[var(--stage-accent)] animate-scene-in",
  complete: "text-[7rem] text-white [text-shadow:0_0_2.5rem_rgb(0_174_239/0.9)] animate-scene-pop",
  error: "text-[5rem] text-[var(--stage-accent)] animate-scene-in",
};
const P_CLASS: Record<MessageStyle, string> = {
  default: "font-medium text-[var(--stage-muted)] animate-scene-in [animation-delay:120ms]",
  green: "font-medium text-[var(--stage-muted)] animate-scene-in [animation-delay:120ms]",
  complete:
    "font-extrabold tracking-[0.2em] text-[var(--stage-accent)] animate-scene-in [animation-duration:600ms] [animation-delay:1500ms]",
  error: "font-medium text-[var(--stage-muted)] animate-scene-in [animation-delay:120ms]",
};

function sceneMode(state: KioskState, online: boolean): SceneMode {
  switch (state.phase) {
    case "idle":
      return online ? "standby" : "offline";
    case "selecting":
      return "selecting";
    case "placing":
      return "placing";
    case "dispensing":
      return "filling";
    case "paused":
      return "paused";
    case "completed":
      return "complete";
    case "thanks":
      return "reset";
    case "failed":
      return "error";
  }
}

function messageFor(state: KioskState, online: boolean, almost: boolean): readonly [string, string, MessageStyle] {
  const m = brand.kiosk.messages;
  switch (state.phase) {
    case "idle":
      return online ? [...m.idle, "default"] : [...m.offline, "default"];
    case "selecting":
      return [...m.selecting, "default"];
    case "placing":
      return [...m.placing, "default"];
    case "dispensing":
      return almost ? [...m.almost, "green"] : [...m.dispensing, "default"];
    case "paused":
      return [...m.paused, "default"];
    case "completed":
      return [...m.completed, "complete"];
    case "thanks":
      return [...m.thanks, "green"];
    case "failed":
      return [m.failed[0], state.reason, "error"];
  }
}

/** Text in the ring area for states without a progress ring. */
function BottomCaption({ state }: { state: KioskState }) {
  if (state.phase === "placing") {
    return (
      <div key="placing" className="absolute left-[25rem] top-[95rem] flex size-[17.5rem] flex-col items-center justify-center text-center animate-scene-in">
        <span className="whitespace-nowrap text-[2.75rem] font-extrabold text-[var(--stage-accent)]">
          SELECTED&nbsp;&nbsp;{fmtL(state.litres)} L
        </span>
      </div>
    );
  }
  if (state.phase === "selecting") {
    return (
      <div key="selecting" className="absolute left-[25rem] top-[95rem] flex size-[17.5rem] items-center justify-center text-center animate-scene-in">
        <span className="whitespace-nowrap text-[1.75rem] tracking-[0.16em] text-[var(--stage-muted)]">WAITING FOR YOUR CHOICE</span>
      </div>
    );
  }
  return null;
}

/** QR card bottom-left with animated corner brackets + caption on the right. */
function ScanPanel({ dispenserId, token }: { dispenserId: string; token: string }) {
  const url = scanUrlFor(dispenserId, token);
  const corners = [
    "left-0 top-0 border-l-[0.4375rem] border-t-[0.4375rem]",
    "right-0 top-0 border-r-[0.4375rem] border-t-[0.4375rem]",
    "bottom-0 left-0 border-b-[0.4375rem] border-l-[0.4375rem]",
    "bottom-0 right-0 border-b-[0.4375rem] border-r-[0.4375rem]",
  ];
  return (
    <>
      <div className="absolute left-[8.125rem] top-[95.3rem] size-[15.625rem] animate-scene-in">
        <div className="absolute inset-0 grid place-items-center rounded-[1.375rem] bg-white">
          <QRCodeSVG
            value={url}
            size={210}
            level="H"
            marginSize={0}
            fgColor="#0B2D5B"
            bgColor="#ffffff"
            title={`QR code to start dispenser ${dispenserId}`}
            imageSettings={{ src: brand.icon, width: 40, height: 40, excavate: true }}
            style={{ width: "13.125rem", height: "13.125rem" }}
          />
        </div>
        {corners.map((c, i) => (
          <span
            key={c}
            aria-hidden="true"
            className={`absolute size-[2.75rem] border-[var(--stage-accent)] drop-shadow-[0_0_0.6rem_var(--stage-accent)] animate-bracket ${c}`}
            style={{ "--bx": i % 2 ? "0.625rem" : "-0.625rem", "--by": i < 2 ? "-0.625rem" : "0.625rem" } as CSSProperties}
          />
        ))}
      </div>
      {/* Original #qrcap: left 420, top 1540, 540 wide; h2 40px/900/1.1, p 28px #cfeaf7 */}
      <div className="absolute left-[26.25rem] top-[96.25rem] w-[33.75rem] animate-scene-in">
        <h2 className="m-0 text-[2.5rem] font-black leading-[1.1]">{brand.kiosk.scanCaption}</h2>
        <p className="mb-0 mt-[0.5rem] text-[1.75rem] text-[var(--stage-muted)]">{brand.kiosk.scanHint}</p>
        {runtimeConfig.devTools && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-[1rem] inline-block text-[1rem] text-[var(--stage-muted)] underline opacity-60">
            Open phone simulator ↗
          </a>
        )}
      </div>
    </>
  );
}

/** `?t=` carries the one-time token; the controller accepts each token once. */
function scanUrlFor(dispenserId: string, token: string) {
  const base = runtimeConfig.publicUrl || (typeof window !== "undefined" ? window.location.origin : brand.url);
  const url = new URL(`/scan/${encodeURIComponent(dispenserId)}`, base);
  url.searchParams.set("t", token);
  return url.toString();
}
