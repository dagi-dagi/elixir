"use client";

import { useEffect } from "react";
import { brand } from "@/config/brand";

/**
 * Last-resort boundary for errors in the root layout. Renders its own
 * document and can't rely on global CSS, so it uses inline styles.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const timer = setTimeout(() => window.location.reload(), 30_000);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: brand.colors.backgroundColor,
          color: "#0b2536",
          textAlign: "center",
          padding: 24,
        }}
      >
        <title>{`Something went wrong · ${brand.name}`}</title>
        <div>
          <p style={{ fontWeight: 700, fontSize: 24, margin: 0 }}>{brand.name}</p>
          <h1 style={{ fontSize: 32, margin: "24px 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.75 }}>This screen will reload automatically.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: brand.colors.themeColor,
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "14px 28px",
              fontSize: 18,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
