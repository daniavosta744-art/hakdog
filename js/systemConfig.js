// ===================================
// SYSTEM CONFIGURATION JAVASCRIPT
// ===================================

// Firebase references
let database;
let systemRef;
let thresholdsRef;
let sensorsRef;
let smsNumbersRef;

// Current configuration state
let currentConfig = {
  wifi: {
    ssid: '',
    password: '',
    connected: false
  },
  aerator: {
    autoMode: false,
    doThreshold: 5.0,
    doStopThreshold: 6.5,
    schedules: []
  },
  sampling: {
    interval: 300 // seconds (5 minutes default)
  }
};

// In-memory list of SMS recipients (rendered in the UI)
// Each entry: { id: String, name: String, number: String }
let smsRecipients = [];
let smsIdCounter = 0;

let scheduleCounter = 0;

// -----------------------------------------------------------------------
// WiFi connection monitoring
// -----------------------------------------------------------------------
const WIFI_CONFIRM_TIMEOUT_MS = 10000; // 10 seconds
let wifiConfirmTimer = null;
let wifiStatusListener = null;

// Default thresholds
const defaultThresholds = {
  do: {
    safeMin: 5.0,
    safeMax: 9.0,
    warnMin: 4.0,
    warnMax: 10.0
  },
  temperature: {
    safeMin: 26.0,
    safeMax: 32.0,
    warnMin: 24.0,
    warnMax: 34.0
  },
  ph: {
    safeMin: 7.5,
    safeMax: 8.5,
    warnMin: 7.0,
    warnMax: 9.0
  },
  salinity: {
    safeMin: 15.0,
    safeMax: 25.0,
    warnMin: 12.0,
    warnMax: 28.0
  },
  turbidity: {
    safeMin: 20.0,
    safeMax: 50.0,
    warnMin: 10.0,
    warnMax: 70.0
  }
};

// ===================================
// INIT
// ===================================

document.addEventListener('DOMContentLoaded', function () {
  console.log('System Configuration page loaded');

  // Initialize Firebase references
  database     = firebase.database();
  systemRef    = database.ref('system');
  thresholdsRef = database.ref('thresholds');
  sensorsRef   = database.ref('sensors');
  smsNumbersRef = database.ref('alerts/sms-numbers');

  // Setup tab navigation
  setupTabs();

  // Load current configuration
  loadConfiguration();

  // Setup form handlers
  setupFormHandlers();

  // Listen for real-time updates
  listenForUpdates();

  // Update interval preview
  updateIntervalPreview();

  // Start watching ESP32 WiFi connection status immediately
  watchWifiConnectionStatus();
});

// ===================================
// TAB NAVIGATION
// ===================================

function setupTabs() {
  const tabs   = document.querySelectorAll('.config-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', function () {
      const tabName = this.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById(tabName + '-panel').classList.add('active');
    });
  });
}

// ===================================
// LOAD CONFIGURATION
// ===================================

function loadConfiguration() {
  console.log('Loading configuration from Firebase...');
  loadWiFiConfig();
  loadThresholds();
  loadAeratorConfig();
  loadSamplingConfig();
  loadSmsNumbers();
}

function loadWiFiConfig() {
  systemRef.child('wifi').once('value', (snapshot) => {
    const wifiData = snapshot.val();
    if (wifiData) {
      document.getElementById('wifiSSID').value = wifiData.ssid || '';
      currentConfig.wifi.ssid = wifiData.ssid || '';
      currentConfig.wifi.connected = wifiData.connected || false;
    }
  });
}

function loadThresholds() {
  thresholdsRef.once('value', (snapshot) => {
    const thresholds = snapshot.val() || defaultThresholds;
    console.log('Loading thresholds from Firebase:', thresholds);
    
    Object.keys(defaultThresholds).forEach(sensor => {
      const st = thresholds[sensor] || defaultThresholds[sensor];
      console.log(`Loading ${sensor} thresholds:`, st);
      
      document.getElementById(`${sensor}_safeMin`).value = st.safeMin;
      document.getElementById(`${sensor}_safeMax`).value = st.safeMax;
      document.getElementById(`${sensor}_warnMin`).value = st.warnMin;
      document.getElementById(`${sensor}_warnMax`).value = st.warnMax;
    });
  }).catch(err => {
    console.error('Error loading thresholds:', err);
    showNotification('Error loading thresholds: ' + err.message, 'error');
  });
}

