import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} — ${brand.tagline}`,
    short_name: brand.shortName,
    description: brand.description,
    start_url: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: brand.colors.backgroundColor,
    theme_color: brand.colors.themeColor,
    categories: ["utilities", "lifestyle"],
    icons: [{ src: brand.icon, sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
