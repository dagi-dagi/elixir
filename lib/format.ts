const litresFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function formatLitres(litres: number) {
  return litresFormat.format(litres);
}

/** Friendly hint shown under each amount on the selector. */
export function describeAmount(litres: number) {
  if (litres <= 0.5) return "A glass";
  if (litres <= 1) return "A bottle";
  if (litres <= 2) return "Large bottle";
  if (litres <= 5) return "A jug";
  if (litres <= 10) return "Small container";
  return "Large container";
}
