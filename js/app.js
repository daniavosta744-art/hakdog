// app.js - Dashboard Logic and Firebase Data

console.log("app.js loading - checking DOM elements");

// =========================
// DOM ELEMENTS
// =========================
const tempEl = document.getElementById("temp");
const phEl = document.getElementById("ph");
const salinityEl = document.getElementById("salinity");
const turbidityEl = document.getElementById("turbidity");
const doEl = document.getElementById("do");

const espEl = document.getElementById("espStatus");
const batteryEl = document.getElementById("battery");
const aeratorEl = document.getElementById("aeratorStatusText");
const lastUpdateEl = document.getElementById("lastUpdate");

console.log("DOM Elements found:", {
  tempEl: !!tempEl,
  phEl: !!phEl,
  salinityEl: !!salinityEl,
  turbidityEl: !!turbidityEl,
  doEl: !!doEl,
  espEl: !!espEl,
  batteryEl: !!batteryEl,
  aeratorEl: !!aeratorEl,
  lastUpdateEl: !!lastUpdateEl
});

// =========================
// CHECK DATABASE
// =========================
if (typeof window.database === 'undefined') {
  console.error("Firebase database not initialized!");
  // Fallback: Use mock data for testing navigation
  useMockDataForNavigation();
} else {
  console.log("Firebase database initialized successfully");
}

// =========================
// MOCK DATA FOR NAVIGATION TESTING
// =========================
function useMockDataForNavigation() {
  console.log("Using mock data for dashboard");
  
  const mockData = {
    temp: 28.5,
    ph: 7.2,
    salinity: 32.8,
    turbidity: 3.5,
    do: 6.8,
    battery: 85,
    aerator: "ON",
    lastUpdate: new Date().toLocaleTimeString()
  };
  
  // Update dashboard with mock data
  setTimeout(() => {
    if (tempEl) {
      tempEl.textContent = mockData.temp.toFixed(1);
      tempEl.className = "safe";
    }
    if (phEl) {
      phEl.textContent = mockData.ph.toFixed(2);
      phEl.className = "safe";
    }
    if (salinityEl) {
      salinityEl.textContent = mockData.salinity.toFixed(1);
      salinityEl.className = "safe";
    }
    if (turbidityEl) {
      turbidityEl.textContent = mockData.turbidity.toFixed(1);
      turbidityEl.className = "caution";
    }
    if (doEl) {
      doEl.textContent = mockData.do.toFixed(1);
      doEl.className = "safe";
    }
    if (batteryEl) {
      batteryEl.textContent = mockData.battery + "%";
      updateBatteryColor(mockData.battery);
    }
    if (aeratorEl) {
      aeratorEl.textContent = mockData.aerator;
      aeratorEl.style.color = mockData.aerator === "ON" ? "#22c55e" : "#ef4444";
    }
    if (lastUpdateEl) {
      lastUpdateEl.textContent = mockData.lastUpdate;
    }
    if (espEl) {
      espEl.classList.add("online");
      espEl.classList.remove("offline");
    }
  }, 500);
}

// =========================
// LOAD THRESHOLDS (GLOBAL)
// =========================
window.thresholds = null;
if (typeof window.database !== 'undefined') {
  window.database.ref("thresholds").on("value", snapshot => {
    window.thresholds = snapshot.val();
    console.log("Thresholds loaded:", window.thresholds);
  });
}

// =========================
// SENSOR DATA
// =========================
if (typeof window.database !== 'undefined') {
  window.database.ref("sensors").on("value", snapshot => {
    const data = snapshot.val();
    console.log("Sensor data received:", data);

    if (!data) {
      console.warn("No sensor data found in Firebase");
      return;
    }

    if (tempEl) {
      tempEl.textContent = data.temperature !== undefined ? data.temperature.toFixed(1) : "--";
      const statusClass = getStatusClass(data.temperature, window.thresholds?.temperature);
      tempEl.className = statusClass;
      setStatusText('tempStatus', statusClass);
    }

    if (phEl) {
      phEl.textContent = data.ph !== undefined ? data.ph.toFixed(2) : "--";
      const statusClass = getStatusClass(data.ph, window.thresholds?.ph);
      phEl.className = statusClass;
      setStatusText('phStatus', statusClass);
    }

    if (salinityEl) {
      salinityEl.textContent = data.salinity !== undefined ? data.salinity.toFixed(1) : "--";
      const statusClass = getStatusClass(data.salinity, window.thresholds?.salinity);
      salinityEl.className = statusClass;
      setStatusText('salinityStatus', statusClass);
    }

    if (turbidityEl) {
      turbidityEl.textContent = data.turbidity !== undefined ? data.turbidity.toFixed(1) : "--";
      const statusClass = getStatusClass(data.turbidity, window.thresholds?.turbidity);
      turbidityEl.className = statusClass;
      setStatusText('turbidityStatus', statusClass);
    }

    if (doEl) {
      doEl.textContent = data.do !== undefined ? data.do.toFixed(1) : "--";
      const statusClass = getStatusClass(data.do, window.thresholds?.do);
      doEl.className = statusClass;
      setStatusText('doStatus', statusClass);
    }

    // Update last update time from sensor data
    if (lastUpdateEl && data.lastUpdate) {
      const date = new Date(data.lastUpdate);
      lastUpdateEl.textContent = date.toLocaleString();
    } else if (lastUpdateEl) {
      lastUpdateEl.textContent = new Date().toLocaleTimeString();
    }
  });
}

