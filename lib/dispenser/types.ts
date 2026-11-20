/**
 * Transport-agnostic contract between the UI and the dispenser hardware.
 *
 * The UI only ever depends on `DispenserGateway`. MQTT is one implementation
 * (`./mqtt`), the in-browser simulator is another (`./mock`). Add more
 * (HTTP + SSE, WebSocket, serial bridge…) by implementing this interface and
 * registering a loader in `./registry.ts`.
 */

export type Unsubscribe = () => void;

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

/** Emitted by the customer's phone after scanning the QR code. */
export interface SessionRequest {
  dispenserId: string;
  sessionId: string;
  /** One-time token from the QR code — proves the customer just scanned the kiosk. */
  token: string;
}

/** Controller's answer to a scan. */
export type SessionEvent =
  | { type: "started"; dispenserId: string; sessionId: string; timestamp: string }
  | { type: "rejected"; dispenserId: string; sessionId: string; timestamp: string; reason: string };

/** Sent from the customer's phone when they choose an amount. */
export interface DispenseCommand {
  dispenserId: string;
  sessionId: string;
  litres: number;
}

interface DispenseEventBase {
  dispenserId: string;
  sessionId: string;
  timestamp: string;
}

export type DispenseEvent =
  | (DispenseEventBase & {
      type: "progress";
      /** Litres poured so far, if the device reports it. */
      dispensedLitres?: number;
    })
  /** Cup removed mid-pour: valve closed, waiting for the cup to come back. */
  | (DispenseEventBase & { type: "paused"; dispensedLitres?: number; reason?: string })
  | (DispenseEventBase & { type: "completed"; dispensedLitres?: number })
  | (DispenseEventBase & { type: "failed"; reason: string });

export interface DispenserGateway {
  /** Implementation name, for diagnostics. */
  readonly name: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  onConnectionStateChange(listener: (state: ConnectionState) => void): Unsubscribe;

  /** Customer side: announce that the QR code for a dispenser was scanned. */
  requestSession(request: SessionRequest): Promise<void>;
  /** Both sides: the controller's answer to a scan (started, or rejected e.g. for a used QR code). */
  onSession(dispenserId: string, listener: (event: SessionEvent) => void): Unsubscribe;

  /**
   * Kiosk side: announce the one-time token currently shown in the QR code
   * (retained, so the controller always knows the latest one).
   */
  announceQrToken(dispenserId: string, token: string): Promise<void>;
  /** Controller side: follow the token each kiosk is showing. */
  onQrToken(dispenserId: string, listener: (token: string) => void): Unsubscribe;

  /**
   * Customer side: send the chosen amount. The dispenser holds it until a cup
   * is detected under the nozzle, then starts pouring (first "progress" event).
   */
  requestDispense(command: DispenseCommand): Promise<void>;
  /** Kiosk side: observe amounts requested for this dispenser (to prompt for the cup and show the pour). */
  onDispenseRequested(dispenserId: string, listener: (command: DispenseCommand) => void): Unsubscribe;
  /** Both sides: progress / completion / failure from the dispenser. */
  onDispenseEvent(dispenserId: string, listener: (event: DispenseEvent) => void): Unsubscribe;
}
