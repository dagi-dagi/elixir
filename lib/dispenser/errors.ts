export type GatewayErrorCode =
  | "CONNECTION_FAILED"
  | "NOT_CONNECTED"
  | "PUBLISH_FAILED"
  | "TIMEOUT"
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_TRANSPORT";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GatewayError";
    this.code = code;
  }
}

const friendlyMessages: Record<GatewayErrorCode, string> = {
  CONNECTION_FAILED: "We couldn't reach the dispenser network.",
  NOT_CONNECTED: "The dispenser is offline right now.",
  PUBLISH_FAILED: "We couldn't send your request to the dispenser.",
  TIMEOUT: "The dispenser didn't respond in time.",
  INVALID_PAYLOAD: "The dispenser sent an unexpected response.",
  UNSUPPORTED_TRANSPORT: "This dispenser connection type isn't supported.",
};

/** A short, customer-safe explanation for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof GatewayError) return friendlyMessages[error.code];
  return "Something went wrong. Please try again.";
}

/** Rejects with a TIMEOUT GatewayError if `promise` doesn't settle in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new GatewayError("TIMEOUT", `${what} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