// =========================
// SYSTEM STATUS
// =========================
if (typeof window.database !== 'undefined') {
  window.database.ref("system").on("value", snapshot => {
    const system = snapshot.val();
    console.log("System data received:", system);

    if (!system) {
      console.warn("No system data found in Firebase");
      return;
    }

    // ESP32 status
    if (espEl) {
      if (system.esp32Online) {
        espEl.classList.add("online");
        espEl.classList.remove("offline");
      } else {
        espEl.classList.add("offline");
        espEl.classList.remove("online");
      }
    }

    // Battery percentage
    if (batteryEl && system.battery !== undefined) {
      batteryEl.textContent = system.battery + "%";
      updateBatteryColor(system.battery);
    }

    // Aerator status
    if (aeratorEl && system.aerator !== undefined) {
      aeratorEl.textContent = system.aerator ? "ON" : "OFF";
      aeratorEl.style.color = system.aerator ? "#22c55e" : "#ef4444";
    }
  });
}

// =========================
// HELPER FUNCTION
// =========================
function getStatusClass(value, threshold) {
  if (!threshold || value === undefined) return "unknown";
  
  // CRITICAL
  if (value < threshold.warnMin || value > threshold.warnMax) {
    return "critical";
  }
  
  // CAUTION
  if (value < threshold.safeMin || value > threshold.safeMax) {
    return "caution";
  }
  
  // SAFE
  return "safe";
}

// Set the status text below a metric card
function setStatusText(elementId, statusClass) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const mapping = { safe: 'Safe', caution: 'Warning', critical: 'Critical', unknown: '--' };
  el.textContent = mapping[statusClass] || '--';
  // Update class for color styling; apply fixed width pill by default
  el.className = 'status-text ' + (statusClass || 'unknown') + ' fixed';
}

// =========================
// BATTERY COLOR UPDATE
// =========================
function updateBatteryColor(percentage) {
  const batteryIndicator = document.getElementById('batteryIndicator');
  if (!batteryIndicator) return;
  
  const batteryIcon = batteryIndicator.querySelector('i');
  if (!batteryIcon) return;
  
  // Remove existing battery classes
  batteryIndicator.classList.remove('low');
  
  // Update icon based on percentage
  if (percentage > 75) {
    batteryIcon.className = 'fas fa-battery-full';
  } else if (percentage > 50) {
    batteryIcon.className = 'fas fa-battery-three-quarters';
  } else if (percentage > 25) {
    batteryIcon.className = 'fas fa-battery-half';
  } else if (percentage > 10) {
    batteryIcon.className = 'fas fa-battery-quarter';
  } else {
    batteryIcon.className = 'fas fa-battery-empty';
    batteryIndicator.classList.add('low');
  }
}

// =========================
// ROLE-BASED MENU VISIBILITY
// =========================
function hideMenuItemsForRole() {
  console.log("Checking user role for menu visibility...");
  
  // Get current user session
  const userSession = localStorage.getItem('userSession');
  let isGuest = false;
  let isAdmin = false;
  
  if (userSession) {
    try {
      const session = JSON.parse(userSession);
      isGuest = session.isGuest === true;
      isAdmin = session.role === 'admin';
      console.log("🎭 User is guest:", isGuest);
      console.log("👑 User is admin:", isAdmin);
    } catch (error) {
      console.error("Error parsing session:", error);
    }
  }
  
  // Menu items to hide for guests
  const guestHideItems = [
    'historyTab',      // Monitor
    'alertsTab',       // Alerts
    'reportsTab',      // Reports
    'userSystemTab'    // User & System
  ];
  
  // Hide restricted items for guests
  if (isGuest) {
    console.log("🎭 Hiding restricted menu items for guest...");
    guestHideItems.forEach(itemId => {
      const element = document.getElementById(itemId);
      if (element) {
        element.style.display = 'none';
        console.log(`  Hidden: ${itemId}`);
      }
    });
    // Hide admin dashboard for guests
    const adminDashboard = document.getElementById('adminDashboardTab');
    if (adminDashboard) {
      adminDashboard.style.display = 'none';
    }
  } else {
    console.log("✅ User is authenticated, showing appropriate menu items");
    guestHideItems.forEach(itemId => {
      const element = document.getElementById(itemId);
      if (element) {
        element.style.display = '';
      }
    });
  }
  
  // Show admin dashboard only for admins
  const adminDashboardTab = document.getElementById('adminDashboardTab');
  if (adminDashboardTab) {
    if (isAdmin) {
      console.log("👑 Showing admin dashboard menu for admin user");
      adminDashboardTab.style.display = '';
    } else {
      console.log("Hiding admin dashboard menu for non-admin user");
      adminDashboardTab.style.display = 'none';
    }
  }
}

// =========================
// DOM READY
// =========================
document.addEventListener("DOMContentLoaded", () => {
  console.log("app.js DOM ready");

  // Hide menu items based on role
  hideMenuItemsForRole();

  // Add card click handlers for visual feedback
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    card.onclick = null;
    
    card.addEventListener('click', function(e) {
      console.log(`Card clicked: ${this.querySelector('h3').textContent}`);
      this.style.transform = 'scale(0.98)';
      setTimeout(() => {
        this.style.transform = '';
      }, 150);
    });
  });

  console.log("✅ app.js fully loaded");
});