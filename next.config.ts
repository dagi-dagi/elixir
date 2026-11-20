import type { NextConfig } from "next";

/**
 * Hosts allowed to load dev-server resources (scripts, HMR). Phones open the
 * QR link via the PC's LAN address, which `next dev` blocks by default — the
 * page then never hydrates. Allows the host of NEXT_PUBLIC_APP_URL plus any
 * extra hostnames in DEV_ALLOWED_ORIGINS (comma-separated). Dev only.
 */
function devOrigins() {
  const origins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) origins.push(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname);
  } catch {
    // invalid URL — ignore
  }
  return [...new Set(origins)];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
