let ws; // WebSocket connection
let buzzerActive = false;
let buzzerInterval = null; // new variable for continuous alarm


// Configuration object
const defaultConfig = {
    app_title: "ESP32 Chemical Sensor Dashboard",
    dashboard_title: "Dashboard",
    database_title: "Chemical Database", 
    about_title: "About"
};

// Global variables
let temperatureChart;
let isRecording = false;
let temperatureData = [];
let currentThreshold = 100.0;
let editingChemical = null;
let chemicals = [];
let recordCount = 0;
let isConnected = false;
let isConnecting = false;

// Data SDK handler
const dataHandler = {
    onDataChanged(data) {
        chemicals = data;
        renderChemicalsTable();
        recordCount = data.length;
    }
};

// Element SDK implementation
async function onConfigChange(config) {
    const appTitle = config.app_title || defaultConfig.app_title;
    const dashboardTitle = config.dashboard_title || defaultConfig.dashboard_title;
    const databaseTitle = config.database_title || defaultConfig.database_title;
    const aboutTitle = config.about_title || defaultConfig.about_title;

    document.getElementById('app-title').textContent = appTitle;
    document.getElementById('dashboard-tab').textContent = dashboardTitle;
    document.getElementById('database-tab').textContent = databaseTitle;
    document.getElementById('about-tab').textContent = aboutTitle;
}

function mapToCapabilities(config) {
    return {
        recolorables: [],
        borderables: [],
        fontEditable: undefined,
        fontSizeable: undefined
    };
}

function mapToEditPanelValues(config) {
    return new Map([
        ["app_title", config.app_title || defaultConfig.app_title],
        ["dashboard_title", config.dashboard_title || defaultConfig.dashboard_title],
        ["database_title", config.database_title || defaultConfig.database_title],
        ["about_title", config.about_title || defaultConfig.about_title]
    ]);
}

// Initialize application
async function initApp() {
    // Initialize Data SDK
    if (window.dataSdk) {
        const initResult = await window.dataSdk.init(dataHandler);
        if (!initResult.isOk) {
            console.error("Failed to initialize data SDK");
        }
    }

    // Initialize Element SDK
    if (window.elementSdk) {
        await window.elementSdk.init({
            defaultConfig,
            onConfigChange,
            mapToCapabilities,
            mapToEditPanelValues
        });
    }

    // Initialize chart
    initChart();
    
    // Initialize connection status
    updateConnectionStatus();
    
    // Start temperature simulation
    startTemperatureSimulation();

    await loadChemicals();

}

// Chart initialization
function initChart() {
    const ctx = document.getElementById('temperatureChart').getContext('2d');
    temperatureChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Temperature (°C)',
                data: [],
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                tension: 0.4,
                fill: true,
                borderWidth: 3,
                pointBackgroundColor: '#60a5fa',
                pointBorderColor: '#1e40af',
                pointBorderWidth: 2,
                pointRadius: 4
            }, {
                label: 'Threshold',
                data: [],
                borderColor: '#ef4444',
                backgroundColor: 'transparent',
                borderDash: [8, 4],
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#e2e8f0',
                        font: {
                            size: 14,
                            weight: '600'
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Temperature (°C)',
                        color: '#e2e8f0',
                        font: {
                            size: 14,
                            weight: '600'
                        }
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.3)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Time',
                        color: '#e2e8f0',
                        font: {
                            size: 14,
                            weight: '600'
                        }
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.3)'
                    }
                }
            }
        }
    });
}

// --- Buzzer sound alert ---
function playBuzzer() {
    if (buzzerInterval) return; // already buzzing

    buzzerInterval = setInterval(() => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);

            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
                audioCtx.close();
            }, 500); // beep duration 0.5s
        } catch (err) {
            console.warn("Buzzer error:", err);
        }
    }, 1000); // repeat every 1 second
}

function stopBuzzer() {
    if (buzzerInterval) {
        clearInterval(buzzerInterval);
        buzzerInterval = null;
    }
}



// Temperature simulation
function startTemperatureSimulation() {
    // ❌ Disable fake simulation
    console.log("Waiting for ESP32 data...");
}

/**
 * @brief Handles temperature updates received from the ESP32 via WebSocket.
 * 
 * This function:
 * - Updates the live temperature display on the dashboard.
 * - Adds readings to the chart if recording is active.
 * - Triggers the buzzer and sends a "threshold_alert" command to the ESP32 when temperature exceeds the threshold.
 * - Stops the buzzer when temperature returns below the threshold.
 * 
 * @param {Object} data - The JSON object received from ESP32 (e.g., { temperature: 28.5 }).
 */
