import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share image generated from the brand data. */
export default async function OpenGraphImage() {
  const logoSrc = brand.logo ? await dataUrl(brand.logo.src) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          color: "#ffffff",
          background: `linear-gradient(135deg, ${brand.colors.themeColor} 0%, #0c4a6e 60%, #082f49 100%)`,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 44, fontWeight: 800, letterSpacing: "0.16em" }}>
          {brand.logo && logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- ImageResponse needs a plain img
            <img src={logoSrc} height={88} alt="" />
          ) : (
            <span style={{ display: "flex" }}>
              {brand.wordmark.text}&nbsp;<span style={{ color: "#a6ce39" }}>{brand.wordmark.accent}</span>
            </span>
          )}
          {brand.partner && <span style={{ fontSize: 30, textTransform: "uppercase" }}>{brand.partner.name}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{brand.promo.headline}</span>
          <span style={{ fontSize: 32, opacity: 0.85 }}>{brand.tagline}</span>
        </div>
      </div>
    ),
    size,
  );
}

async function dataUrl(publicPath: string) {
  const file = await readFile(join(process.cwd(), "public", publicPath));
  const ext = extname(publicPath).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return `data:${mime};base64,${file.toString("base64")}`;
}
