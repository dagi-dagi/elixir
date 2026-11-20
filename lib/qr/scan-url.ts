import { brand } from "@/config/brand";
import { findDispenser } from "@/config/dispensers";
import { runtimeConfig } from "@/config/runtime";

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Validate a scanned QR value: it must be one of *our* dispenser links
 * (`<app>/scan/<id>?t=<token>`). Returns the same-origin path to open, or
 * null for anything else — we never navigate to arbitrary scanned URLs.
 */
export function dispenserPathFromQr(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const allowed = new Set([window.location.origin, originOf(runtimeConfig.publicUrl), originOf(brand.url)]);
  if (!allowed.has(url.origin)) return null;

  const match = /^\/scan\/([^/]+)\/?$/.exec(url.pathname);
  const token = url.searchParams.get("t");
  if (!match || !token || !findDispenser(decodeURIComponent(match[1]))) return null;

  return `${url.pathname}?t=${encodeURIComponent(token)}`;
}