function handleESP32Data(data) {
    const now = new Date(); // Current timestamp
    const timeLabel = now.toLocaleTimeString();
    const currentTemp = data.temperature; // Extract temperature value

    // Display current temperature in UI
    document.getElementById('current-temp').textContent = currentTemp.toFixed(1) + '°C';

    // If recording is active, update the chart and data logs
    if (isRecording) {
        // Add new data point to chart
        temperatureChart.data.labels.push(timeLabel);
        temperatureChart.data.datasets[0].data.push(currentTemp);
        temperatureChart.data.datasets[1].data.push(currentThreshold);

        // 🔔 Threshold check — trigger buzzer + red LED on ESP32
        if (currentTemp >= currentThreshold && !buzzerActive) {
            buzzerActive = true;
            playBuzzer(); // Start buzzer sound locally
            if (ws && ws.readyState === WebSocket.OPEN)
                ws.send("threshold_alert_on"); // Notify ESP32 to blink red LED
            showToast('⚠️ Temperature threshold reached!', 'error');
        }
        // Stop buzzer if temperature drops below threshold
        else if (currentTemp < currentThreshold && buzzerActive) {
            buzzerActive = false;
            stopBuzzer();
            if (ws && ws.readyState === WebSocket.OPEN)
                ws.send("threshold_alert_off"); // Notify ESP32 to stop blinking red LED
            showToast('✅ Temperature back to normal', 'success');
        }

        // Keep chart data size limited to 20 points for readability
        if (temperatureChart.data.labels.length > 20) {
            temperatureChart.data.labels.shift();
            temperatureChart.data.datasets[0].data.shift();
            temperatureChart.data.datasets[1].data.shift();
        }

        temperatureChart.update('none'); // Redraw chart smoothly

        // Save reading to local dataset for export/logging
        temperatureData.push({
            time: now.toISOString(),
            temperature: currentTemp,
            threshold: currentThreshold
        });
    }
}


// Navigation functions
function showPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected page and activate tab
    document.getElementById(pageId).classList.add('active');
    document.querySelector(`[onclick="showPage('${pageId}')"]`).classList.add('active');
}

// Connection functions
function updateConnectionStatus() {
    const indicator = document.getElementById('connection-indicator');
    const text = document.getElementById('connection-text');
    const btn = document.getElementById('connect-btn');
    
    if (isConnecting) {
        indicator.className = 'status-indicator status-connecting';
        text.textContent = 'Connecting...';
        btn.textContent = 'Connecting...';
        btn.disabled = true;
    } else if (isConnected) {
        indicator.className = 'status-indicator status-connected';
        text.textContent = 'Connected';
        btn.textContent = 'Disconnect';
        btn.disabled = false;
    } else {
        indicator.className = 'status-indicator status-disconnected';
        text.textContent = 'Disconnected';
        btn.textContent = 'Test Connection';
        btn.disabled = false;
    }
}

/**
 * @brief Establishes or terminates a WebSocket connection with the ESP32.
 * 
 * - When connecting, it sends a "web_connected" signal to the ESP32.
 * - When disconnecting, it sends a "web_disconnected" signal.
 * - Updates the UI connection status and shows toast notifications.
 * 
 * The ESP32 responds with LED status:
 * 🟢 Green LED = Connected
 * 🔵 Blue LED = Reading
 * 🔴 Red LED = Threshold alert
 * 🟡 Yellow LED = Recording
 */