function loadAeratorConfig() {
  systemRef.child('aerator').once('value', (snapshot) => {
    const aeratorData = snapshot.val();
    if (aeratorData) {
      currentConfig.aerator = aeratorData;
      const autoToggle = document.getElementById('aeratorAutoToggle');
      autoToggle.checked = aeratorData.autoMode || false;
      toggleAeratorMode(false);
      document.getElementById('aeratorDOThreshold').value     = aeratorData.doThreshold     || 5.0;
      document.getElementById('aeratorDOStopThreshold').value = aeratorData.doStopThreshold || 6.5;
      
      if (aeratorData.schedules && aeratorData.schedules.length > 0) {
        aeratorData.schedules.forEach(s => addSchedule(s.startTime, s.stopTime));
      }
    }
  });
}

function loadSamplingConfig() {
  systemRef.child('sampling').once('value', (snapshot) => {
    const samplingData = snapshot.val();
    if (samplingData && samplingData.interval) {
      const intervalSeconds = Math.floor(samplingData.interval / 1000);
      currentConfig.sampling.interval = intervalSeconds;
      
      const selectElement = document.getElementById('samplingInterval');
      const matchingOption = Array.from(selectElement.options).find(
        option => parseInt(option.value) === intervalSeconds
      );
      
      if (matchingOption) {
        selectElement.value = intervalSeconds;
        document.getElementById('customIntervalSection').style.display = 'none';
      } else {
        selectElement.value = 'custom';
        document.getElementById('customIntervalSection').style.display = 'block';
        
        const hours = Math.floor(intervalSeconds / 3600);
        const minutes = Math.floor((intervalSeconds % 3600) / 60);
        const seconds = intervalSeconds % 60;
        
        document.getElementById('customHours').value = hours;
        document.getElementById('customMinutes').value = minutes;
        document.getElementById('customSeconds').value = seconds;
      }
      
      updateIntervalPreview();
    }
  });
}

// ===================================
// SMS NUMBERS — LOAD / RENDER / SAVE
// ===================================

/**
 * Loads SMS recipients from Firebase at /alerts/sms-numbers.
 * Firebase structure: flat keys where the key IS the full +63 number.
 *   e.g. { "+63171234567": true, "+63281234567": true }
 * Names are UI-only and are NOT stored in Firebase.
 */
function loadSmsNumbers() {
  smsNumbersRef.once('value', (snapshot) => {
    smsRecipients = [];
    smsIdCounter  = 0;

    const data = snapshot.val();
    if (data) {
      Object.keys(data).forEach(fullNumber => {
        smsIdCounter++;
        smsRecipients.push({
          id:     'sms-' + smsIdCounter,
          name:   '',        // names are UI-only, not stored in Firebase
          number: fullNumber // already in +63XXXXXXXXXX format
        });
      });
    }

    renderSmsNumbers();
  }).catch(err => {
    console.error('Error loading SMS numbers:', err);
    showNotification('Error loading SMS recipients: ' + err.message, 'error');
  });
}

/**
 * Renders the smsRecipients array into the #smsNumbersList container.
 */
