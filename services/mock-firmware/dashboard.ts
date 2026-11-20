/**
 * Operator dashboard for the mock firmware: a single HTML page plus a
 * Server-Sent Events stream of state, and a few POST endpoints to poke the
 * simulated hardware (place/remove cup, fault, reset, auto-cup).
 *
 * Bound to localhost by default (FIRMWARE_UI_HOST to change) — it has no auth.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Firmware } from "./firmware.ts";

export interface BrokerStatus {
  state: "connecting" | "connected" | "reconnecting" | "offline" | "error";
  url: string;
  clientId: string;
  lastError: string | null;
}

const ACTIONS = {
  "place-cup": (fw: Firmware, id: string) => fw.placeCup(id),
  "remove-cup": (fw: Firmware, id: string) => fw.removeCup(id),
  fault: (fw: Firmware, id: string) => fw.triggerFault(id),
  reset: (fw: Firmware, id: string) => fw.reset(id),
} as const;

function readJson(req: IncomingMessage, limit = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function startDashboard(
  fw: Firmware,
  brokerStatus: () => BrokerStatus,
  options: { host: string; port: number },
) {
  const html = await readFile(new URL("./dashboard.html", import.meta.url), "utf8");
  const clients = new Set<ServerResponse>();

  const state = () => ({
    broker: brokerStatus(),
    autoCup: fw.autoCup,
    cupDelayMs: fw.config.cupDelayMs,
    failureRate: fw.config.failureRate,
    units: fw.snapshot(),
    serverTime: Date.now(),
  });

  const push = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  };

  // Coalesce bursts of changes (pour ticks) into ≤10 updates/s.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const refresh = () => {
    pending ??= setTimeout(() => {
      pending = null;
      push("state", state());
    }, 100);
  };
  fw.on("change", refresh);
  fw.on("log", (entry) => push("log", entry));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        res.write(`event: logs\ndata: ${JSON.stringify(fw.recentLogs())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      if (req.method === "POST") {
        // Same-origin only (blocks drive-by requests from other sites).
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "Forbidden" });

        if (url.pathname === "/api/auto-cup") {
          const body = (await readJson(req)) as { enabled?: unknown };
          if (typeof body.enabled !== "boolean") return send(res, 400, { error: "enabled must be boolean" });
          fw.setAutoCup(body.enabled);
          return send(res, 200, { ok: true });
        }

        const match = /^\/api\/dispensers\/([^/]+)\/([a-z-]+)$/.exec(url.pathname);
        if (match) {
          const [, rawId, action] = match;
          const id = decodeURIComponent(rawId);
          if (!fw.hasUnit(id)) return send(res, 404, { error: `Unknown dispenser "${id}"` });
          if (!(action in ACTIONS)) return send(res, 404, { error: `Unknown action "${action}"` });
          ACTIONS[action as keyof typeof ACTIONS](fw, id);
          return send(res, 200, { ok: true });
        }
      }

      send(res, 404, { error: "Not found" });
    } catch (error) {
      console.error("[dashboard]", error);
      send(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  return {
    url: `http://${options.host}:${options.port}`,
    refresh,
    close: () => {
      for (const res of clients) res.end();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