async function toggleConnection() {
    if (isConnected) {
        // 🔌 Disconnect from ESP32
        if (ws && ws.readyState === WebSocket.OPEN) ws.send("web_disconnected");
        ws.close();
        isConnected = false;
        updateConnectionStatus();
        showToast('Disconnected from ESP32', 'info');
    } else {
        // 🌐 Attempt to connect to ESP32 WebSocket
        const esp32IP = "192.168.1.200"; // 🔧 Change this to your ESP32’s IP
        const wsUrl = `ws://${esp32IP}/ws`;
        isConnecting = true;
        updateConnectionStatus();

        try {
            ws = new WebSocket(wsUrl);

            // When connection opens
            ws.onopen = () => {
                isConnecting = false;
                isConnected = true;
                updateConnectionStatus();
                ws.send("web_connected"); // 🟢 Notify ESP32
                showToast('✅ Connected to ESP32!', 'success');
                ws.send("test"); // Check if this connection is allowed
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // 🧩 Check if ESP32 rejected connection (only one client allowed)
                    if (data.error && data.error === "another user is already connected") {
                        console.warn("Another client is already connected. Showing blocking modal...");
                        showConnectionLockModal(); // 🚫 Show blocking modal

                        // Retry every 3 seconds until slot is free
                        const retryInterval = setInterval(() => {
                            console.log("🔄 Retrying ESP32 connection check...");
                            const checkSocket = new WebSocket(`ws://${"192.168.1.200"}/ws`);

                            checkSocket.onopen = () => {
                                checkSocket.send("test");
                            };

                            checkSocket.onmessage = (evt) => {
                                try {
                                    const reply = JSON.parse(evt.data);
                                    if (reply.status === "ok") {
                                        console.log("✅ Connection slot now available!");
                                        clearInterval(retryInterval);
                                        hideConnectionLockModal(); // Hide modal
                                        checkSocket.close();
                                        toggleConnection(); // Reconnect automatically
                                    }
                                } catch (err) {
                                    console.error("Error checking connection:", err);
                                }
                            };

                            checkSocket.onerror = () => checkSocket.close();
                        }, 3000); // retry every 3 seconds

                        ws.close(); // Close the blocked connection
                        isConnected = false;
                        updateConnectionStatus();
                        return;
                    }

                    // ✅ Normal ESP32 data
                    if (data.temperature !== undefined) {
                        handleESP32Data(data);
                    }
                } catch (err) {
                    console.error("Invalid data from ESP32:", event.data);
                }
            };



            // When connection closes
            ws.onclose = () => {
                ws.send?.("web_disconnected"); // 🟢 Notify ESP32
                isConnected = false;
                updateConnectionStatus();
                showToast('🔌 Connection closed', 'warning');
            };

            // Handle connection errors
            ws.onerror = (err) => {
                console.error("WebSocket error:", err);
                showToast('⚠️ WebSocket connection failed', 'error');
                isConnecting = false;
                isConnected = false;
                updateConnectionStatus();
            };
        } catch (e) {
            console.error(e);
            showToast('Failed to connect to ESP32', 'error');
            isConnecting = false;
            isConnected = false;
            updateConnectionStatus();
        }
    }
}


// Dashboard functions
function updateThreshold() {
    const input = document.getElementById('threshold-input');
    currentThreshold = parseFloat(input.value);
    document.getElementById('threshold-display').textContent = currentThreshold.toFixed(1) + '°C';
}

/**
 * @brief Toggles temperature recording on and off.
 * 
 * - When recording starts: updates UI button, sends "start_record" to ESP32.
 * - When recording stops: resets button, sends "end_record" to ESP32.
 * 
 * The ESP32 will blink the 🟡 Yellow LED during active recording.
 */
function toggleRecording() {
    const btn = document.getElementById('record-btn');
    isRecording = !isRecording;

    if (isRecording) {
        // 🔴 Recording started
        btn.textContent = 'Stop Recording';
        btn.className = 'btn btn-danger';
        if (ws && ws.readyState === WebSocket.OPEN)
            ws.send("start_record"); // 🟡 Tell ESP32 to blink yellow LED
    } else {
        // 🟢 Recording stopped
        btn.textContent = 'Start Recording';
        btn.className = 'btn btn-success';
        if (ws && ws.readyState === WebSocket.OPEN)
            ws.send("end_record"); // 🟡 Stop yellow LED on ESP32
    }
}

function clearChart() {
    temperatureChart.data.labels = [];
    temperatureChart.data.datasets[0].data = [];
    temperatureChart.data.datasets[1].data = [];
    temperatureChart.update();
    temperatureData = [];
}

function saveData() {
    if (temperatureData.length === 0) {
        showToast('No data to save. Start recording first.', 'warning');
        return;
    }
    
    showToast(`Saved ${temperatureData.length} temperature readings`, 'success');
}