function renderSmsNumbers() {
  const list  = document.getElementById('smsNumbersList');
  const empty = document.getElementById('smsNumbersEmpty');

  // Clear existing entries (keep the empty placeholder element)
  list.querySelectorAll('.sms-recipient-item').forEach(el => el.remove());

  if (smsRecipients.length === 0) {
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  smsRecipients.forEach(recipient => {
    const item = document.createElement('div');
    item.className = 'sms-recipient-item';
    item.id = recipient.id;

    // number is already in +63XXXXXXXXXX format from Firebase
    const displayNumber = recipient.number.startsWith('+63') ? recipient.number : '+63' + recipient.number;
    const displayName   = recipient.name ? recipient.name : '<span class="no-name">No name</span>';

    item.innerHTML = `
      <div class="sms-recipient-info">
        <div class="sms-recipient-icon">
          <i class="fas fa-mobile-alt"></i>
        </div>
        <div class="sms-recipient-details">
          <span class="sms-recipient-name">${recipient.name ? escapeHtml(recipient.name) : '<em class="no-name">No name</em>'}</span>
          <span class="sms-recipient-number">${escapeHtml(displayNumber)}</span>
        </div>
      </div>
      <button
        type="button"
        class="sms-remove-btn"
        onclick="removeSmsNumber('${recipient.id}')"
        title="Remove recipient"
        aria-label="Remove ${escapeHtml(recipient.number)}"
      >
        <i class="fas fa-trash-alt"></i>
      </button>
    `;

    list.appendChild(item);
  });
}

/**
 * Validates and adds a new SMS recipient to the in-memory list,
 * then re-renders.
 */
function addSmsNumber() {
  const nameInput   = document.getElementById('smsRecipientName');
  const numberInput = document.getElementById('smsRecipientNumber');

  const name   = nameInput.value.trim();
  const raw    = numberInput.value.trim().replace(/\s+/g, '');

  // Validate PH mobile number: must start with 9 and be exactly 10 digits
  const phMobileRegex = /^9\d{9}$/;
  if (!raw) {
    showNotification('Please enter a mobile number.', 'error');
    numberInput.focus();
    return;
  }
  if (!phMobileRegex.test(raw)) {
    showNotification('Invalid number. Enter 10 digits starting with 9 (e.g. 9171234567).', 'error');
    numberInput.focus();
    return;
  }

  // Build full +63 key (as stored in Firebase)
  const fullNumber = '+63' + raw;

  // Check for duplicates
  const duplicate = smsRecipients.find(r => r.number === fullNumber);
  if (duplicate) {
    showNotification('This number is already in the list.', 'error');
    numberInput.focus();
    return;
  }

  // Add to list — store the full +63 number
  smsIdCounter++;
  smsRecipients.push({
    id:     'sms-' + smsIdCounter,
    name:   name,
    number: fullNumber
  });

  // Clear inputs
  nameInput.value   = '';
  numberInput.value = '';

  renderSmsNumbers();
  showNotification('Number added. Click "Save SMS Recipients" to apply.', 'info');
}

/**
 * Removes a recipient from the in-memory list by its id.
 */
function removeSmsNumber(id) {
  smsRecipients = smsRecipients.filter(r => r.id !== id);
  renderSmsNumbers();
  showNotification('Number removed. Click "Save SMS Recipients" to apply.', 'info');
}

/**
 * Saves the current smsRecipients list to Firebase at /alerts/sms-numbers.
 * Stored as an array of { name, number } objects.
 */
function saveSmsNumbers() {
  if (smsRecipients.length === 0) {
    showConfirmModal(
      'Clear All SMS Recipients?',
      'There are no numbers in the list. This will clear all existing SMS recipients from Firebase. Continue?',
      () => writeSmsToFirebase(null)
    );
    return;
  }

  showConfirmModal(
    'Save SMS Recipients?',
    `Save ${smsRecipients.length} SMS recipient${smsRecipients.length > 1 ? 's' : ''} to Firebase?`,
    () => {
      // Build an object keyed by +63 number — { "+63XXXXXXXXXX": true }
      const payload = {};
      smsRecipients.forEach(r => { payload[r.number] = true; });
      writeSmsToFirebase(payload);
    }
  );
}

function writeSmsToFirebase(payload) {
  // First remove the entire node to wipe any old nested structure (e.g. stale "numbers/0" keys),
  // then write each +63 number directly as a top-level key under sms-numbers.
  // Final structure: sms-numbers/+63XXXXXXXXXX: true
  smsNumbersRef.remove()
    .then(() => {
      if (!payload || Object.keys(payload).length === 0) {
        showNotification('SMS recipients cleared.', 'success');
        return;
      }
      return smsNumbersRef.set(payload);
    })
    .then(() => {
      if (payload && Object.keys(payload).length > 0) {
        showNotification('SMS recipients saved successfully!', 'success');
        console.log('✓ SMS numbers saved to Firebase /alerts/sms-numbers:', payload);
      }
    })
    .catch(err => {
      showNotification('Error saving SMS recipients: ' + err.message, 'error');
      console.error('✗ Error saving SMS numbers:', err);
    });
}

// Simple HTML escaper to prevent XSS in dynamic content
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===================================
// FORM HANDLERS
// ===================================

function setupFormHandlers() {
  document.getElementById('wifiForm').addEventListener('submit', saveWiFiConfig);
}

// Save WiFi Configuration
function saveWiFiConfig(e) {
  e.preventDefault();

  const ssid     = document.getElementById('wifiSSID').value.trim();
  const password = document.getElementById('wifiPassword').value;

  if (!ssid) {
    showNotification('Please enter a WiFi network name', 'error');
    return;
  }

  showConfirmModal(
    'Save WiFi Settings?',
    'Are you sure you want to save these WiFi settings? The ESP32 will restart to connect to the new network.',
    () => {
      const wifiConfig = {
        ssid:      ssid,
        password:  password || '',
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      setWifiStatusChecking('Saving… waiting for ESP32 to reconnect');

      systemRef.child('wifi').update(wifiConfig)
        .then(() => {
          showNotification('WiFi settings saved! Waiting for ESP32 to confirm connection…', 'info');
          document.getElementById('wifiPassword').value = '';
          startWifiConfirmTimeout(ssid);
        })
        .catch((error) => {
          showNotification('Error saving WiFi settings: ' + error.message, 'error');
          setWifiStatusDisconnected('Failed to save settings');
        });
    }
  );
}

// ===================================
// PASSWORD VISIBILITY TOGGLE
// ===================================

function togglePasswordVisibility() {
  const input  = document.getElementById('wifiPassword');
  const icon   = document.getElementById('passwordToggleIcon');
  const btn    = document.getElementById('passwordToggleBtn');

  const isHidden = input.type === 'password';

  if (isHidden) {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
    btn.setAttribute('aria-label', 'Hide password');
    btn.setAttribute('title', 'Hide password');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('title', 'Show password');
  }

  input.focus();
}

// ===================================
// ESP32 WIFI CONNECTION STATUS
// ===================================

function watchWifiConnectionStatus() {
  if (wifiStatusListener) {
    systemRef.child('wifi').off('value', wifiStatusListener);
  }

  wifiStatusListener = systemRef.child('wifi').on('value', (snapshot) => {
    const wifiData = snapshot.val();
    if (!wifiData) {
      setWifiStatusChecking('No WiFi data available');
      return;
    }

    const isConnected   = wifiData.connected === true;
    const connectedSSID = wifiData.ssid || '';

    if (isConnected) {
      clearWifiConfirmTimeout();
      setWifiStatusConnected(connectedSSID);
    } else {
      setWifiStatusDisconnected(
        connectedSSID
          ? `Failed to connect to "${connectedSSID}"`
          : 'ESP32 is not connected to WiFi'
      );
    }
  });
}

function startWifiConfirmTimeout(attemptedSSID) {
  clearWifiConfirmTimeout();

  wifiConfirmTimer = setTimeout(() => {
    systemRef.child('wifi/connected').once('value', (snap) => {
      const confirmed = snap.val() === true;
      if (!confirmed) {
        handleWifiConnectionFailure(attemptedSSID);
      }
    });
  }, WIFI_CONFIRM_TIMEOUT_MS);
}

function clearWifiConfirmTimeout() {
  if (wifiConfirmTimer) {
    clearTimeout(wifiConfirmTimer);
    wifiConfirmTimer = null;
  }
}

function handleWifiConnectionFailure(attemptedSSID) {
  console.warn('WiFi connection failed for SSID:', attemptedSSID, '— clearing credentials.');

  systemRef.child('wifi').update({
    ssid:      '',
    password:  '',
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  }).catch(err => console.error('Error clearing WiFi credentials:', err));

  document.getElementById('wifiSSID').value     = '';
  document.getElementById('wifiPassword').value = '';

  setWifiStatusDisconnected(`Could not connect to "${attemptedSSID}" — credentials cleared`);

  showNotification(
    `ESP32 failed to connect to "${attemptedSSID}". The SSID and password have been cleared. Please check your credentials and try again.`,
    'error'
  );
}

// ── Banner state helpers ──────────────────────────────────────────────────────

function setWifiStatusChecking(message) {
  const banner = document.getElementById('wifiConnectionStatus');
  const dot    = document.getElementById('wifiStatusDot');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className    = 'wifi-connection-status checking';
  dot.style.background = '';
  label.textContent   = message || 'Checking connection…';
  ssidEl.textContent  = '';
  badge.className     = 'wifi-status-badge';
  icon.className      = 'fas fa-circle-notch fa-spin';
  text.textContent    = 'Checking';
}

function setWifiStatusConnected(ssid) {
  const banner = document.getElementById('wifiConnectionStatus');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className   = 'wifi-connection-status connected';
  label.textContent  = 'ESP32 is connected to WiFi';
  ssidEl.textContent = ssid ? `Network: ${ssid}` : '';
  badge.className    = 'wifi-status-badge';
  icon.className     = 'fas fa-check-circle';
  text.textContent   = 'Connected';
}

function setWifiStatusDisconnected(reason) {
  const banner = document.getElementById('wifiConnectionStatus');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className   = 'wifi-connection-status disconnected';
  label.textContent  = reason || 'ESP32 is not connected to WiFi';
  ssidEl.textContent = '';
  badge.className    = 'wifi-status-badge';
  icon.className     = 'fas fa-times-circle';
  text.textContent   = 'Disconnected';
}

// ===================================
// MODAL & NOTIFICATION FUNCTIONS
// ===================================

function showConfirmModal(title, message, onConfirm) {
  const modal      = document.getElementById('confirmModal');
  const modalTitle = document.getElementById('confirmModalTitle');
  const modalMsg   = document.getElementById('confirmModalMessage');
  const cancelBtn  = document.getElementById('confirmModalCancelBtn');
  const confirmBtn = document.getElementById('confirmModalConfirmBtn');
  
  if (!modal) return;
  
  modalTitle.textContent = title;
  modalMsg.innerHTML     = message;
  
  modal.classList.add('show');
  modal.style.display = 'flex';
  
  const newCancelBtn  = cancelBtn.cloneNode(true);
  const newConfirmBtn = confirmBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  newCancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 150);
  });
  
  const clickOutsideHandler = (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 150);
      modal.removeEventListener('click', clickOutsideHandler);
    }
  };
  modal.addEventListener('click', clickOutsideHandler);
  
  newConfirmBtn.addEventListener('click', async () => {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 150);
    modal.removeEventListener('click', clickOutsideHandler);
    await onConfirm();
  });
}

