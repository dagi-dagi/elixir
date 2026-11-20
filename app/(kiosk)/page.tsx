import { KioskGate } from "@/components/kiosk/kiosk-provider";
import { KioskScene } from "@/components/kiosk/scene/kiosk-scene";

/** The entire kiosk UI — one page whose content follows the dispenser's state. */
export default function KioskPage() {
  return (
    <KioskGate>
      <KioskScene />
    </KioskGate>
  );
}
