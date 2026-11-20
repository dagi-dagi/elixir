/**
 * Controller-side rule for one-time QR codes: a scan is accepted only if it
 * carries the token the kiosk is currently showing, and that token is then
 * consumed — so reloading the page, going back, or reusing a copied link
 * can't start another session.
 *
 * Plain TypeScript with no imports so the Node firmware can use it directly.
 */
export class QrTokenGate {
  private readonly current = new Map<string, string>();

  /** Kiosk announced a new token (retained message). */
  set(dispenserId: string, token: string) {
    this.current.set(dispenserId, token);
  }

  peek(dispenserId: string) {
    return this.current.get(dispenserId) ?? null;
  }

  /** Returns null when accepted (token consumed), otherwise a customer-facing reason. */
  consume(dispenserId: string, token: string): string | null {
    const expected = this.current.get(dispenserId);
    if (!token || !expected || token !== expected) {
      return "This QR code has already been used or has expired. Scan the code on the dispenser screen again.";
    }
    this.current.delete(dispenserId);
    return null;
  }
}

export const BUSY_REASON = "This dispenser is serving someone else right now. Please wait and scan again.";
