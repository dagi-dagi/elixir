# Elixir — Water Dispenser Kiosk

A kiosk interface for smart water dispensers. Each dispenser has its own
portrait screen (53 × 94 cm). The screen is **display-only**: customers scan
its QR code and do everything on their phone. The screen is a single animated
page that mirrors their session (bottle filling, pause, completion) with the
brand on it.

```
Admin picks dispenser (/setup) ──▶ saved in localStorage
        │
        ▼
Kiosk QR (/) ── phone scans ──▶ /scan/<id> (phone) ── scan ──▶ broker ──▶ controller
                                     │                                       │
Kiosk CHOOSE YOUR VOLUME ◀───────────┼──────────── session ◀─────────────────┘
                                     │  phone shows the litre picker
                                     │── dispense {litres} ──▶ broker ──▶ dispenser (waits for a bottle)
Kiosk PLACE YOUR BOTTLE ◀── dispense (observed)        phone: "place your bottle"
                     bottle detected → pouring starts automatically
Kiosk FILLING… ◀── status: dispensing                  phone: progress
Kiosk REFILL PAUSED ◀── status: paused (bottle lifted; valve closed) ⇄ dispensing (bottle back)
Kiosk FULLY CHARGED! ◀── status: completed  → 3 s countdown → back to the QR
(all on one page: /)
```

## Getting started

```bash
cp .env.example .env.local   # optional; mock transport is the default
npm run dev
```

1. Open <http://localhost:3000>. You'll be sent to **/setup**. Pick a dispenser.
2. The QR screen appears. In dev, click **Open phone simulator** (or open the
   QR's `/scan/<id>` URL in another tab of the same browser). The mock
   broker syncs tabs through `BroadcastChannel`.
3. Pick an amount in the phone tab. Both screens ask you to place your cup.
   The mock "detects" it after `NEXT_PUBLIC_MOCK_CUP_DELAY_MS` (3 s) and pouring
   starts automatically. The kiosk then shows a 3-second thank-you and returns to the QR.

To try the error screens, set `NEXT_PUBLIC_MOCK_FAILURE_RATE=0.5`.

## Mock firmware (real broker)

`services/mock-firmware` is a standalone Node process that connects to the
same MQTT broker as the app and plays the controller plus the dispenser
hardware: it answers scans, waits for a cup, pours with progress, and reports
completion or faults. It reuses the app's protocol, topics, timings and
dispenser list, so the two sides can't drift apart.

```bash
# .env.local: NEXT_PUBLIC_DISPENSER_TRANSPORT=mqtt plus broker URL/credentials
npm run dev        # the app
npm run firmware   # the simulator → dashboard at http://127.0.0.1:4001
```

The dashboard shows each dispenser's live state (idle, session open, waiting
for cup, pouring), a cup/water visual, session and pour stats, the last result,
and a log of every MQTT message in and out. Controls:

- **Auto-place cup**: on, the simulated customer places their cup after
  `FIRMWARE_CUP_DELAY_MS` and removes it after the pour. Off, you place it yourself.
- **Place / Remove cup**: toggles the cup sensor. Removing it mid-pour **pauses** the
  pour, and placing it back resumes. If it isn't back within `FIRMWARE_PAUSE_TIMEOUT_MS`, the refill ends.
- **Trigger fault**: fails the current session (the phone and kiosk show the error).
- **Reset**: returns the unit to idle.

It runs on Node's built-in TypeScript support (Node ≥ 22.18 / 23.6), with no
build step. Settings are listed under `FIRMWARE_*` in [`.env.example`](.env.example).

Stop the simulator before powering the real board: both would answer the same topics.

## Hardware firmware (ESP32)

[`firmware/elixir_dispenser/elixir_dispenser.ino`](firmware/elixir_dispenser/elixir_dispenser.ino)
drives four dispensers (website IDs 1–4) from one ESP32 DevKit: a flow sensor,
an IR cup sensor and a valve relay per channel. The pin map and signal levels
are at the top of the sketch.

