/**
 * @file automated_thermometer_alarm_v3.ino
 * @brief ESP32-based MAX6675 temperature monitoring system with LittleFS web hosting and WebSocket communication.
 *
 * ## Overview
 * This firmware allows an ESP32 to:
 * - Serve a Supabase-connected dashboard via LittleFS (`index.html`, `style.css`, `script.js`)
 * - Connect to Wi-Fi using WiFiManager (no hardcoded credentials)
 * - Stream real-time temperature readings from a MAX6675 thermocouple over WebSocket
 * - Control active-low LEDs for connection, reading, recording, and threshold alerts
 *
 * ## Features
 * - Wi-Fi configuration portal (`ESP32-Setup`) with static IP 192.168.1.200
 * - WebSocket server endpoint `/ws`
 * - Active-low LED logic:
 *   - LOW = ON
 *   - HIGH = OFF
 * - JSON-based communication protocol between ESP32 and browser client
 *
 * Commands:
 *   - "test"              → replies { "status": "ok" }
 *   - "web_connected"     → turns ON green LED
 *   - "web_disconnected"  → turns OFF green LED
 *   - "start_record"      → begins saving readings, yellow LED blinks
 *   - "end_record"        → stops recording
 *   - "threshold_alert_on"   → blinks red LED (0.5s cycle)
 *   - "threshold_alert_off"  → stops blinking red LED
 *   - "get_record"        → sends recorded readings as JSON array
 *
 * @note Default static IP: 192.168.1.200
 * ## Author
 * @author Mark Jayson Lanuzo
 * @date 2025-10-30
 */

#include <WiFiManager.h>         ///< Library for easy Wi-Fi configuration
#include <ESPAsyncWebServer.h>   ///< Asynchronous web server for serving pages and WebSocket
#include <AsyncTCP.h>            ///< TCP support for AsyncWebServer
#include <ArduinoJson.h>         ///< JSON encoding/decoding for WebSocket communication
#include <max6675.h>             ///< MAX6675 thermocouple sensor driver
#include <LittleFS.h>            ///< Filesystem library for storing web assets

// -------------------- GLOBAL OBJECTS --------------------

AsyncWebServer server(80);       ///< HTTP server instance on port 80
AsyncWebSocket ws("/ws");        ///< WebSocket endpoint at "/ws"

unsigned long lastSendTime = 0;  ///< Timestamp for temperature send interval
bool isRecording = false;        ///< Indicates if temperature recording is active
std::vector<float> recordedData; ///< Container for storing recorded temperature values

AsyncWebSocketClient *activeClient = nullptr;  ///< Pointer to the currently connected client
bool clientConnected = false;                  ///< True if one client is connected


// -------------------- HARDWARE PINS --------------------

/** MAX6675 pin configuration */
const int thermoSO = 19; ///< Serial Out (MISO)
const int thermoCS = 5;  ///< Chip Select
const int thermoSCK = 18;///< Serial Clock

MAX6675 thermocouple(thermoSCK, thermoCS, thermoSO); ///< MAX6675 sensor instance

/** LED pins (Active-Low logic) */
const int LED_GREEN  = 13; ///< Connection indicator LED
const int LED_BLUE   = 27; ///< Reading indicator LED
const int LED_RED    = 23; ///< Threshold alert LED
const int LED_YELLOW = 33; ///< Recording status LED

// LED blinking state flags and timing trackers
bool redBlink = false;             ///< Whether red LED is blinking (threshold alert)
bool yellowBlink = false;          ///< Whether yellow LED is blinking (recording active)
unsigned long lastRedToggle = 0;   ///< Timer for red LED blink toggle
unsigned long lastYellowToggle = 0;///< Timer for yellow LED blink toggle
unsigned long lastBlueBlink = 0;   ///< Timer for blue LED momentary blink

// -------------------- FUNCTION DECLARATIONS --------------------

/**
 * @brief Initializes all LED pins and sets them OFF (HIGH for active-low logic).
 */