function showNotification(message, type = 'success') {
  const notification = document.getElementById('statusNotification');
  const icon         = document.getElementById('statusNotificationIcon');
  const text         = document.getElementById('statusNotificationText');
  
  if (!notification || !icon || !text) return;
  
  const iconClass = type === 'success' ? 'fa-check-circle'
                  : type === 'error'   ? 'fa-exclamation-circle'
                  : 'fa-info-circle';
  
  icon.className = `fas ${iconClass}`;
  notification.className = `status-notification ${type}`;
  text.textContent = message;
  
  notification.style.display = 'flex';
  setTimeout(() => notification.classList.add('show'), 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.style.display = 'none', 300);
  }, 5000);
}

// ===================================
// SAVE / RESET FUNCTIONS
// ===================================

function saveThresholds() {
  console.log('saveThresholds() called');
  
  const thresholds = {};

  for (const sensor of Object.keys(defaultThresholds)) {
    const safeMinEl = document.getElementById(`${sensor}_safeMin`);
    const safeMaxEl = document.getElementById(`${sensor}_safeMax`);
    const warnMinEl = document.getElementById(`${sensor}_warnMin`);
    const warnMaxEl = document.getElementById(`${sensor}_warnMax`);
    
    if (!safeMinEl || !safeMaxEl || !warnMinEl || !warnMaxEl) {
      showNotification(`Error: Could not find input fields for ${sensor}`, 'error');
      return;
    }

    const safeMin = parseFloat(safeMinEl.value);
    const safeMax = parseFloat(safeMaxEl.value);
    const warnMin = parseFloat(warnMinEl.value);
    const warnMax = parseFloat(warnMaxEl.value);

    if (isNaN(safeMin) || isNaN(safeMax) || isNaN(warnMin) || isNaN(warnMax)) {
      showNotification(`Invalid ${sensor} thresholds: All values must be numbers`, 'error');
      return;
    }

    if (safeMin >= safeMax) {
      showNotification(`Invalid ${sensor} thresholds: Safe Min must be less than Safe Max`, 'error');
      return;
    }
    if (warnMin >= warnMax) {
      showNotification(`Invalid ${sensor} thresholds: Warning Min must be less than Warning Max`, 'error');
      return;
    }

    thresholds[sensor] = { safeMin, safeMax, warnMin, warnMax };
  }

  showConfirmModal(
    'Save Sensor Thresholds?',
    'Are you sure you want to save all sensor threshold changes?',
    () => {
      thresholdsRef.update(thresholds)
        .then(() => {
          showNotification('All sensor thresholds saved successfully!', 'success');
          console.log('✓ Thresholds saved to Firebase:', thresholds);
        })
        .catch(err => {
          showNotification('Error saving thresholds: ' + err.message, 'error');
          console.error('✗ Error saving thresholds:', err);
        });
    }
  );
}

