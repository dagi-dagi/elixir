/**
 * Wire format shared by message-based transports (MQTT and the mock broker).
 *
 * Topics come from templates containing `{dispenserId}`. Payloads are JSON:
 *
 *   qr-token { dispenserId, token, timestamp }                       (retained, kiosk → controller)
 *   scan     { dispenserId, sessionId, token, timestamp }
 *   session  { dispenserId, sessionId, status: "started" | "rejected", reason?, timestamp }
 *   dispense { dispenserId, sessionId, litres, timestamp }
 *   status   { dispenserId, sessionId, status: "dispensing" | "paused" | "completed" | "failed",
 *              dispensedLitres?, reason?, timestamp? }
 *
 * Incoming payloads are validated; anything malformed is dropped (and logged)
 * instead of crashing the UI.
 */

import type { TopicTemplates } from "@/config/runtime";
import type { DispenseCommand, DispenseEvent, SessionEvent, SessionRequest } from "./types";

export function topicFor(template: string, dispenserId: string) {
  return template.replaceAll("{dispenserId}", encodeURIComponent(dispenserId));
}

export function topicsFor(templates: TopicTemplates, dispenserId: string) {
  return {
    scan: topicFor(templates.scan, dispenserId),
    session: topicFor(templates.session, dispenserId),
    qrToken: topicFor(templates.qrToken, dispenserId),
    dispense: topicFor(templates.dispense, dispenserId),
    status: topicFor(templates.status, dispenserId),
  };
}

const now = () => new Date().toISOString();

export const encode = {
  scan: (r: SessionRequest) =>
    JSON.stringify({ dispenserId: r.dispenserId, sessionId: r.sessionId, token: r.token, timestamp: now() }),
  session: (e: SessionEvent) => {
    const { type, ...rest } = e;
    return JSON.stringify({ ...rest, status: type });
  },
  qrToken: (dispenserId: string, token: string) => JSON.stringify({ dispenserId, token, timestamp: now() }),
  dispense: (c: DispenseCommand) =>
    JSON.stringify({ dispenserId: c.dispenserId, sessionId: c.sessionId, litres: c.litres, timestamp: now() }),
  status: (e: DispenseEvent) => {
    const { type, ...rest } = e;
    return JSON.stringify({ ...rest, status: type === "progress" ? "dispensing" : type });
  },
};

type Json = Record<string, unknown>;

function parseObject(raw: string): Json | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The dispenser id in the topic is authoritative; a payload that names a
 * different dispenser is rejected.
 */
function matchesDispenser(payload: Json, dispenserId: string) {
  const claimed = payload.dispenserId;
  return claimed === undefined || String(claimed) === dispenserId;
}

export const decode = {
  /** A missing `status` means "started" (older controllers). */
  session(raw: string, dispenserId: string): SessionEvent | null {
    const p = parseObject(raw);
    if (!p || !matchesDispenser(p, dispenserId)) return null;
    const sessionId = str(p.sessionId);
    if (!sessionId) return null;
    const timestamp = str(p.timestamp) ?? now();
    if (p.status === "rejected") {
      return { type: "rejected", dispenserId, sessionId, timestamp, reason: str(p.reason) ?? "Session rejected" };
    }
    return { type: "started", dispenserId, sessionId, timestamp };
  },

  qrToken(raw: string, dispenserId: string): string | null {
    const p = parseObject(raw);
    if (!p || !matchesDispenser(p, dispenserId)) return null;
    return str(p.token) ?? null;
  },

  /** `token` is "" when missing — the controller must reject such scans. */
  scan(raw: string, dispenserId: string): SessionRequest | null {
    const p = parseObject(raw);
    if (!p || !matchesDispenser(p, dispenserId)) return null;
    const sessionId = str(p.sessionId);
    return sessionId ? { dispenserId, sessionId, token: str(p.token) ?? "" } : null;
  },

  dispense(raw: string, dispenserId: string): DispenseCommand | null {
    const p = parseObject(raw);
    if (!p || !matchesDispenser(p, dispenserId)) return null;
    const sessionId = str(p.sessionId);
    const litres = num(p.litres);
    return sessionId && litres && litres > 0 ? { dispenserId, sessionId, litres } : null;
  },

  status(raw: string, dispenserId: string): DispenseEvent | null {
    const p = parseObject(raw);
    if (!p || !matchesDispenser(p, dispenserId)) return null;
    const sessionId = str(p.sessionId);
    if (!sessionId) return null;
    const base = { dispenserId, sessionId, timestamp: str(p.timestamp) ?? now() };
    const dispensedLitres = num(p.dispensedLitres);

    switch (p.status) {
      case "dispensing":
      case "progress":
      case "started":
        return { ...base, type: "progress", dispensedLitres };
      case "paused":
        return { ...base, type: "paused", dispensedLitres, reason: str(p.reason) };
      case "completed":
      case "finished":
      case "done":
        return { ...base, type: "completed", dispensedLitres };
      case "failed":
      case "error":
        return { ...base, type: "failed", reason: str(p.reason) ?? "Dispenser reported an error" };
      default:
        return null;
    }
  },
};