void setupLEDs() {
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);

  // Turn all LEDs OFF initially (active-low = HIGH)
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_BLUE, HIGH);
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_YELLOW, HIGH);
}

/**
 * @brief Turns an LED ON or OFF using active-low logic.
 * @param pin The GPIO pin connected to the LED.
 * @param state True = ON (LOW), False = OFF (HIGH).
 */
void setLED(int pin, bool state) {
  digitalWrite(pin, state ? LOW : HIGH);
}

/**
 * @brief Toggles an LED at a given interval (non-blocking blink).
 * @param pin LED GPIO pin number.
 * @param interval Time in milliseconds between toggles.
 * @param lastToggle Reference to timestamp of the last toggle.
 */
void handleBlink(int pin, unsigned long interval, unsigned long &lastToggle) {
  unsigned long now = millis();
  if (now - lastToggle >= interval) {
    lastToggle = now;
    digitalWrite(pin, !digitalRead(pin)); // Toggle LED state
  }
}

/**
 * @brief Reads the current temperature from the MAX6675 sensor.
 * @return Temperature in Celsius.
 */
float getTemperature() {
  return thermocouple.readCelsius();
}

/**
 * @brief Sends temperature only to the active (single) WebSocket client.
 *
 * This function:
 * - Reads temperature from the sensor
 * - Momentarily blinks the blue LED
 * - Records data if recording mode is active
 * - Broadcasts temperature via WebSocket as JSON
 */
void sendTemperatureToClients() {
  float temp = getTemperature();

  // 🔵 Blink blue LED briefly
  if (millis() - lastBlueBlink >= 1000) {
    lastBlueBlink = millis();
    digitalWrite(LED_BLUE, LOW);
  }

  if (isRecording) recordedData.push_back(temp);

  StaticJsonDocument<100> doc;
  doc["temperature"] = temp;
  String json;
  serializeJson(doc, json);

  // ✅ Send only to active client
  if (activeClient && activeClient->canSend()) {
    activeClient->text(json);
  }
}


/**
 * @brief Handles commands received from a WebSocket client.
 * @param client Pointer to the client that sent the message.
 * @param msg Raw message string.
 *
 * Supported commands:
 * - `"test"`               : Replies with `{ "status": "ok" }`
 * - `"web_connected"`      : Turns ON green LED
 * - `"web_disconnected"`   : Turns OFF green LED
 * - `"start_record"`       : Starts recording and blinks yellow LED
 * - `"end_record"`         : Stops recording and turns off yellow LED
 * - `"threshold_alert_on"` : Enables red LED blinking
 * - `"threshold_alert_off"`: Disables red LED blinking
 * - `"get_record"`         : Sends recorded temperature data as JSON array
 */
void handleClientCommand(AsyncWebSocketClient *client, const char *msg) {
  String message(msg);

  if (message == "test") {
    if (client != activeClient) {
      client->text("{\"error\":\"another user is already connected\"}");
      return;
    }
    client->text("{\"status\":\"ok\"}");

  } else if (message == "web_connected") {
    setLED(LED_GREEN, true);

  } else if (message == "web_disconnected") {
    setLED(LED_GREEN, false);

  } else if (message == "start_record") {
    isRecording = true;
    recordedData.clear();
    yellowBlink = true;
    client->text("{\"recording\":\"started\"}");

  } else if (message == "end_record") {
    isRecording = false;
    yellowBlink = false;
    setLED(LED_YELLOW, false);
    client->text("{\"recording\":\"stopped\"}");

  } else if (message == "threshold_alert_on") {
    redBlink = true;

  } else if (message == "threshold_alert_off") {
    redBlink = false;
    setLED(LED_RED, false);

  } else if (message == "get_record") {
    // Send all recorded readings as JSON array
    StaticJsonDocument<1024> doc;
    JsonArray arr = doc.createNestedArray("data");
    for (float val : recordedData) arr.add(val);
    String json;
    serializeJson(doc, json);
    client->text(json);
    
  } else {
    client->text("{\"error\":\"unknown command\"}");
  }
}