function resetThresholds() {
  showConfirmModal(
    'Reset to Default Values?',
    'Are you sure you want to reset all thresholds to default values?',
    () => {
      Object.keys(defaultThresholds).forEach(sensor => {
        const d = defaultThresholds[sensor];
        document.getElementById(`${sensor}_safeMin`).value = d.safeMin;
        document.getElementById(`${sensor}_safeMax`).value = d.safeMax;
        document.getElementById(`${sensor}_warnMin`).value = d.warnMin;
        document.getElementById(`${sensor}_warnMax`).value = d.warnMax;
      });

      showNotification('Thresholds reset to default values. Click "Save" to apply.', 'info');
    }
  );
}

function toggleAeratorMode(saveToFirebase) {
  const autoToggle    = document.getElementById('aeratorAutoToggle');
  const autoSettings  = document.getElementById('aeratorAutoSettings');
  const manualControl = document.getElementById('aeratorManualControl');
  const modeLabel     = document.getElementById('aeratorModeLabel');
  const modeDesc      = document.getElementById('aeratorModeDescription');

  const isAutoMode = autoToggle.checked;

  if (isAutoMode) {
    autoSettings.style.display  = 'block';
    manualControl.style.display = 'none';
    modeLabel.textContent = 'Automatic Mode';
    modeDesc.textContent  = 'Aerator is controlled automatically based on DO levels and schedule';
  } else {
    autoSettings.style.display  = 'none';
    manualControl.style.display = 'block';
    modeLabel.textContent = 'Manual Mode';
    modeDesc.textContent  = 'Aerator is controlled manually';
  }

  if (saveToFirebase === true) {
    systemRef.child('aerator/autoMode').set(isAutoMode)
      .then(() => {
        currentConfig.aerator.autoMode = isAutoMode;
        showNotification(
          `Aerator mode changed to ${isAutoMode ? 'Automatic' : 'Manual'}`,
          'success'
        );
      })
      .catch(err => {
        showNotification('Error saving aerator mode: ' + err.message, 'error');
        autoToggle.checked = !isAutoMode;
      });
  }
}