function exportData() {
    if (temperatureData.length === 0) {
        showToast('No data to export. Start recording first.', 'warning');
        return;
    }
    
    let csv = 'Time,Temperature (°C),Threshold (°C)\n';
    temperatureData.forEach(point => {
        csv += `${point.time},${point.temperature.toFixed(2)},${point.threshold.toFixed(2)}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `temperature_data_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showToast('Data exported successfully', 'success');
}

// DITO YUNG PART MO VER ############################################################################################################
// Database functions 

// --- Supabase Setup ---
const SUPABASE_URL = "https://ktzgfynmsnmmdvzgbjli.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0emdmeW5tc25tbWR2emdiamxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4MDczNDIsImV4cCI6MjA3NzM4MzM0Mn0.4ElVmLBwxuvoo98pxtuWbNjIxJIm9KUVc7hIAXRCPv0";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadChemicals() {
    const { data, error } = await supabase
        .from('chemicals')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error("Error loading chemicals:", error);
        showToast("Failed to load data", "error");
        return;
    }

    chemicals = data.map(row => ({
        id: row.id,
        chemName: row.chemical_name,
        formula: row.formula,
        boilingPoint: row.boiling_point ?? "-",
        freezingPoint: row.freezing_point ?? "-",
        hazardLevel: row.hazard_level ?? "Low",
        notes: row.notes ?? ""
    }));

    recordCount = chemicals.length;
    renderChemicalsTable();
}


// Render table
function renderChemicalsTable() {
    const tbody = document.getElementById('chemicals-tbody');
    tbody.innerHTML = '';

    if (chemicals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #718096; padding: 40px;">No chemicals added yet. Click "Add Chemical" to get started.</td></tr>';
        return;
    }

    chemicals.forEach(chemical => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${chemical.chemName}</td>
            <td>${chemical.formula}</td>
            <td>${chemical.boilingPoint}°C</td>
            <td>${chemical.freezingPoint}°C</td>
            <td><span class="hazard-${chemical.hazardLevel.toLowerCase()}">${chemical.hazardLevel}</span></td>
            <td>${chemical.notes || '-'}</td>
            <td>
                <button class="btn btn-primary" style="margin-right: 8px; padding: 6px 12px; font-size: 12px;" onclick="editChemical(${chemical.id})">Edit</button>
                <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="deleteChemical(${chemical.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}


function filterTable() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const rows = document.querySelectorAll('#chemicals-tbody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

function openAddModal() {
    editingChemical = null;
    document.getElementById('modal-title').textContent = 'Add Chemical';
    document.getElementById('chemical-form').reset();
    document.getElementById('chemical-modal').style.display = 'block';
}

function editChemical(id) {
    editingChemical = chemicals.find(c => c.id === id);
    if (!editingChemical) return;

    document.getElementById('modal-title').textContent = 'Edit Chemical';
    document.getElementById('chem-name').value = editingChemical.chemName;
    document.getElementById('chem-formula').value = editingChemical.formula;
    document.getElementById('boiling-point').value = editingChemical.boilingPoint;
    document.getElementById('freezing-point').value = editingChemical.freezingPoint;
    document.getElementById('hazard-level').value = editingChemical.hazardLevel;
    document.getElementById('chem-notes').value = editingChemical.notes || '';
    document.getElementById('chemical-modal').style.display = 'block';
}

async function deleteChemical(id) {
    if (!confirm("Are you sure you want to delete this chemical?")) return;

    const { error } = await supabase.from('chemicals').delete().eq('id', id);
    if (error) {
        console.error("Delete failed:", error);
        showToast("Failed to delete chemical", "error");
    } else {
        showToast("Chemical deleted successfully", "success");
        loadChemicals();
    }
}

function closeModal() {
    document.getElementById('chemical-modal').style.display = 'none';
    editingChemical = null;
}

// Form submission
document.getElementById('chemical-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const data = {
        chemical_name: document.getElementById('chem-name').value,
        formula: document.getElementById('chem-formula').value,
        boiling_point: parseFloat(document.getElementById('boiling-point').value),
        freezing_point: parseFloat(document.getElementById('freezing-point').value),
        hazard_level: document.getElementById('hazard-level').value,
        notes: document.getElementById('chem-notes').value
    };

    let result;
    if (editingChemical) {
        result = await supabase.from('chemicals').update(data).eq('id', editingChemical.id);
    } else {
        result = await supabase.from('chemicals').insert([data]);
    }

    if (result.error) {
        console.error(result.error);
        showToast("Failed to save chemical", "error");
    } else {
        showToast(editingChemical ? "Chemical updated successfully" : "Chemical added successfully", "success");
        closeModal();
        loadChemicals();
    }
});

// GANG DITO YUNG PART MO VER ############################################################################################################

// Toast notification function (stacking version)
function showToast(message, type = 'info') {
    // Create toast container if it doesn't exist
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 10000;
        `;
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        animation: slideIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        opacity: 0.95;
        min-width: 220px;
    `;

    const colors = {
        success: '#38a169',
        error: '#e53e3e',
        warning: '#d69e2e',
        info: '#4299e1'
    };

    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;

    // Add toast to container
    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            toast.remove();
            // Remove container if empty
            if (container.children.length === 0) container.remove();
        }, 300);
    }, 3000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// --- Connection Lock Modal Control ---
function showConnectionLockModal() {
    const modal = document.getElementById('connection-lock-modal');
    if (modal) {
        modal.style.display = 'flex';
        console.log("🚫 Connection lock modal shown");
    } else {
        console.error("❌ Modal element not found!");
    }
}

function hideConnectionLockModal() {
    const modal = document.getElementById('connection-lock-modal');
    if (modal) {
        modal.style.display = 'none';
        console.log("✅ Connection lock modal hidden");
    }
}


// Initialize app when page loads
document.addEventListener('DOMContentLoaded', initApp);