1. Arduino IDE → Boards Manager → install **esp32** by Espressif; board **ESP32 Dev Module**.
2. Library Manager → install **ArduinoMqttClient** and **ArduinoJson** (v7).
3. Set the Wi-Fi and broker details under **WIFI / MQTT CONFIGURATION** in the sketch.
   `MQTT_HOST` is the bare hostname; the sketch uses MQTT over TLS on 8883.
   These are real credentials: keep them out of any public repository.
4. Upload and open the Serial Monitor at 115200 baud. Wi-Fi drops are printed with a reason code and hint.

The ESP32 only joins 2.4 GHz networks, so set a phone hotspot to 2.4 GHz.

## Where to change things

| What | Where |
| --- | --- |
| Kiosk display aspect ratio (53:94) | `--stage-ratio-*` in [`app/globals.css`](app/globals.css) |
| Brand name, logo, copy, promo/ad content, SEO | [`config/brand.ts`](config/brand.ts), assets in [`public/brand/`](public/brand/) |
| Theme colors / radius / shadows | [`app/theme.css`](app/theme.css); pick one with `brand.theme` |
| Dispensers, litre options, flow rates | [`config/dispensers.ts`](config/dispensers.ts) |
| Transport, MQTT, topics, timeouts | env vars → [`config/runtime.ts`](config/runtime.ts) (see [`.env.example`](.env.example)) |

All metadata comes from `config/brand.ts`: titles, description, Open Graph,
Twitter, icons, the web manifest and the generated OG image.

## Architecture

The UI only depends on the `DispenserGateway` interface
([`lib/dispenser/types.ts`](lib/dispenser/types.ts)). It doesn't know about MQTT.

```
DispenserGateway  (interface)
  └─ MessageDispenserGateway   maps domain calls ⇄ topics + JSON (protocol.ts)
       └─ MessageTransport     (interface: connect / publish / subscribe)
            ├─ MqttTransport   MQTT.js over WebSockets, lazy-loaded
            └─ MockTransport   in-browser broker + simulated controller
```

- **Registry / injection**: [`lib/dispenser/registry.ts`](lib/dispenser/registry.ts) maps
  `NEXT_PUBLIC_DISPENSER_TRANSPORT` to a lazily imported factory.
  `<DispenserGatewayProvider createGateway={…}>` accepts any implementation,
  for tests or a custom backend.
- **Adding a transport** (HTTP + SSE, plain WebSocket, etc.): implement
  `MessageTransport` (or `DispenserGateway` directly) and add a registry entry.
- **Two state machines**, both pure reducers that ignore stale or out-of-phase events:
  - Phone: [`lib/customer/machine.ts`](lib/customer/machine.ts). It sends the scan,
    waits for the session, lets the customer pick an amount, sends it, asks
    them to place their cup, and follows progress.
  - Kiosk: [`lib/kiosk/machine.ts`](lib/kiosk/machine.ts). It only observes:
    session → awaiting choice → place bottle (dispense command seen) → pouring
    (first status) ⇄ paused → finishing → thank-you.
    [`KioskProvider`](components/kiosk/kiosk-provider.tsx) feeds it gateway
    events and timers. The kiosk is a single page (`/`); the state picks what's shown.
- **Kiosk scene**: [`KioskScene`](components/kiosk/scene/kiosk-scene.tsx) layers
  the brand, messages, QR and ring label (DOM) over a canvas drawn by
  [`SceneRenderer`](components/kiosk/scene/scene-renderer.ts). The renderer
  draws the bottle and water, nozzle, stream, bubbles, particles, ribbons,
  progress ring, brackets, pause symbol and completion burst. It runs its own
  animation loop, so React only re-renders when the state changes. Scene colors
  come from the `--stage-*` tokens in [`app/theme.css`](app/theme.css), and
  messages from `brand.kiosk`.