/**
 * Called when the manual aerator toggle is flipped.
 * Writes true/false to /system/aerator/manual in Firebase immediately — no confirm needed.
 */
function setAeratorManual() {
  const toggle = document.getElementById('aeratorManualToggle');
  const isOn   = toggle.checked;

  systemRef.child('aerator/manual').set(isOn)
    .then(() => {
      showNotification(`Aerator turned ${isOn ? 'ON' : 'OFF'}`, 'success');
      console.log(`✓ aerator/manual set to ${isOn}`);
    })
    .catch(err => {
      showNotification('Error updating aerator: ' + err.message, 'error');
      // Revert toggle on failure
      toggle.checked = !isOn;
    });
}

function saveAeratorConfig() {
  const autoMode        = document.getElementById('aeratorAutoToggle').checked;
  const doThreshold     = parseFloat(document.getElementById('aeratorDOThreshold').value);
  const doStopThreshold = parseFloat(document.getElementById('aeratorDOStopThreshold').value);

  if (autoMode && doThreshold >= doStopThreshold) {
    showNotification('Stop threshold must be higher than start threshold', 'error');
    return;
  }

  const schedules = [];
  document.querySelectorAll('.schedule-item').forEach(item => {
    const startTime = item.querySelector('.schedule-start').value;
    const stopTime  = item.querySelector('.schedule-stop').value;
    if (startTime && stopTime) schedules.push({ startTime, stopTime });
  });

  showConfirmModal(
    'Save Aerator Configuration?',
    'Are you sure you want to save the aerator configuration changes?',
    () => {
      const aeratorConfig = {
        autoMode,
        doThreshold,
        doStopThreshold,
        schedules,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      systemRef.child('aerator').set(aeratorConfig)
        .then(() => {
          currentConfig.aerator = aeratorConfig;
          showNotification('Aerator configuration saved successfully!', 'success');
        })
        .catch(err => showNotification('Error saving aerator configuration: ' + err.message, 'error'));
    }
  );
}

function addSchedule(startTime = '06:00', stopTime = '18:00') {
  scheduleCounter++;
  const container   = document.getElementById('scheduleContainer');
  const scheduleDiv = document.createElement('div');
  scheduleDiv.className = 'schedule-item';
  scheduleDiv.id = `schedule-${scheduleCounter}`;

  scheduleDiv.innerHTML = `
    <div class="schedule-item-header">Schedule #${scheduleCounter}</div>
    <div style="display:flex;gap:12px;align-items:flex-end;width:100%;">
      <div class="form-group" style="flex:1;margin:0;">
        <label>Start Time</label>
        <input type="time" class="schedule-start" value="${startTime}">
      </div>
      <div class="form-group" style="flex:1;margin:0;">
        <label>Stop Time</label>
        <input type="time" class="schedule-stop" value="${stopTime}">
      </div>
      <button type="button" class="btn-remove" onclick="removeSchedule(${scheduleCounter})">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;

  container.appendChild(scheduleDiv);
}

function removeSchedule(id) {
  const el = document.getElementById(`schedule-${id}`);
  if (el) el.remove();
}

function saveSamplingInterval() {
  let intervalSeconds;
  
  const selectedValue = document.getElementById('samplingInterval').value;
  
  if (selectedValue === 'custom') {
    const hours   = parseInt(document.getElementById('customHours').value)   || 0;
    const minutes = parseInt(document.getElementById('customMinutes').value) || 0;
    const seconds = parseInt(document.getElementById('customSeconds').value) || 0;
    
    intervalSeconds = (hours * 3600) + (minutes * 60) + seconds;
    
    if (intervalSeconds < 1) {
      showNotification('Sampling interval must be at least 1 second', 'error');
      return;
    }
    if (intervalSeconds > 86400) {
      showNotification('Sampling interval cannot exceed 24 hours', 'error');
      return;
    }
  } else {
    intervalSeconds = parseInt(selectedValue);
  }

  showConfirmModal(
    'Save Sampling Interval?',
    'Are you sure you want to save the sampling interval changes?',
    () => {
      const intervalMilliseconds = intervalSeconds * 1000;

      const samplingConfig = {
        interval:  intervalMilliseconds,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      systemRef.child('sampling').set(samplingConfig)
        .then(() => {
          currentConfig.sampling.interval = intervalSeconds;
          showNotification('Sampling interval saved successfully!', 'success');
          updateIntervalPreview();
        })
        .catch(err => showNotification('Error saving sampling interval: ' + err.message, 'error'));
    }
  );
}

function updateIntervalPreview() {
  const selectedValue = document.getElementById('samplingInterval').value;
  const preview       = document.getElementById('samplingIntervalPreview');
  
  let intervalSeconds;
  
  if (selectedValue === 'custom') {
    const hours   = parseInt(document.getElementById('customHours').value)   || 0;
    const minutes = parseInt(document.getElementById('customMinutes').value) || 0;
    const seconds = parseInt(document.getElementById('customSeconds').value) || 0;
    intervalSeconds = (hours * 3600) + (minutes * 60) + seconds;
  } else {
    intervalSeconds = parseInt(selectedValue);
  }
  
  const hours   = Math.floor(intervalSeconds / 3600);
  const minutes = Math.floor((intervalSeconds % 3600) / 60);
  const seconds = intervalSeconds % 60;
  
  let timeText = '';
  if (hours   > 0) timeText += hours   + ' hour'   + (hours   > 1 ? 's' : '');
  if (minutes > 0) { if (timeText) timeText += ', '; timeText += minutes + ' minute' + (minutes > 1 ? 's' : ''); }
  if (seconds > 0 || !timeText) { if (timeText) timeText += ', '; timeText += seconds + ' second' + (seconds > 1 ? 's' : ''); }

  preview.textContent = `Data will be recorded every ${timeText}`;
}

function toggleCustomInterval() {
  const selectedValue = document.getElementById('samplingInterval').value;
  const customSection = document.getElementById('customIntervalSection');
  customSection.style.display = selectedValue === 'custom' ? 'block' : 'none';
  updateIntervalPreview();
}

// ===================================
// REAL-TIME UPDATES
// ===================================

function listenForUpdates() {
  systemRef.on('value', () => {
    console.log('System configuration updated');
  });

  // Real-time listener for /system/aerator/manual so the toggle always reflects live state
  systemRef.child('aerator/manual').on('value', (snapshot) => {
    const isOn = snapshot.val() === true;
    const toggle = document.getElementById('aeratorManualToggle');
    const icon   = document.getElementById('aeratorManualIcon');
    const text   = document.getElementById('aeratorManualStatusText');
    if (!toggle) return;
    toggle.checked = isOn;
    if (isOn) {
      icon.style.color  = '#10b981';
      text.textContent  = 'Aerator is ON';
    } else {
      icon.style.color  = '';
      text.textContent  = 'Aerator is OFF';
    }
  });
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

function formatTimestamp(timestamp) {
  if (!timestamp) return '--';
  const date      = new Date(timestamp);
  const diffMs    = Date.now() - date;
  const diffMins  = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays  = Math.floor(diffMs / 86400000);

  if (diffMins  < 1)  return 'Just now';
  if (diffMins  < 60) return `${diffMins} min${diffMins  > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays  < 7)  return `${diffDays} day${diffDays  > 1 ? 's' : ''} ago`;
  return date.toLocaleString();
}

console.log('System Configuration script loaded successfully');

// ===================================
// DEBUG / TEST FUNCTIONS
// ===================================

function testFirebaseWrite() {
  console.log('Testing Firebase write access...');
  thresholdsRef.child('_test').set({ testWrite: true, timestamp: firebase.database.ServerValue.TIMESTAMP })
    .then(() => {
      console.log('✓ Firebase write test SUCCESSFUL');
      return thresholdsRef.child('_test').remove();
    })
    .then(() => console.log('✓ Test data cleaned up'))
    .catch(err => console.error('✗ Firebase write test FAILED:', err));
}

function debugThresholdInputs() {
  console.log('=== Current Threshold Input Values ===');
  Object.keys(defaultThresholds).forEach(sensor => {
    console.log(`${sensor}:`, {
      safeMin: document.getElementById(`${sensor}_safeMin`)?.value,
      safeMax: document.getElementById(`${sensor}_safeMax`)?.value,
      warnMin: document.getElementById(`${sensor}_warnMin`)?.value,
      warnMax: document.getElementById(`${sensor}_warnMax`)?.value
    });
  });
}

window.testFirebaseWrite     = testFirebaseWrite;
window.debugThresholdInputs  = debugThresholdInputs;