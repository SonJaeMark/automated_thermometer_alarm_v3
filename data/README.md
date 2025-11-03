# 🌡️ ESP32 Chemical Sensor Dashboard

A responsive web-based dashboard for monitoring real-time temperature readings from an **ESP32 chemical sensor system**.
It features live graph updates, chemical database management, and **automatic buzzer alarm alerts** when the temperature threshold is reached.

---

## 📁 Project Structure

```
📦 esp32-chemical-dashboard
├── index.html        # Main web interface (Dashboard, Database, About)
├── script.js         # Handles ESP32 WebSocket, chart, recording, buzzer logic
├── stylesheet.css    # Custom UI styling (Glassmorphism theme)
```

---

## 🚀 Features

### 🧪 Dashboard

* Real-time temperature updates from ESP32 (via WebSocket)
* **Automatic buzzer alarm when temperature exceeds threshold**
* Dynamic line chart (Chart.js)
* Threshold customization
* Data recording, saving, and CSV export

### 📚 Chemical Database

* Add, edit, delete, and search chemical entries
* Columns:

  * Chemical Name
  * Formula
  * Boiling Point
  * Freezing Point
  * Hazard Level
  * Notes

### ℹ️ About Section

* Project overview, safety info, and version details

---

## ⚙️ Setup & Deployment

### 🧩 Requirements

* ESP32 (any model: **ESP32 / ESP32-S2 / ESP32-C3**)
* Wi-Fi connection
* WebSocket-compatible ESP32 firmware
* Web browser (for UI access)

### 🪜 Steps

1. Flash your ESP32 with your WebSocket code (example: `/ws` endpoint).
   Example:

   ```cpp
   AsyncWebSocket ws("/ws");
   ```
2. Upload the web files (`index.html`, `stylesheet.css`, `script.js`) to your server or open `index.html` directly in your browser.
3. Ensure your browser and ESP32 are on the **same Wi-Fi network**.
4. Click **Test Connection** to verify communication.
5. Set your **threshold** and monitor data in real time.

---

## 🔔 Buzzer Alarm Integration

The buzzer alarm triggers automatically when the ESP32 temperature reading **exceeds the set threshold**.

### 🧠 Logic Overview

In `script.js`, a buzzer sound plays continuously until the temperature falls back below the threshold or recording stops.

### 🧩 Example Code Snippet

```js
// Load buzzer sound
const buzzerSound = new Audio('buzzer.mp3'); // You can replace with any .mp3 or .wav file
buzzerSound.loop = true; // Makes it continuous

function checkThreshold(currentTemp, threshold) {
    const alarmIndicator = document.getElementById("connection-indicator");

    if (currentTemp >= threshold) {
        if (buzzerSound.paused) buzzerSound.play();
        alarmIndicator.classList.remove("status-disconnected");
        alarmIndicator.classList.add("status-connected");
        alarmIndicator.style.background = "#ef4444"; // Red for alert
    } else {
        buzzerSound.pause();
        buzzerSound.currentTime = 0; // Reset
        alarmIndicator.style.background = "#10b981"; // Green = normal
    }
}
```

### 🔌 ESP32 Connection Example

In your ESP32 code, send temperature readings as JSON:

```cpp
// Example JSON message sent via WebSocket
ws.textAll("{\"temperature\": 102.5}");
```

The frontend receives the data and triggers the alarm automatically.

---

## 🖥️ ESP32 Compatibility

✅ ESP32
✅ ESP32-S2
✅ ESP32-C3
✅ Compatible with sensors such as **MAX6675**, **DS18B20**, or analog thermistors

---

## 🎨 UI Design

* Built with **HTML**, **CSS**, and **Vanilla JavaScript**
* Tailwind CSS (CDN) for responsiveness
* Chart.js for real-time graph visualization
* Glassmorphism + Neon-inspired dashboard design

---

## 📦 Frontend Dependencies

| Library                                 | Purpose                                   |
| --------------------------------------- | ----------------------------------------- |
| [Chart.js](https://www.chartjs.org/)    | Real-time temperature charts              |
| [TailwindCSS](https://tailwindcss.com/) | Responsive, modern UI                     |
| Vanilla JavaScript                      | App logic, event handling, buzzer control |

---

## 🧰 Optional Backends

You can integrate with:

* **Google Sheets (Apps Script)** for cloud-based chemical database
* **Firebase Realtime Database** for IoT data storage
* **Node.js + Express** for WebSocket data relay

---

## 🧩 Configuration

Edit default titles in `script.js`:

```js
const defaultConfig = {
    app_title: "ESP32 Chemical Sensor Dashboard",
    dashboard_title: "Dashboard",
    database_title: "Chemical Database",
    about_title: "About"
};
```

---

## 📊 Example Use Cases

* Laboratory temperature monitoring
* Boiling/freezing point experiments
* Chemical hazard safety management
* IoT environmental sensor projects

---

## 🧑‍💻 Author

**Mark Jayson Lanuzo**
📍 Manila, Philippines
🌐 [temperaturewebui.netlify.app](https://temperaturewebui.netlify.app/)

---

## 🧾 License

This project is open-source and free for educational and personal use.
Attribution is appreciated if reused in research or public demonstrations.


