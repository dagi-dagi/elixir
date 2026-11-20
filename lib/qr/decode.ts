/**
 * Decode a QR code from a canvas. Uses the browser's native BarcodeDetector
 * when available (Chrome/Android) and falls back to jsQR (lazy-loaded, e.g.
 * for iOS Safari).
 */

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorCtor {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

let nativePromise: Promise<NativeDetector | null> | null = null;

async function createNative(): Promise<NativeDetector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = await Ctor.getSupportedFormats?.();
    if (formats && !formats.includes("qr_code")) return null;
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export async function decodeQrFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  nativePromise ??= createNative();
  const native = await nativePromise;
  if (native) {
    try {
      const [hit] = await native.detect(canvas);
      return hit?.rawValue ?? null;
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import("jsqr");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Draw a video frame or image into `canvas`, downscaled so decoding stays fast. */
export function drawForDecode(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide = 900,
) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d", { willReadFrequently: true })?.drawImage(source, 0, 0, canvas.width, canvas.height);
}
