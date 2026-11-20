/**
 * Canvas renderer for the kiosk scene — a port of the original
 * hydration-station animation: bottle + water, nozzle, stream, bubbles,
 * ambient particles, ribbons, progress ring, detection brackets, pause
 * symbol, completion burst and the reset tick.
 *
 * It runs its own requestAnimationFrame loop and only reads `SceneInput`
 * (updated by React on state changes), so React never re-renders per frame.
 * The ring label (percentage / volume / pause countdown) is also written
 * directly each frame, like the original.
 *
 * Everything is drawn in a fixed 1080 × 1916 logical space (the 53:94 stage)
 * and scaled to the canvas' real pixel size.
 */

import { trickleProgress, type PourClock } from "@/lib/loader";

export const SCENE_W = 1080;
export const SCENE_H = 1916;

/** Geometry shared with the DOM overlay (logical px; 1rem = 16 px on the stage). */
export const GEOMETRY = {
  bottle: { x: 540, y: 1060 },
  ring: { x: 540, y: 1660, r: 140 },
} as const;

export type SceneMode =
  | "standby"
  | "offline"
  | "selecting"
  | "placing" // ≈ the original "DETECTED"
  | "filling" // FILLING / ALMOST (decided here from progress)
  | "paused"
  | "complete" // FULLY CHARGED!
  | "reset" // THANKS FOR REFILLING!
  | "error";

export interface SceneInput {
  mode: SceneMode;
  /** performance.now() when `mode` last changed. */
  since: number;
  /** Pour timing for the trickle loader (filling / paused). */
  pour: PourClock | null;
  litres: number | null;
  pauseTimeoutMs: number;
  resetHoldMs: number;
}

/** DOM nodes the renderer updates every frame. */
export interface SceneLabels {
  ring: HTMLElement | null;
  pct: HTMLElement | null;
  vol: HTMLElement | null;
}

/** "Almost there" threshold on the displayed progress (original: 90% of target). */
export const ALMOST_AT = 0.85;

interface Palette {
  primary: string;
  accent: string;
  waterTop: string;
  waterBottom: string;
}

const TAU = Math.PI * 2;
const BS0 = 1.2;
const BS1 = 1.28;
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
/** Same formatting as the original station: 1.0, 0.5, 0.75. */
export const fmtL = (litres: number) => litres.toFixed(Math.round(litres * 1000) % 100 ? 2 : 1);

function rgb(hex: string, fallback: string) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name);
  return {
    primary: rgb(v("--stage-primary"), "0,174,239"),
    accent: rgb(v("--stage-accent"), "166,206,57"),
    waterTop: rgb(v("--stage-water-top"), "60,210,255"),
    waterBottom: rgb(v("--stage-water-bottom"), "0,110,200"),
  };
}