/**
 * @brief WebSocket event callback handler (single-client version).
 * @param server WebSocket server instance.
 * @param client Client that triggered the event.
 * @param type Type of WebSocket event.
 * @param arg Additional event data (unused).
 * @param data Pointer to message data buffer.
 * @param len Length of the received data.
 */
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    // ✅ Allow only one client at a time
    if (clientConnected) {
      Serial.printf("⚠️ Rejecting extra client: %u\n", client->id());
      client->close(); // Disconnect immediately
      return;
    }

    // Register this client as the active one
    activeClient = client;
    clientConnected = true;
    Serial.printf("✅ Client connected: %u\n", client->id());
    setLED(LED_GREEN, true); // Turn ON connection LED

  } else if (type == WS_EVT_DISCONNECT) {
    // Check if the disconnected one is our active client
    if (activeClient && client->id() == activeClient->id()) {
      activeClient = nullptr;
      clientConnected = false;
      Serial.println("❌ Client disconnected");
      setLED(LED_GREEN, false); // Turn OFF connection LED
    }

  } else if (type == WS_EVT_DATA) {
    // Handle data only from the active client
    if (activeClient && client->id() == activeClient->id()) {
      data[len] = 0; // Null-terminate incoming message
      handleClientCommand(client, (char *)data);
    } else {
      Serial.printf("⚠️ Ignoring message from non-active client %u\n", client->id());
    }
  }
}


// -------------------- SETUP --------------------

/**
 * @brief Arduino setup function.
 *
 * - Initializes serial monitor, LEDs, and LittleFS filesystem
 * - Connects to Wi-Fi using WiFiManager
 * - Starts the web server and WebSocket services
 * - Serves web dashboard files from LittleFS root directory
 */
void setup() {
  Serial.begin(115200);
  delay(500);

  setupLEDs(); // Initialize LED pins

  // Mount LittleFS filesystem
  if (!LittleFS.begin()) {
    Serial.println("❌ LittleFS mount failed!");
    return;
  }

  // Configure Wi-Fi connection
  WiFiManager wm;

  // 🧹 Always reset Wi-Fi credentials at startup
  WiFi.disconnect(true, true);  // true,true => erase credentials from flash/NVS
  delay(1000);

  IPAddress staticIP(192, 168, 1, 200);
  IPAddress gateway(192, 168, 1, 1);
  IPAddress subnet(255, 255, 255, 0);
  IPAddress dns(8, 8, 8, 8);
  wm.setSTAStaticIPConfig(staticIP, gateway, subnet, dns);

  // Launch Wi-Fi manager portal if not connected
  bool res = wm.autoConnect("ESP32-Setup", "12345678");
  if (!res) {
    Serial.println("❌ WiFi failed");
    return;
  }

  Serial.println("✅ Connected to WiFi");
  Serial.print("📡 IP: ");
  Serial.println(WiFi.localIP());

  // Serve all files from LittleFS root directory
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // Initialize WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Start HTTP server
  server.begin();
  Serial.println("🌐 Server started → http://192.168.1.200");
}

// -------------------- LOOP --------------------

/**
 * @brief Arduino main loop function.
 *
 * - Periodically sends temperature readings via WebSocket
 * - Handles blinking LEDs using non-blocking timers
 */
void loop() {
  ws.cleanupClients(); // Remove disconnected WebSocket clients

  // Turn off blue LED 200ms after blink
  if (digitalRead(LED_BLUE) == LOW && millis() - lastBlueBlink >= 200)
    digitalWrite(LED_BLUE, HIGH);

  // Handle red (alert) and yellow (recording) blinking LEDs
  if (redBlink) handleBlink(LED_RED, 500, lastRedToggle);
  if (yellowBlink) handleBlink(LED_YELLOW, 1000, lastYellowToggle);

  // Send temperature updates every 1 second
  if (millis() - lastSendTime > 1000) {
    sendTemperatureToClients();
    lastSendTime = millis();
  }
}
