"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { CameraIcon } from "@/components/ui/icons";
import { decodeQrFromCanvas, drawForDecode } from "@/lib/qr/decode";

type CameraState = "starting" | "scanning" | "unavailable" | "denied" | "error";

const SCAN_INTERVAL_MS = 250;

const CORNERS = [
  "left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl",
  "right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl",
  "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl",
  "bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl",
];

const CAMERA_MESSAGES: Partial<Record<CameraState, string>> = {
  starting: "Starting camera…",
  scanning: "Point your camera at the code on the dispenser screen.",
  unavailable: "Live scanning needs a secure (HTTPS) connection. Take a photo of the QR code instead.",
  denied: "Camera access was blocked. Allow it in your browser settings, or take a photo of the QR code.",
  error: "We couldn't start the camera. Take a photo of the QR code instead.",
};

/**
 * Full-screen in-app QR scanner.
 *
 * Live camera needs a secure context (HTTPS or localhost). When it isn't
 * available — or permission is denied — the customer can take a photo of the
 * code instead, which works over plain HTTP too.
 *
 * `onResult` returns true if the code was accepted; otherwise scanning
 * continues and a hint is shown.
 */
export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (value: string) => boolean;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onResultRef = useRef(onResult);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Focus the dialog; Escape closes it.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live camera + decode loop.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        drawForDecode(canvas, video, video.videoWidth, video.videoHeight);
        const value = await decodeQrFromCanvas(canvas);
        if (stopped) return;
        if (value) {
          if (onResultRef.current(value)) return; // accepted — the page navigates away
          setHint("That isn't a dispenser QR code. Point at the code on the dispenser screen.");
        }
      }
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCamera("unavailable");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play();
        setCamera("scanning");
        void tick();
      } catch (error) {
        console.warn("[scanner] camera unavailable", error);
        const name = error instanceof DOMException ? error.name : "";
        setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    };
    void start();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setHint(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      drawForDecode(canvas, bitmap, bitmap.width, bitmap.height, 1400);
      bitmap.close();
      const value = await decodeQrFromCanvas(canvas);
      if (!value) setHint("We couldn't find a QR code in that photo. Try again, a little closer.");
      else if (!onResultRef.current(value)) setHint("That isn't a dispenser QR code.");
    } catch (error) {
      console.error("[scanner] photo decode failed", error);
      setHint("We couldn't read that photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const live = camera === "scanning";

  // Portal to <body>: an animated (transformed) ancestor would otherwise trap position:fixed.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-title"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white animate-fade-up"
    >
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-hidden="true"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${live ? "opacity-100" : "opacity-0"}`}
        />
        <div className="absolute inset-0 grid place-items-center p-10">
          <div className="relative aspect-square w-full max-w-[18rem]">
            {CORNERS.map((c) => (
              <span key={c} aria-hidden="true" className={`absolute size-12 border-white ${c}`} />
            ))}
            {live && (
              <span
                aria-hidden="true"
                className="absolute inset-x-4 h-0.5 rounded-full bg-sky-300 shadow-[0_0_12px_2px] shadow-sky-400 animate-scanline"
              />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-t-3xl bg-neutral-950 px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div>
          <h2 id="scanner-title" className="text-xl font-bold">
            Scan the dispenser&apos;s QR code
          </h2>
          <p className="mt-1 text-sm text-white/70" aria-live="polite">
            {hint ?? CAMERA_MESSAGES[camera]}
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handlePhoto}
        />
        <Button
          size="lg"
          className="w-full"
          variant={live ? "secondary" : "primary"}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <CameraIcon className="size-5" />
          {busy ? "Reading photo…" : "Take a photo instead"}
        </Button>
        <Button
          ref={closeRef}
          size="lg"
          variant="ghost"
          className="w-full text-white/80 hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </div>,
    document.body,
  );
}
