import Image from "next/image";
import { brand } from "@/config/brand";

/**
 * The brand as on the station header: the logo image if one is configured,
 * otherwise the wordmark ("ethio" + accent-colored "telecom"). Size it with a
 * font-size class; everything is in em.
 */
export function BrandMark({
  className = "text-2xl",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  if (brand.logo) {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <Image
          src={brand.logo.src}
          alt={brand.logo.alt}
          width={brand.logo.width}
          height={brand.logo.height}
          priority={priority}
          unoptimized
          style={{ height: "2.4em", width: "auto" }}
        />
      </span>
    );
  }
  return (
    <span className={`whitespace-nowrap font-extrabold tracking-[0.16em] ${className}`}>
      <span className="sr-only">{brand.name}</span>
      <span aria-hidden="true">
        {brand.wordmark.text} <span className="text-accent">{brand.wordmark.accent}</span>
      </span>
    </span>
  );
}

/** The co-brand (event / sponsor) shown opposite the brand, if any. */
export function PartnerMark({ className = "text-2xl" }: { className?: string }) {
  const partner = brand.partner;
  if (!partner) return null;
  return partner.logo ? (
    <span className={`inline-flex items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- brand asset of unknown size */}
      <img src={partner.logo} alt={partner.name} style={{ height: "2.4em", width: "auto" }} />
    </span>
  ) : (
    <span className={`whitespace-nowrap font-extrabold uppercase tracking-[0.16em] ${className}`}>{partner.name}</span>
  );
}