- **Pause**: lifting the bottle mid-pour makes the firmware close the valve and
  publish `paused`. Putting it back resumes the pour (`dispensing` again). After
  `NEXT_PUBLIC_PAUSE_TIMEOUT_MS` (15 s, shown as a countdown) without the bottle, the refill ends (`failed`).
  The fill animation freezes while paused, because paused time is excluded from the loader.
- **Fixed-ratio display**: the kiosk (and `/setup`) render inside `<KioskStage>`,
  a 53:94 frame (letterboxed if the window differs). While it's on screen, 1rem
  is 1/67.5 of its width (16 px on a 1080-px panel), so every size scales
  together and never reflows.
- **Co-branding**: set `brand.partner` (name and optional logo) to show a
  second brand top-right, for example an event sponsor.

### Message contract

Topics are templates with `{dispenserId}` (default prefix `elixir`). Payloads are JSON.

| Topic | Direction | Payload |
| --- | --- | --- |
| `elixir/dispensers/{id}/qr-token` | kiosk → controller (retained) | `{ dispenserId, token, timestamp }` |
| `elixir/dispensers/{id}/scan` | phone → broker | `{ dispenserId, sessionId, token, timestamp }` |
| `elixir/dispensers/{id}/session` | controller → kiosk + phone | `{ dispenserId, sessionId, status: "started" \| "rejected", reason?, timestamp }` |
| `elixir/dispensers/{id}/dispense` | phone → controller (kiosk listens) | `{ dispenserId, sessionId, litres, timestamp }`. The dispenser holds it until a cup is detected, then starts pouring. |
| `elixir/dispensers/{id}/status` | controller → kiosk + phone | `{ dispenserId, sessionId, status: "dispensing" \| "paused" \| "completed" \| "failed", dispensedLitres?, reason? }` |

The first `status` for a session means a cup was detected and pouring began. If none arrives within
`NEXT_PUBLIC_CUP_TIMEOUT_MS`, both screens report "no cup detected". `dispensedLitres` is optional; the pour views don't use it. They run a classic
loader ([`lib/loader.ts`](lib/loader.ts)) that only knows start (first status) and finish (`completed`):
it rises fast, slows as it nears ~92%, then fills quickly to 100% on finish. Malformed payloads are logged and dropped.

### One-time QR codes

The kiosk's QR link carries a token: `/scan/<id>?t=<token>`.

- Each time the kiosk returns to its QR screen, it shows a fresh token. While
  idle it also rotates the token every `NEXT_PUBLIC_QR_TOKEN_ROTATE_MS` (5 min).
  It publishes the current token, retained, on `…/qr-token`.
- The controller (the firmware, or the in-browser mock) accepts a scan only if
  it carries the current token, and then uses the token up. Any other scan gets
  `session` → `{ status: "rejected", reason }`.
- The phone reads the token, then removes it from the address bar right away.
  Reloading, going back, or reusing a copied link can't start a new session:
  the phone shows **Scan to start**, and the controller would reject the token anyway.
- When a session ends (done, expired or failed), the phone offers **Scan QR code**.
  This is an in-app scanner: live camera on HTTPS or localhost, otherwise
  "take a photo of the code". It only accepts this app's dispenser links.

### Error handling

- Kiosk connection loss: an offline banner, the QR is disabled, and MQTT.js
  reconnects automatically.
- Phone: no session reply, publish failures, no cup detected in time, or a stalled
  status all lead to an error card with **Try again** (a new session). If the
  amount isn't chosen in time, the session expires.
- Kiosk: the same failures show an error screen without controls. Every kiosk
  screen returns to the QR on its own.
- Route `error.tsx` / `global-error.tsx` reload the kiosk after 30s so an
  unattended screen never stays stuck.

### Security note

The kiosk connects to the broker from the browser, so MQTT credentials in
`NEXT_PUBLIC_*` are public. Give the kiosk user an ACL limited to the topics
above (it needs to publish `qr-token` with retain, and subscribe to `session`, `dispense` and `status`). Better still, issue short-lived tokens.
