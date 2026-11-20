import { KioskShell } from "@/components/kiosk/kiosk-shell";

export default function KioskLayout({ children }: LayoutProps<"/">) {
  return <KioskShell>{children}</KioskShell>;
}
