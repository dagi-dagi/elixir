/*
  ==============================================================
  ELIXIR - FOUR CHANNEL WATER DISPENSER
  Board: ESP32 DevKit (ESP32-WROOM-32)
  ==============================================================

  Arduino IDE setup
    Boards Manager : "esp32" by Espressif Systems (2.x or 3.x)
    Board          : "ESP32 Dev Module"
    Libraries      : ArduinoMqttClient (Arduino), ArduinoJson v7 (Benoit Blanchon)

  Credentials
    Wi-Fi and MQTT settings are below (WIFI / MQTT CONFIGURATION).
    The ESP32 only sees 2.4 GHz Wi-Fi: set a phone hotspot to 2.4 GHz.

  MQTT topics (prefix MQTT_TOPIC_PREFIX, id 1..4)
    elixir/dispensers/<id>/qr-token   in   {token}            retained, one-time QR token
    elixir/dispensers/<id>/scan       in   {sessionId, token}
    elixir/dispensers/<id>/session    out  {sessionId, status: started|rejected, reason?}
    elixir/dispensers/<id>/dispense   in   {sessionId, litres}
    elixir/dispensers/<id>/status     out  {sessionId, status: dispensing|paused|completed|failed,
                                            dispensedLitres?, reason?}

  Wiring (per channel 1..4)
    Flow sensor signal : GPIO 25, 26, 27, 13   (interrupt, internal pull-up)
    IR cup sensor      : GPIO 32, 33, 34, 35   (34/35 are input-only, no pull-up:
                                                 use IR modules with their own pull-up)
    Relay IN           : GPIO 23, 22, 21, 19

  ESP32 pins are 3.3 V only.
    - Flow sensors powered from 5 V (YF-S201 etc.) must have their signal brought
      down to 3.3 V (e.g. 10k / 20k divider), or pulled up to 3.3 V instead of 5 V.
    - Power IR modules from 3.3 V.
    - Relay modules: use opto-isolated, active-LOW modules (they switch fine from 3.3 V).

  Levels (change below if your modules differ)
    Relay : LOW  = valve open,  HIGH = valve closed
    IR    : HIGH = cup present, LOW  = no cup
    Flow  : counted on the FALLING edge
  ==============================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoMqttClient.h>
#include <ArduinoJson.h>

// =============================================================
// WIFI / MQTT CONFIGURATION
// =============================================================

#define WIFI_SSID          "Redmi"
#define WIFI_PASSWORD      "mynet123"

// Hostname only: no wss://, no port, no /mqtt.
#define MQTT_HOST          "i1e11f52.ala.eu-central-1.emqxsl.com"
#define MQTT_USERNAME      "greengold"
#define MQTT_PASSWORD      "123456"

#define MQTT_PORT          8883          // MQTT over TLS (not the 8084 websocket port)
#define MQTT_TOPIC_PREFIX  "elixir"      // must match NEXT_PUBLIC_MQTT_TOPIC_PREFIX
#define MQTT_QOS           1

// 1 = verify the broker certificate (recommended), 0 = skip verification (testing only).
#define MQTT_TLS_VERIFY    1

// Root CAs of the EMQX Cloud broker (*.emqxsl.com):
// DigiCert Global Root G2 (valid to 2038) and DigiCert Global Root CA (valid to 2031).
static const char ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBhMQswCQYD
VQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQu
Y29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMjAeFw0xMzA4MDExMjAwMDBa
Fw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMx
GTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBS
b290IEcyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/
RrohCgiN9RlUyfuI2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxps
MNzaHxmx1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5WztCO7TG1F
8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQvIOlCsRnKPZzFBQ9
RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4G
A1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcN
AQELBQADggEBAGBnKJRvDkhj6zHd6mcY1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVn
NeyIv/iPsGEMNKSuIEyExtv4NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2Z
L7tcu7XUIOGZX1NGFdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUT
Fy8bJZ918rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTflMrY=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDrzCCApegAwIBAgIQCDvgVpBCRrGhdWrJWZHHSjANBgkqhkiG9w0BAQUFADBhMQswCQYD
VQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQu
Y29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBDQTAeFw0wNjExMTAwMDAwMDBa
Fw0zMTExMTAwMDAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMx
GTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBS
b290IENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4jvhEXLeqKTTo1eqUKKP
C3eQyaKl7hLOllsBCSDMAZOnTjC3U/dDxGkAV53ijSLdhwZAAIEJzs4bg7/fzTtxRuLWZscF
s3YnFo97nh6Vfe63SKMI2tavegw5BmV/Sl0fvBf4q77uKNd0f3p4mVmFaG5cIzJLv07A6Fpt
43C/dxC//AH2hdmoRBBYMql1GNXRor5H4idq9Joz+EkIYIvUX7Q6hL+hqkpMfT7PT19sdl6g
SzeRntwi5m3OFBqOasv+zbMUZBfHWymeMr/y7vrTC0LUq7dBMtoM1O/4gdW7jVg/tRvoSSii
cNoxBN33shbyTApOB6jtSj1etX+jkMOvJwIDAQABo2MwYTAOBgNVHQ8BAf8EBAMCAYYwDwYD
VR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUA95QNVbRTLtm8KPiGxvDl7I90VUwHwYDVR0jBBgw
FoAUA95QNVbRTLtm8KPiGxvDl7I90VUwDQYJKoZIhvcNAQEFBQADggEBAMucN6pIExIK+t1E
nE9SsPTfrgT1eXkIoyQY/EsrhMAtudXH/vTBH1jLuG2cenTnmCmrEbXjcKChzUyImZOMkXDi
qw8cvpOp/2PV5Adg06O/nVsJ8dWO41P0jmP6P6fbtGbfYmbW0W5BjfIttep3Sp+dWOIrWcBA
I+0tKIJFPnlUkiaY4IBIqDfv8NZ5YBberOgOzW6sRBc4L0na4UU+Krk2U886UAb3LujEV0ls
YSEY1QSteDwsOoBrp+uvFRTp2InBuThs4pFsiv9kuXclVzDAGySj4dzp30d8tbQkCAUw7C29
C79Fv1C5qfPrmAESrciIxpg0X40KPMbp1ZWVbd4=
-----END CERTIFICATE-----
)PEM";

// Website dispenser IDs, one per channel.
#define CHANNELS 4
const char* const DISPENSER_IDS[CHANNELS] = { "1", "2", "3", "4" };

// =============================================================
// PIN CONFIGURATION
// =============================================================

const uint8_t FLOW_PINS[CHANNELS]  = { 25, 26, 27, 13 };
const uint8_t IR_PINS[CHANNELS]    = { 32, 33, 34, 35 };
const uint8_t RELAY_PINS[CHANNELS] = { 23, 22, 21, 19 };

#define RELAY_OPEN_LEVEL   LOW     // level that opens the valve
#define IR_PRESENT_LEVEL   HIGH    // level the IR sensor gives when a cup is present

// =============================================================
// FLOW CALIBRATION
// =============================================================

// Pulses per litre. Calibrate each sensor independently.
float PULSES_PER_LITER[CHANNELS] = { 450.0f, 450.0f, 450.0f, 450.0f };

// =============================================================
// TIMING CONFIGURATION
// =============================================================

#define SESSION_TIMEOUT_MS       62000UL   // scan -> litres chosen on the phone
#define CUP_TIMEOUT_MS           60000UL   // litres chosen -> cup placed
#define PAUSE_TIMEOUT_MS         15000UL   // cup removed -> session ends (kiosk shows the countdown)
#define SESSION_REPLY_DELAY_MS     300UL

#define IR_DEBOUNCE_MS              50UL
#define NO_FLOW_TIMEOUT_MS        5000UL
#define POUR_TIME_MARGIN_MS      15000UL

#define PROGRESS_INTERVAL_MS      1000UL
#define RECONNECT_INTERVAL_MS     5000UL
#define DIAGNOSTICS_INTERVAL_MS  10000UL   // 0 = off. Printing blocks the loop, keep it slow.

#define MAX_LITRES                 25.0f
#define NOMINAL_FLOW_LPS            0.5f   // expected maximum flow: 30 L/min

// =============================================================
// TYPES AND GLOBAL STATE
// (declared before any function: the Arduino IDE puts its
//  generated prototypes in front of the first function)
// =============================================================

enum class Phase : uint8_t { Idle, Session, AwaitingCup, Pouring, Paused };

struct Channel {
  Phase phase = Phase::Idle;

  char sessionId[65] = "";
  char qrToken[65] = "";

  float targetLitres = 0.0f;
  float lastLitres = 0.0f;

  unsigned long phaseSince = 0;
  unsigned long pourStarted = 0;
  unsigned long pourDeadline = 0;
  unsigned long lastFlowChange = 0;
  unsigned long lastProgressPublish = 0;
  unsigned long pausedAt = 0;

  bool sessionReplyPending = false;
  unsigned long sessionReplyAt = 0;

  // IR debounce
  bool irRaw = false;
  bool irStable = false;
  unsigned long irChangedAt = 0;
};

Channel channels[CHANNELS];

WiFiClientSecure netClient;
MqttClient mqtt(netClient);

char topicQrToken[CHANNELS][64];
char topicScan[CHANNELS][64];
char topicDispense[CHANNELS][64];
char topicSession[CHANNELS][64];
char topicStatus[CHANNELS][64];

// Flow pulses, counted by interrupts on every channel.
volatile uint32_t pulseCount[CHANNELS] = { 0, 0, 0, 0 };
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;

unsigned long lastReconnectAttempt = 0;
unsigned long lastDiagnostics = 0;

// =============================================================
// FLOW INTERRUPTS
// =============================================================

void IRAM_ATTR countPulse(uint8_t i) {
  portENTER_CRITICAL_ISR(&pulseMux);
  pulseCount[i]++;
  portEXIT_CRITICAL_ISR(&pulseMux);
}

void IRAM_ATTR flowIsr0() { countPulse(0); }
void IRAM_ATTR flowIsr1() { countPulse(1); }
void IRAM_ATTR flowIsr2() { countPulse(2); }
void IRAM_ATTR flowIsr3() { countPulse(3); }

void (*const FLOW_ISRS[CHANNELS])() = { flowIsr0, flowIsr1, flowIsr2, flowIsr3 };

// =============================================================
// GENERAL HELPERS
// =============================================================

bool elapsed(unsigned long since, unsigned long duration) {
  return (unsigned long)(millis() - since) >= duration;
}

void copyStr(char* dst, size_t size, const char* src) {
  strncpy(dst, src ? src : "", size - 1);
  dst[size - 1] = '\0';
}

const char* phaseName(Phase p) {
  switch (p) {
    case Phase::Idle:        return "IDLE";
    case Phase::Session:     return "SESSION";
    case Phase::AwaitingCup: return "WAITING_FOR_CUP";
    case Phase::Pouring:     return "POURING";
    case Phase::Paused:      return "PAUSED";
  }
  return "UNKNOWN";
}

void enterPhase(uint8_t i, Phase p) {
  channels[i].phase = p;
  channels[i].phaseSince = millis();
  Serial.printf("[CH%u] %s\n", i + 1, phaseName(p));
}

// =============================================================
// RELAYS
// =============================================================

void valveOpen(uint8_t i)   { digitalWrite(RELAY_PINS[i], RELAY_OPEN_LEVEL); }
void valveClose(uint8_t i)  { digitalWrite(RELAY_PINS[i], RELAY_OPEN_LEVEL == LOW ? HIGH : LOW); }
bool valveIsOpen(uint8_t i) { return digitalRead(RELAY_PINS[i]) == RELAY_OPEN_LEVEL; }

// =============================================================
// FLOW SENSORS
// =============================================================

uint32_t getPulseCount(uint8_t i) {
  portENTER_CRITICAL(&pulseMux);
  uint32_t result = pulseCount[i];
  portEXIT_CRITICAL(&pulseMux);
  return result;
}

float sensorDispensedLitres(uint8_t i) {
  return getPulseCount(i) / PULSES_PER_LITER[i];
}

void resetFlow(uint8_t i) {
  portENTER_CRITICAL(&pulseMux);
  pulseCount[i] = 0;
  portEXIT_CRITICAL(&pulseMux);
  channels[i].lastLitres = 0.0f;
}

// =============================================================
// IR SENSORS (debounced)
// =============================================================

bool sensorCupPresent(uint8_t i) {
  bool raw = digitalRead(IR_PINS[i]) == IR_PRESENT_LEVEL;

  if (raw != channels[i].irRaw) {
    channels[i].irRaw = raw;
    channels[i].irChangedAt = millis();
  }
  if (elapsed(channels[i].irChangedAt, IR_DEBOUNCE_MS)) {
    channels[i].irStable = channels[i].irRaw;
  }
  return channels[i].irStable;
}

// =============================================================
// MQTT PUBLISH
// =============================================================

bool publishJson(const char* topic, JsonDocument& doc) {
  if (!mqtt.connected()) return false;

  char buffer[384];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));

  mqtt.beginMessage(topic, (unsigned long)length, false, MQTT_QOS);
  mqtt.write((const uint8_t*)buffer, length);
  bool success = mqtt.endMessage() == 1;

  Serial.printf("[MQTT OUT] %s %s%s\n", topic, buffer, success ? "" : "  (FAILED)");
  return success;
}

void publishSession(uint8_t i, const char* sessionId, const char* status, const char* reason) {
  JsonDocument doc;
  doc["dispenserId"] = DISPENSER_IDS[i];
  doc["sessionId"] = sessionId;
  doc["status"] = status;
  if (reason) doc["reason"] = reason;
  publishJson(topicSession[i], doc);
}

void publishStatus(uint8_t i, const char* status, float dispensed, const char* reason) {
  JsonDocument doc;
  doc["dispenserId"] = DISPENSER_IDS[i];
  doc["sessionId"] = channels[i].sessionId;
  doc["status"] = status;
  if (dispensed >= 0) doc["dispensedLitres"] = roundf(dispensed * 100.0f) / 100.0f;
  if (reason) doc["reason"] = reason;
  publishJson(topicStatus[i], doc);
}

// =============================================================
// SESSION MANAGEMENT
// =============================================================

void toIdle(uint8_t i) {
  valveClose(i);
  channels[i].sessionReplyPending = false;
  channels[i].sessionId[0] = '\0';
  channels[i].targetLitres = 0.0f;
  channels[i].lastLitres = 0.0f;
  enterPhase(i, Phase::Idle);
}

void failSession(uint8_t i, const char* reason) {
  valveClose(i);
  Serial.printf("[CH%u] FAILURE: %s\n", i + 1, reason);
  if (channels[i].sessionId[0]) {
    publishStatus(i, "failed", sensorDispensedLitres(i), reason);
  }
  toIdle(i);
}

// =============================================================
// DISPENSING
// =============================================================

void startPour(uint8_t i) {
  Channel& ch = channels[i];

  resetFlow(i);
  ch.pourStarted = millis();
  ch.lastFlowChange = millis();
  ch.lastProgressPublish = millis();

  float expectedMs = (ch.targetLitres / NOMINAL_FLOW_LPS) * 1000.0f;
  ch.pourDeadline = (unsigned long)(expectedMs * 2.0f) + POUR_TIME_MARGIN_MS;

  enterPhase(i, Phase::Pouring);
  valveOpen(i);
  publishStatus(i, "dispensing", 0.0f, nullptr);

  Serial.printf("[CH%u] Target: %.3f L\n", i + 1, ch.targetLitres);
}

void pausePour(uint8_t i, float litres) {
  valveClose(i);
  channels[i].pausedAt = millis();
  enterPhase(i, Phase::Paused);
  publishStatus(i, "paused", litres, "cup_removed");
}

void resumePour(uint8_t i) {
  Channel& ch = channels[i];

  // The pause doesn't count towards the pour deadline.
  ch.pourStarted += millis() - ch.pausedAt;
  ch.lastFlowChange = millis();
  ch.lastProgressPublish = millis();

  enterPhase(i, Phase::Pouring);
  valveOpen(i);
  publishStatus(i, "dispensing", sensorDispensedLitres(i), nullptr);
}

// =============================================================
// MQTT MESSAGE ROUTING
// =============================================================

int findChannel(const String& topic) {
  for (uint8_t i = 0; i < CHANNELS; i++) {
    if (topic == topicQrToken[i] || topic == topicScan[i] || topic == topicDispense[i]) return i;
  }
  return -1;
}

bool payloadMatchesChannel(JsonDocument& doc, uint8_t i) {
  JsonVariant id = doc["dispenserId"];
  if (id.isNull()) return true;
  if (id.is<const char*>()) return strcmp(id.as<const char*>(), DISPENSER_IDS[i]) == 0;
  if (id.is<long>()) return id.as<long>() == atol(DISPENSER_IDS[i]);
  return false;
}

// The kiosk publishes a fresh one-time token (retained) every time it shows a new QR.
void handleQrToken(uint8_t i, JsonDocument& doc) {
  const char* token = doc["token"] | "";
  if (!*token) return;
  copyStr(channels[i].qrToken, sizeof(channels[i].qrToken), token);
  Serial.printf("[CH%u] QR token updated\n", i + 1);
}

void handleScan(uint8_t i, JsonDocument& doc) {
  const char* sessionId = doc["sessionId"] | "";
  const char* token = doc["token"] | "";
  if (!*sessionId) return;

  if (channels[i].phase != Phase::Idle) {
    publishSession(i, sessionId, "rejected",
      "This dispenser is serving someone else right now. Please wait and scan again.");
    return;
  }

  if (!*token || !channels[i].qrToken[0] || strcmp(token, channels[i].qrToken) != 0) {
    publishSession(i, sessionId, "rejected",
      "This QR code has already been used or has expired. Scan the code on the dispenser screen again.");
    return;
  }

  // Consume the one-time QR token.
  channels[i].qrToken[0] = '\0';

  copyStr(channels[i].sessionId, sizeof(channels[i].sessionId), sessionId);
  enterPhase(i, Phase::Session);
  channels[i].sessionReplyPending = true;
  channels[i].sessionReplyAt = millis() + SESSION_REPLY_DELAY_MS;
}

void handleDispense(uint8_t i, JsonDocument& doc) {
  const char* sessionId = doc["sessionId"] | "";
  float litres = doc["litres"] | 0.0f;
  if (!*sessionId) return;

  // Only the session that scanned the QR code may dispense.
  bool acceptable =
    channels[i].phase == Phase::Session &&
    strcmp(sessionId, channels[i].sessionId) == 0;

  if (!acceptable) {
    JsonDocument out;
    out["dispenserId"] = DISPENSER_IDS[i];
    out["sessionId"] = sessionId;
    out["status"] = "failed";
    out["reason"] = channels[i].phase == Phase::Idle
      ? "This session has ended. Scan the code on the dispenser screen again."
      : "Dispenser is busy";
    publishJson(topicStatus[i], out);
    return;
  }

  channels[i].sessionReplyPending = false;

  if (!(litres > 0.0f) || litres > MAX_LITRES) {
    failSession(i, "Invalid amount requested");
    return;
  }

  channels[i].targetLitres = litres;
  enterPhase(i, Phase::AwaitingCup);
  Serial.printf("[CH%u] Waiting for cup: %.3f L\n", i + 1, litres);

  if (sensorCupPresent(i)) startPour(i);
}

void onMqttMessage(int size) {
  String topic = mqtt.messageTopic();

  char payload[512];
  int length = 0;
  while (mqtt.available()) {
    int c = mqtt.read();
    if (length < (int)sizeof(payload) - 1) payload[length++] = (char)c;
  }
  payload[length] = '\0';

  if (size == 0 || length == 0) return;

  Serial.printf("[MQTT IN] %s %s\n", topic.c_str(), payload);

  int i = findChannel(topic);
  if (i < 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, payload, length) || !doc.is<JsonObject>() || !payloadMatchesChannel(doc, i)) {
    Serial.println("[MQTT] Invalid payload");
    return;
  }

  if (topic == topicQrToken[i])       handleQrToken(i, doc);
  else if (topic == topicScan[i])     handleScan(i, doc);
  else if (topic == topicDispense[i]) handleDispense(i, doc);
}

// =============================================================
// CHANNEL STATE MACHINE
// =============================================================

void tickChannel(uint8_t i) {
  Channel& ch = channels[i];

  switch (ch.phase) {
    case Phase::Idle:
      break;

    case Phase::Session:
      if (ch.sessionReplyPending && (long)(millis() - ch.sessionReplyAt) >= 0) {
        ch.sessionReplyPending = false;
        publishSession(i, ch.sessionId, "started", nullptr);
      }
      if (elapsed(ch.phaseSince, SESSION_TIMEOUT_MS)) {
        Serial.printf("[CH%u] Session expired\n", i + 1);
        toIdle(i);
      }
      break;

    case Phase::AwaitingCup:
      if (sensorCupPresent(i)) {
        Serial.printf("[CH%u] Cup detected\n", i + 1);
        startPour(i);
      } else if (elapsed(ch.phaseSince, CUP_TIMEOUT_MS)) {
        failSession(i, "No cup detected");
      }
      break;

    case Phase::Pouring: {
      float litres = sensorDispensedLitres(i);

      // Cup removed: stop the water first.
      if (!sensorCupPresent(i)) {
        pausePour(i, litres);
        break;
      }

      if (litres >= ch.targetLitres) {
        valveClose(i);
        publishStatus(i, "completed", ch.targetLitres, nullptr);
        Serial.printf("[CH%u] COMPLETED\n", i + 1);
        toIdle(i);
        break;
      }

      if (elapsed(ch.pourStarted, ch.pourDeadline)) {
        failSession(i, "Pour took too long");
        break;
      }

      if (litres > ch.lastLitres + 0.0001f) {
        ch.lastLitres = litres;
        ch.lastFlowChange = millis();
      } else if (elapsed(ch.lastFlowChange, NO_FLOW_TIMEOUT_MS)) {
        failSession(i, "No water flow detected");
        break;
      }

      if (elapsed(ch.lastProgressPublish, PROGRESS_INTERVAL_MS)) {
        ch.lastProgressPublish = millis();
        publishStatus(i, "dispensing", litres, nullptr);
      }
      break;
    }

    case Phase::Paused:
      if (sensorCupPresent(i)) {
        Serial.printf("[CH%u] Cup returned\n", i + 1);
        resumePour(i);
      } else if (elapsed(ch.pausedAt, PAUSE_TIMEOUT_MS)) {
        failSession(i, "The bottle wasn't put back, so the refill stopped.");
      }
      break;
  }
}

// =============================================================
// WIFI (non-blocking: the ESP32 reconnects by itself)
// =============================================================

const char* wifiReasonHint(uint8_t reason) {
  switch (reason) {
    case 2: case 15: case 204:
      return "- wrong password?";
    case 201:
      return "- network not found: check the SSID, and that the hotspot is on 2.4 GHz";
    case 202:
      return "- authentication failed: check the password / security type";
    case 8: case 200:
      return "- signal lost or the access point dropped the board";
    default:
      return "";
  }
}

void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[WIFI] Connected, IP %s, signal %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      uint8_t reason = info.wifi_sta_disconnected.reason;
      Serial.printf("[WIFI] Disconnected (reason %u) %s\n", reason, wifiReasonHint(reason));
      break;
    }
    default:
      break;
  }
}

void wifiBegin() {
  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // keeps MQTT responsive
  WiFi.setAutoReconnect(true);
  Serial.printf("[WIFI] Connecting to \"%s\"...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// =============================================================
// MQTT
// =============================================================

void buildTopics() {
  for (uint8_t i = 0; i < CHANNELS; i++) {
    const char* id = DISPENSER_IDS[i];
    snprintf(topicQrToken[i],  sizeof(topicQrToken[i]),  "%s/dispensers/%s/qr-token", MQTT_TOPIC_PREFIX, id);
    snprintf(topicScan[i],     sizeof(topicScan[i]),     "%s/dispensers/%s/scan",     MQTT_TOPIC_PREFIX, id);
    snprintf(topicDispense[i], sizeof(topicDispense[i]), "%s/dispensers/%s/dispense", MQTT_TOPIC_PREFIX, id);
    snprintf(topicSession[i],  sizeof(topicSession[i]),  "%s/dispensers/%s/session",  MQTT_TOPIC_PREFIX, id);
    snprintf(topicStatus[i],   sizeof(topicStatus[i]),   "%s/dispensers/%s/status",   MQTT_TOPIC_PREFIX, id);
  }
}

void mqttSetup() {
#if MQTT_TLS_VERIFY
  netClient.setCACert(ROOT_CA);
#else
  netClient.setInsecure();
#endif
  netClient.setHandshakeTimeout(10);   // seconds; the default would block for minutes

  char clientId[40];
  snprintf(clientId, sizeof(clientId), "elixir-esp32-%012llx", (unsigned long long)ESP.getEfuseMac());

  mqtt.setId(clientId);
  mqtt.setUsernamePassword(MQTT_USERNAME, MQTT_PASSWORD);
  mqtt.setCleanSession(true);
  mqtt.setKeepAliveInterval(30000);
  mqtt.setConnectionTimeout(8000);
  mqtt.setTxPayloadSize(512);
  mqtt.onMessage(onMqttMessage);
}

// Blocks for the TLS handshake (a few seconds). Only called when no channel is pouring.
bool connectMqtt() {
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.printf("[MQTT] Connecting to %s:%d...\n", MQTT_HOST, MQTT_PORT);
  if (!mqtt.connect(MQTT_HOST, MQTT_PORT)) {
    // -2 = TLS/TCP failed (host, port, certificate), 4 = bad username/password, 5 = not authorized
    Serial.printf("[MQTT] Failed, error %d\n", mqtt.connectError());
    return false;
  }

  for (uint8_t i = 0; i < CHANNELS; i++) {
    mqtt.subscribe(topicQrToken[i], MQTT_QOS);
    mqtt.subscribe(topicScan[i], MQTT_QOS);
    mqtt.subscribe(topicDispense[i], MQTT_QOS);
  }

  Serial.println("[MQTT] Connected");
  return true;
}

// =============================================================
// HARDWARE SETUP
// =============================================================

void hwSetup() {
  // Valves closed before anything else.
  for (uint8_t i = 0; i < CHANNELS; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    valveClose(i);
  }

  for (uint8_t i = 0; i < CHANNELS; i++) {
    pinMode(FLOW_PINS[i], INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(FLOW_PINS[i]), FLOW_ISRS[i], FALLING);
  }

  for (uint8_t i = 0; i < CHANNELS; i++) {
    pinMode(IR_PINS[i], INPUT);
    bool initial = digitalRead(IR_PINS[i]) == IR_PRESENT_LEVEL;
    channels[i].irRaw = initial;
    channels[i].irStable = initial;
    channels[i].irChangedAt = millis();
  }
}

// =============================================================
// SERIAL DIAGNOSTICS
// =============================================================

void printDiagnostics() {
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  Serial.printf("[DIAG] wifi %s (%d dBm), mqtt %s\n",
                wifiUp ? "up" : "down", wifiUp ? WiFi.RSSI() : 0,
                mqtt.connected() ? "up" : "down");

  for (uint8_t i = 0; i < CHANNELS; i++) {
    Serial.printf("[DIAG] CH%u %-15s cup %-7s pulses %-6lu %.3f / %.3f L  valve %s\n",
                  i + 1,
                  phaseName(channels[i].phase),
                  channels[i].irStable ? "PRESENT" : "ABSENT",
                  (unsigned long)getPulseCount(i),
                  sensorDispensedLitres(i),
                  channels[i].targetLitres,
                  valveIsOpen(i) ? "OPEN" : "CLOSED");
  }
}

// =============================================================
// SETUP / LOOP
// =============================================================

void setup() {
  // Close the valves before the serial port and Wi-Fi start.
  hwSetup();

  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("====================================");
  Serial.println(" ELIXIR FOUR CHANNEL DISPENSER");
  Serial.println(" ESP32");
  Serial.println("====================================");

  if (strstr(MQTT_HOST, "://") || strchr(MQTT_HOST, '/') || strchr(MQTT_HOST, ':')) {
    Serial.println("[ERROR] MQTT_HOST must be the hostname only (no wss://, port or /mqtt).");
    while (true) delay(1000);   // valves stay closed
  }

  buildTopics();
  mqttSetup();
  wifiBegin();

  Serial.println("[FW] Ready");
}

void loop() {
  bool activePour = false;
  for (uint8_t i = 0; i < CHANNELS; i++) {
    if (channels[i].phase == Phase::Pouring || channels[i].phase == Phase::Paused) activePour = true;
  }

  if (mqtt.connected()) {
    mqtt.poll();
  } else if (!activePour && elapsed(lastReconnectAttempt, RECONNECT_INTERVAL_MS)) {
    // A reconnect blocks for a few seconds, so it never runs while water is flowing:
    // the cup sensor must keep being checked.
    lastReconnectAttempt = millis();
    connectMqtt();
  }

  for (uint8_t i = 0; i < CHANNELS; i++) tickChannel(i);

  if (DIAGNOSTICS_INTERVAL_MS && elapsed(lastDiagnostics, DIAGNOSTICS_INTERVAL_MS)) {
    lastDiagnostics = millis();
    printDiagnostics();
  }
}
