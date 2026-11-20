/**
 * Single source of truth for all brand / advertising data.
 *
 * Everything user-facing — page metadata, the web manifest, the Open Graph
 * image, the kiosk scene and the phone copy — reads from this object. To
 * rebrand the application, edit this file (and drop new assets in
 * `public/brand/`).
 */

import type { ThemeName } from "./themes";

/** Two lines shown at the top of the kiosk scene: a big uppercase title and a subtitle. */
type SceneMessage = readonly [title: string, subtitle: string];

export interface Brand {
  /** Full brand name, used in titles and headings. */
  name: string;
  /** Short name for constrained spaces (home-screen icon label, etc.). */
  shortName: string;
  tagline: string;
  /** Used for <meta name="description">, Open Graph and the manifest. */
  description: string;
  /** Canonical public URL of the deployment. Used for metadataBase and QR links. */
  url: string;
  locale: string;
  keywords: readonly string[];
  /**
   * Text logo, e.g. "ethio" + "telecom" (the accent part is drawn in the accent color).
   * Used wherever the brand appears unless `logo` is set.
   */
  wordmark: { text: string; accent: string };
  /** Optional logo image (e.g. "/brand/logo.svg") shown instead of the wordmark. */
  logo: { src: string; alt: string; width: number; height: number } | null;
  /** Square icon (SVG) used for favicons and the manifest. */
  icon: string;
  /**
   * Optional co-brand shown top-right on the kiosk (e.g. an event or sponsor).
   * With a `logo` the image is shown, otherwise the name as text.
   */
  partner: { name: string; logo?: string } | null;
  /** Visual theme applied to the whole app — see `config/themes.ts`. */
  theme: ThemeName;
  /** Browser UI / manifest colors. Keep in sync with the selected theme. */
  colors: { themeColor: string; backgroundColor: string };
  social: { twitterHandle?: string };
  /** Advertising content (phone "done" screen, Open Graph image). */
  promo: {
    eyebrow: string;
    headline: string;
    body: string;
    highlights: readonly { title: string; description: string }[];
  };
  /** Kiosk scene copy, one message per state. */
  kiosk: {
    footer: string;
    scanCaption: string;
    scanHint: string;
    messages: {
      idle: SceneMessage;
      offline: SceneMessage;
      selecting: SceneMessage;
      placing: SceneMessage;
      dispensing: SceneMessage;
      /** Shown near the end of the fill (green). */
      almost: SceneMessage;
      paused: SceneMessage;
      /** First beat after the finish signal. */
      completed: SceneMessage;
      /** Second beat, while the bottle drains, before returning to the QR (green). */
      thanks: SceneMessage;
      /** The subtitle is replaced by the actual reason. */
      failed: SceneMessage;
    };
  };
  /** Phone (customer) copy. */
  copy: {
    selectTitle: string;
    selectSubtitle: string;
    placeCupTitle: string;
    placeCupSubtitle: string;
    /** Shown when there is no (or a used) QR token — e.g. after a reload. */
    scanAgainTitle: string;
    scanAgainMessage: string;
    scanAgainLabel: string;
    refillAgainMessage: string;
    phoneConnectingTitle: string;
    phoneDispensingTitle: string;
    phoneDispensingMessage: string;
    phonePausedTitle: string;
    phonePausedMessage: string;
    phoneDoneTitle: string;
    phoneDoneMessage: string;
  };
}

export const brand = {
  name: "ethio telecom",
  shortName: "ethio telecom",
  tagline: "Hydration Station",
  description:
    "ethio telecom hydration stations deliver filtered drinking water. Scan, choose your amount and refill in seconds — no plastic bottles required.",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  locale: "en_US",
  keywords: ["ethio telecom", "hydration station", "water dispenser", "refill", "plastic free"],
  wordmark: { text: "ethio", accent: "telecom" },
  // e.g. { src: "/brand/ethio-telecom.svg", alt: "ethio telecom", width: 240, height: 64 }
  logo: null as Brand["logo"],
  icon: "/brand/icon.svg",
  // Shown top-right on the kiosk and the phone. Add `logo: "/brand/partner.svg"` to use an image.
  partner: { name: "Great Run Ethiopia" } as Brand["partner"],
  theme: "station",
  colors: { themeColor: "#0B2D5B", backgroundColor: "#0B2D5B" },
  social: {},
  promo: {
    eyebrow: "Refill. Refresh. Repeat.",
    headline: "Crystal-clear water in seconds.",
    body: "Every drop passes through a 7-stage filtration system and is chilled to the perfect temperature. Bring your own bottle and help us keep a million plastic bottles out of landfill.",
    highlights: [
      { title: "7-stage filtration", description: "Lab-tested every week" },
      { title: "Chilled to 6°C", description: "Fresh and crisp" },
      { title: "Plastic-free", description: "Bring your own bottle" },
    ],
  },
  kiosk: {
    footer: "LESS PLASTIC. MORE REFILLS.",
    scanCaption: "SCAN TO CHOOSE YOUR VOLUME",
    scanHint: "Use your phone camera.",
    messages: {
      idle: ["REFILL YOUR BOTTLE", "Stay hydrated. Scan the code to start."],
      offline: ["BE RIGHT BACK", "This station is reconnecting."],
      selecting: ["CHOOSE YOUR VOLUME", "Pick an amount on your phone."],
      placing: ["PLACE YOUR BOTTLE", "Put it under the nozzle. Filling starts automatically."],
      dispensing: ["FILLING...", ""],
      almost: ["ALMOST THERE...", ""],
      paused: ["PLACE YOUR CUP BACK", "Refill paused. It continues as soon as your cup is under the nozzle."],
      completed: ["FULLY CHARGED!", "STAY HYDRATED."],
      thanks: ["THANKS FOR REFILLING!", "Ready for the next refill."],
      failed: ["PLEASE CHECK YOUR BOTTLE", "Make sure your bottle is properly positioned."],
    },
  },
  copy: {
    selectTitle: "How much water?",
    selectSubtitle: "Tap an amount, then place your bottle under the nozzle.",
    placeCupTitle: "Place your bottle under the nozzle",
    placeCupSubtitle: "Filling starts automatically as soon as your bottle is in place.",
    scanAgainTitle: "Scan to start",
    scanAgainMessage: "For your security, each QR code works once. Scan the code on the dispenser screen to start a refill.",
    scanAgainLabel: "Scan QR code",
    refillAgainMessage: "Need more? Scan the dispenser’s QR code again.",
    phoneConnectingTitle: "Connecting to the dispenser…",
    phoneDispensingTitle: "Filling",
    phoneDispensingMessage: "Keep your bottle under the nozzle and watch the screen.",
    phonePausedTitle: "Place your cup back",
    phonePausedMessage: "Refill paused. Put your cup back under the nozzle and filling continues automatically.",
    phoneDoneTitle: "Fully charged!",
    phoneDoneMessage: "Enjoy your water — and thanks for choosing refills.",
  },
} as const satisfies Brand;
