/**
 * Registry of physical dispensers. Each kiosk computer selects one of these
 * on the setup screen and remembers it in local storage.
 */

export interface DispenserDefinition {
  /** Stable identifier. Used in MQTT topics and QR URLs — keep it URL-safe. */
  id: string;
  /** Human-readable name shown on screen. */
  name: string;
  /** Selectable amounts in litres. Falls back to `DEFAULT_LITRE_OPTIONS`. */
  litreOptions?: readonly number[];
  /** Approximate flow rate, used to estimate progress when the device doesn't report it. */
  flowRateLitresPerSecond?: number;
}

export const DEFAULT_LITRE_OPTIONS = [1, 0.5] as const;
export const DEFAULT_FLOW_RATE_LITRES_PER_SECOND = 0.5;

export const dispensers: readonly DispenserDefinition[] = [
  { id: "1", name: "Dispenser 1" },
  { id: "2", name: "Dispenser 2" },
  { id: "3", name: "Dispenser 3" },
  { id: "4", name: "Dispenser 4" },
];

export function findDispenser(id: string | null | undefined) {
  if (!id) return undefined;
  return dispensers.find((d) => d.id === id);
}

export function litreOptionsFor(dispenser: DispenserDefinition) {
  return dispenser.litreOptions ?? DEFAULT_LITRE_OPTIONS;
}

export function flowRateFor(dispenser: DispenserDefinition) {
  return (
    dispenser.flowRateLitresPerSecond ?? DEFAULT_FLOW_RATE_LITRES_PER_SECOND
  );
}