interface Particle { x: number; y: number; z: number }
interface Bubble { x: number; y: number; r: number; v: number; ph: number }
interface Spark { x: number; y: number; vx: number; vy: number; l: number; d: number; r: number; accent: boolean }
interface Drop { x: number; y: number; r: number; v: number; l: number }

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private input: SceneInput;
  private labels: SceneLabels = { ring: null, pct: null, vol: null };
  private palette: Palette;
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private burstFor = -1; // `since` of the complete phase that already burst
  private almost = false;
  private readonly reducedMotion: boolean;
  private readonly ambient: Particle[];
  private bubbles: Bubble[] = [];
  private sparks: Spark[] = [];
  private drops: Drop[] = [];
  /** Animated values (eased toward per-state targets each frame) — same as the original. */
  private v = { lv: 0.07, ring: 0, ringA: 0, glow: 0.35, bs: BS0, nz: 0, drop: 1, flow: 0, green: 0, speed: 1, en: 1, brk: 0, pa: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    input: SceneInput,
    private readonly onAlmostChange?: (almost: boolean) => void,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
    this.input = input;
    this.palette = readPalette();
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.ambient = Array.from({ length: this.reducedMotion ? 25 : 70 }, () => ({
      x: Math.random() * SCENE_W,
      y: Math.random() * SCENE_H,
      z: 0.3 + Math.random() * 0.7,
    }));
  }

  setInput(input: SceneInput) {
    this.input = input;
  }

  setLabels(labels: SceneLabels) {
    this.labels = labels;
  }

  start() {
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** Match the backing store to the element size × devicePixelRatio. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // ------------------------------------------------------------------ frame

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt * (this.reducedMotion ? 0.35 : 1);
    const { mode, since, pour } = this.input;
    const st = (now - since) / 1000;
    const pct = pour ? trickleProgress(pour) : 0;

    const almost = mode === "filling" && pct >= ALMOST_AT;
    if (almost !== this.almost) {
      this.almost = almost;
      this.onAlmostChange?.(almost);
    }

    this.updateTargets(mode, st, dt, pct, almost);
    this.updateLabels(mode, st);

    const ctx = this.ctx;
    const scale = this.canvas.width / SCENE_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);

    this.drawRibbons();
    this.drawAmbient(dt);
    this.drawGlow();
    this.drawRing(mode);
    if (mode === "reset") this.drawResetTick(st);
    if (mode === "error") this.drawErrorIcon();
    this.drawBottle(mode, st, dt, now);
  }

  /** Per-state targets and easing rates, as in the original `frame()`. */
  private updateTargets(mode: SceneMode, st: number, dt: number, pct: number, almost: boolean) {
    const v = this.v;
    const t = this.t;
    const filling = mode === "filling";
    let lv = 0.07, gl = 0.35 + 0.12 * Math.sin(t * 2), bs = BS0, nz = 0, drop = 1, fl = 0, gr = 0, sp = 1, en = 1;

    if (mode !== "standby" && mode !== "offline") { bs = BS1; drop = 0; nz = 1; gl = 0.5; }
    if (mode === "offline") { gl = 0.15; sp = 0.3; drop = 0.4; }
    if (mode === "selecting") { nz = 0.35; gl = 0.45 + 0.12 * Math.sin(t * 3); }
    if (mode === "placing") lv = 0;
    if (filling || mode === "paused") { lv = pct; gl = mode === "paused" ? 0.2 : 0.5 + 0.3 * pct; }
    if (filling) fl = 1;
    if (almost) { gl = 0.9; gr = 0.55; en = 1.7; }
    if (mode === "complete") { lv = 1; gl = 1; gr = 0.7; nz = 0.4; }
    if (mode === "reset") { lv = 0; gl = 0.3; nz = 0; }
    if (mode === "error") { lv = v.lv; gl = 0.3 + 0.15 * Math.sin(t * 4); sp = 0.3; bs = BS0; }
    if (mode === "paused") sp = 0.5;

    v.lv = lerp(v.lv, lv, dt * (filling ? 5 : mode === "reset" ? 1.2 : 2));
    v.glow = lerp(v.glow, gl, dt * 3);
    v.bs = lerp(v.bs, bs, dt * 5);
    v.nz = lerp(v.nz, nz, dt * 5);
    v.drop = lerp(v.drop, drop, dt * 4);
    v.flow = lerp(v.flow, fl, dt * (fl ? 6 : 16));
    v.green = lerp(v.green, gr, dt * 2);
    v.speed = lerp(v.speed, sp, dt * 2);
    v.en = lerp(v.en, en, dt * 3);
    v.brk = lerp(v.brk, mode === "placing" ? 1 : 0, dt * 6);
    v.pa = lerp(v.pa, mode === "paused" ? 1 : 0, dt * 6);
    v.ringA = lerp(v.ringA, filling || mode === "paused" || mode === "complete" ? 1 : 0, dt * 5);
    // The ring freezes while paused (the countdown arc is drawn separately) and in errors.
    if (mode !== "error" && mode !== "paused") v.ring = lerp(v.ring, mode === "complete" ? 1 : pct, dt * 5);
    if (mode === "standby" || mode === "placing") v.ring = 0;
    void st;
  }

  private pauseLeft(st: number) {
    return Math.max(0, this.input.pauseTimeoutMs / 1000 - st);
  }

  /** Ring label text + fade, written straight to the DOM like the original. */
  private updateLabels(mode: SceneMode, st: number) {
    const { ring, pct, vol } = this.labels;
    if (!ring || !pct || !vol) return;
    ring.style.opacity = String(this.v.ringA);
    if (this.v.ringA < 0.02) return;
    const litres = this.input.litres ?? 0;
    if (mode === "paused") {
      pct.textContent = String(Math.ceil(this.pauseLeft(st)));
      vol.textContent = "SECONDS LEFT";
    } else {
      pct.textContent = `${Math.round(Math.min(1, this.v.ring) * 100)}%`;
      vol.textContent = `${fmtL(litres)} L`;
    }
  }

  // ------------------------------------------------------------- background

  private drawRibbons() {
    const { ctx, palette: p, v } = this;
    for (let i = 0; i < 4; i++) {
      const sp = v.speed * (0.5 + i * 0.25);
      const y0 = 1726 + i * 36;
      ctx.beginPath();
      ctx.moveTo(0, SCENE_H);
      for (let x = 0; x <= SCENE_W; x += 24) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.004 + this.t * sp + i * 2) * 46 + Math.sin(x * 0.011 - this.t * sp * 1.3) * 16);
      }
      ctx.lineTo(SCENE_W, SCENE_H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y0 - 60, 0, SCENE_H);
      const col = i % 2 ? p.accent : p.primary;
      g.addColorStop(0, `rgba(${col},.32)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  private drawAmbient(dt: number) {
    const { ctx, palette: p, v } = this;
    for (const a of this.ambient) {
      a.y -= (8 + 22 * a.z) * dt * v.speed;
      a.x += Math.sin(this.t + a.z * 9) * 10 * dt;
      if (a.y < -10) {
        a.y = SCENE_H + 10;
        a.x = Math.random() * SCENE_W;
      }
      ctx.fillStyle = `rgba(${p.primary},${0.12 + 0.25 * a.z})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 1 + 2.5 * a.z, 0, TAU);
      ctx.fill();
    }
  }

  private drawGlow() {
    const { ctx, palette: p, v } = this;
    const { x, y } = GEOMETRY.bottle;
    const g = ctx.createRadialGradient(x, y, 40, x, y, 640);
    const a = v.glow * 0.55;
    g.addColorStop(0, `rgba(${p.primary},${a})`);
    g.addColorStop(0.5, `rgba(${p.primary},${a * 0.25})`);
    g.addColorStop(1, `rgba(${p.primary},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }

  // ------------------------------------------------------- status overlays

  private drawRing(mode: SceneMode) {
    const { ctx, palette: p, v } = this;
    if (v.ringA < 0.02) return;
    const { x, y, r } = GEOMETRY.ring;
    ctx.save();
    ctx.globalAlpha = v.ringA;
    ctx.lineCap = "round";
    ctx.lineWidth = 20;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();

    if (mode === "paused") {
      // Timeout counter: a white arc that empties over the pause timeout.
      const left = this.pauseLeft((performance.now() - this.input.since) / 1000);
      const frac = left / Math.max(0.001, this.input.pauseTimeoutMs / 1000);
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.shadowColor = "rgba(255,255,255,.8)";
      ctx.shadowBlur = 18;
      if (frac > 0.001) {
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
      }
    } else {
      const g = ctx.createLinearGradient(x - r, 0, x + r, 0);
      g.addColorStop(0, `rgb(${p.primary})`);
      g.addColorStop(1, `rgb(${p.accent})`);
      ctx.strokeStyle = g;
      ctx.shadowColor = `rgb(${p.primary})`;
      ctx.shadowBlur = 26;
      if (v.ring > 0.001) {
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, v.ring));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** RESET: a green circle + tick drawing itself at the ring position, then fading out. */
  private drawResetTick(st: number) {
    const { ctx, palette: p } = this;
    const { x, y } = GEOMETRY.ring;
    const k = ease(st / 0.7);
    const a = Math.min(1, Math.max(0, (this.input.resetHoldMs / 1000 - st) / 0.4));
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgb(${p.accent})`;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgb(${p.accent})`;
    ctx.shadowBlur = 24;
    ctx.setLineDash([700 * k, 800]);
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([140 * Math.max(0, k * 1.4 - 0.4), 400]);
    ctx.beginPath();
    ctx.moveTo(-42, 2);
    ctx.lineTo(-12, 34);
    ctx.lineTo(44, -30);
    ctx.stroke();
    ctx.restore();
  }

  private drawErrorIcon() {
    const { ctx, palette: p } = this;
    const { x, y } = GEOMETRY.ring;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.t * 5);
    ctx.strokeStyle = `rgb(${p.accent})`;
    ctx.fillStyle = `rgb(${p.accent})`;
    ctx.lineWidth = 12;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = `rgb(${p.accent})`;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(0, -100);
    ctx.lineTo(100, 70);
    ctx.lineTo(-100, 70);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.lineTo(0, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 42, 6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ bottle

  private bottlePath() {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(-45, -290);
    c.lineTo(-45, -240);
    c.bezierCurveTo(-45, -190, -130, -190, -130, -110);
    c.lineTo(-130, 250);
    c.quadraticCurveTo(-130, 300, -80, 300);
    c.lineTo(80, 300);
    c.quadraticCurveTo(130, 300, 130, 250);
    c.lineTo(130, -110);
    c.bezierCurveTo(130, -190, 45, -190, 45, -240);
    c.lineTo(45, -290);
    c.closePath();
  }

  private drawBottle(mode: SceneMode, st: number, dt: number, now: number) {
    const { ctx, palette: p, v } = this;
    const t = this.t;
    const { x, y } = GEOMETRY.bottle;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(v.bs, v.bs);

    const wy = 300 - v.lv * 500;
    const amp = (mode === "standby" ? 6 : 5 + 4 * v.en) * (mode === "error" || mode === "paused" ? 0.4 : 1);

    // Nozzle
    ctx.save();
    ctx.shadowColor = `rgb(${p.accent})`;
    ctx.shadowBlur = v.nz * 30;
    const ng = ctx.createLinearGradient(-42, 0, 42, 0);
    ng.addColorStop(0, "#2b4f78");
    ng.addColorStop(0.5, v.nz > 0.5 ? "#bff3ff" : "#6b88a8");
    ng.addColorStop(1, "#2b4f78");
    ctx.fillStyle = ng;
    ctx.globalAlpha = 0.6 + 0.4 * v.nz;
    ctx.beginPath();
    ctx.roundRect(-42, -415, 84, 64, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-20, -352);
    ctx.lineTo(20, -352);
    ctx.lineTo(11, -334);
    ctx.lineTo(-11, -334);
    ctx.fill();
    ctx.restore();

    // Body
    this.bottlePath();
    const bg = ctx.createLinearGradient(-130, 0, 130, 0);
    bg.addColorStop(0, "rgba(255,255,255,.14)");
    bg.addColorStop(0.5, "rgba(255,255,255,.03)");
    bg.addColorStop(1, "rgba(255,255,255,.12)");
    ctx.fillStyle = bg;
    ctx.fill();

    // Water (clipped)
    ctx.save();
    this.bottlePath();
    ctx.clip();
    const surface = (px: number) => wy + Math.sin(px * 0.03 + t * 2) * amp + Math.sin(px * 0.07 - t * 3) * amp * 0.6;
    ctx.beginPath();
    ctx.moveTo(-140, 320);
    for (let px = -140; px <= 140; px += 8) ctx.lineTo(px, surface(px));
    ctx.lineTo(140, 320);
    ctx.closePath();
    const wg = ctx.createLinearGradient(0, wy, 0, 300);
    wg.addColorStop(0, `rgba(${p.waterTop},.85)`);
    wg.addColorStop(1, `rgba(${p.waterBottom},.92)`);
    ctx.fillStyle = wg;
    ctx.fill();
    if (v.green > 0.01) {
      const g2 = ctx.createLinearGradient(0, wy, 0, wy + 160);
      g2.addColorStop(0, `rgba(${p.accent},${v.green * 0.55})`);
      g2.addColorStop(1, `rgba(${p.accent},0)`);
      ctx.fillStyle = g2;
      ctx.fill();
    }
    ctx.beginPath();
    for (let px = -140; px <= 140; px += 8) {
      if (px === -140) ctx.moveTo(px, surface(px));
      else ctx.lineTo(px, surface(px));
    }
    ctx.strokeStyle = "rgba(190,245,255,.95)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Bubbles
    if (v.flow > 0.5 && Math.random() < dt * 10 * v.en) {
      this.bubbles.push({ x: (Math.random() - 0.5) * 190, y: 290, r: 2 + Math.random() * 5, v: 50 + Math.random() * 70, ph: Math.random() * 6 });
    }
    this.bubbles = this.bubbles.filter((b) => {
      b.y -= b.v * dt * v.en;
      b.x += Math.sin(t * 3 + b.ph) * 0.4;
      if (b.y < wy + 4) return false;
      ctx.strokeStyle = "rgba(220,250,255,.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
      return true;
    });

    // Complete: bottom-up illumination
    if (mode === "complete") {
      const il = ease(st / 1.0);
      const y0 = 300 - il * 540;
      const ig = ctx.createLinearGradient(0, y0, 0, 300);
      ig.addColorStop(0, "rgba(200,250,255,0)");
      ig.addColorStop(1, "rgba(200,250,255,.5)");
      ctx.fillStyle = ig;
      ctx.fillRect(-140, y0, 280, 320 - y0);
    }

    // Standby droplet
    if (v.drop > 0.02) {
      const s = 1 + 0.06 * Math.sin(t * 2.2);
      ctx.save();
      ctx.translate(0, -10 + Math.sin(t * 1.5) * 8);
      ctx.scale(s, s);
      ctx.globalAlpha = v.drop;
      ctx.shadowColor = `rgb(${p.primary})`;
      ctx.shadowBlur = 40;
      const dg = ctx.createRadialGradient(-10, 10, 5, 0, 20, 60);
      dg.addColorStop(0, "#c8f6ff");
      dg.addColorStop(1, `rgb(${p.primary})`);
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.moveTo(0, -65);
      ctx.bezierCurveTo(14, -35, 40, -5, 40, 25);
      ctx.arc(0, 25, 40, 0, Math.PI, false);
      ctx.bezierCurveTo(-40, -5, -14, -35, 0, -65);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore(); // end clip

    // Reflections
    const rf = ctx.createLinearGradient(0, -120, 0, 260);
    rf.addColorStop(0, "rgba(255,255,255,.35)");
    rf.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rf;
    ctx.beginPath();
    ctx.roundRect(-108, -90, 16, 320, 8);
    ctx.fill();
    ctx.fillRect(96, -70, 6, 200);

    // Outline (draws itself in on detection)
    const dp = mode === "placing" ? ease(st / 0.7) : 1;
    ctx.save();
    this.bottlePath();
    ctx.setLineDash([2100 * dp, 2200]);
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    const err = mode === "error";
    ctx.strokeStyle = err ? `rgb(${p.accent})` : `rgba(150,235,255,${0.6 + 0.4 * v.glow})`;
    ctx.shadowColor = err ? `rgb(${p.accent})` : `rgb(${p.primary})`;
    ctx.shadowBlur = 14 + 28 * v.glow;
    ctx.stroke();
    ctx.restore();

    // Stream
    if (v.flow > 0.02) {
      const a = v.flow;
      const w = 9 * (1 + 0.25 * (v.en - 1));
      ctx.beginPath();
      ctx.moveTo(-w, -334);
      for (let py = -334; py <= wy; py += 10) ctx.lineTo(-w + Math.sin(py * 0.05 - t * 18) * 2, py);
      for (let py = wy; py >= -334; py -= 10) ctx.lineTo(w + Math.sin(py * 0.05 - t * 18) * 2, py);
      ctx.closePath();
      ctx.fillStyle = `rgba(110,230,255,${0.92 * a})`;
      ctx.shadowColor = `rgb(${p.primary})`;
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -334);
      ctx.lineTo(-w * 0.3, wy);
      ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const ph = (t * 1.3 + k / 3) % 1;
        ctx.strokeStyle = `rgba(200,250,255,${(1 - ph) * 0.6 * a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, wy, 18 + ph * (80 + 20 * v.en), 4 + ph * 10, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // Pause symbol
    if (v.pa > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${0.9 * v.pa})`;
      ctx.beginPath();
      ctx.roundRect(-38, -50, 28, 110, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(10, -50, 28, 110, 8);
      ctx.fill();
    }

    // Detection: brackets fly in + a landing ripple (repeats while waiting for the bottle)
    if (v.brk > 0.02) {
      const d = (1 - ease(st / 0.7)) * 90;
      const L = 60, bx = 150 + d, y0 = -330 - d, y1 = 330 + d;
      ctx.save();
      ctx.strokeStyle = `rgba(${p.accent},${v.brk})`;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.shadowColor = `rgb(${p.accent})`;
      ctx.shadowBlur = 18;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const px = sx * bx, py = sy < 0 ? y0 : y1;
        // Both arms point inward, toward the bottle.
        ctx.beginPath();
        ctx.moveTo(px, py - sy * L);
        ctx.lineTo(px, py);
        ctx.lineTo(px - sx * L, py);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (mode === "placing") {
      const ph = ease((st % 1.8) / 0.9);
      ctx.strokeStyle = `rgba(${p.accent},${(1 - ph) * 0.9})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(0, 310, 40 + ph * 280, 8 + ph * 40, 0, 0, TAU);
      ctx.stroke();
    }

    if (mode === "complete") this.drawCompletion(st, dt);
    this.drawSparks(dt);
    if (mode === "reset") this.drawResetDrops(st, dt);

    ctx.restore();
    void now;
  }

  /** FULLY CHARGED: burst + shockwaves at 0.9 s, glowing base ring from 0.5 s. */
  private drawCompletion(st: number, dt: number) {
    const { ctx, palette: p } = this;
    if (this.burstFor !== this.input.since && st > 0.9) {
      this.burstFor = this.input.since;
      const n = this.reducedMotion ? 30 : 150;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 250 + Math.random() * 750;
        this.sparks.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 1, d: 0.45 + Math.random() * 0.6, r: 2 + Math.random() * 5, accent: Math.random() < 0.5 });
      }
    }
    const w = st - 0.9;
    if (w > 0 && w < 1.6) {
      const k = w / 1.6;
      ctx.lineWidth = 14 * (1 - k) + 2;
      ctx.strokeStyle = `rgba(120,235,255,${1 - k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 60 + k * 1300, 0, TAU);
      ctx.stroke();
      if (w > 0.2) {
        const q = (w - 0.2) / 1.4;
        ctx.strokeStyle = `rgba(${p.accent},${1 - q})`;
        ctx.beginPath();
        ctx.arc(0, 0, 60 + q * 1100, 0, TAU);
        ctx.stroke();
      }
    }
    if (st > 0.5) {
      const k = Math.min(1, (st - 0.5) / 1.2);
      ctx.lineWidth = 8;
      ctx.strokeStyle = `rgba(${p.accent},${0.5 + 0.5 * Math.sin(this.t * 6) * 0.3})`;
      ctx.shadowColor = `rgb(${p.accent})`;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.ellipse(0, 312, 60 + k * 240, 10 + k * 34, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    void dt;
  }

  private drawSparks(dt: number) {
    const { ctx, palette: p } = this;
    this.sparks = this.sparks.filter((s) => {
      s.l -= dt / s.d;
      if (s.l <= 0) return false;
      s.vx *= 1 - 1.8 * dt;
      s.vy *= 1 - 1.8 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.fillStyle = `rgba(${s.accent ? p.accent : "120,235,255"},${s.l})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * s.l + 0.5, 0, TAU);
      ctx.fill();
      return true;
    });
  }

  /** THANKS: droplets rise out of the draining bottle. */
  private drawResetDrops(st: number, dt: number) {
    const { ctx } = this;
    if (st < 1.6 && Math.random() < dt * 22) {
      this.drops.push({ x: (Math.random() - 0.5) * 220, y: 200 + Math.random() * 100, r: 3 + Math.random() * 5, v: 60 + Math.random() * 90, l: 1 });
    }
    this.drops = this.drops.filter((d) => {
      d.l -= dt * 0.55;
      d.y -= d.v * dt;
      if (d.l <= 0) return false;
      ctx.fillStyle = `rgba(140,235,255,${d.l * 0.8})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
      return true;
    });
  }
}
