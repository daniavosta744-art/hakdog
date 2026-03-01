// ========================================
// ALERTS PAGE JAVASCRIPT - FIXED VERSION
// ========================================

// Global variables
let activeAlerts = [];
let historyAlerts = [];
let currentTab = 'active';
let thresholds = {};
let alertsListenersSetup = false; // Flag to prevent duplicate listeners

// Initialize alerts page
document.addEventListener('DOMContentLoaded', function() {
  initializeAlertsPage();
  setupDateFilters();
});

// Initialize the alerts page
function initializeAlertsPage() {
  // Check Firebase availability
  if (typeof firebase === 'undefined' || !firebase.database) {
    console.error('Firebase is required for this application');
    showFirebaseError();
    return;
  }
  
  // Load thresholds first, then alerts.
  // CRITICAL: setupRealtimeAlertListeners() is called INSIDE loadActiveAlerts()
  // after once('value') completes — so activeAlerts is fully populated before
  // any sensor threshold checks run. Calling it here in parallel was the bug.
  loadThresholds().then(() => {
    loadActiveAlerts(); // calls setupRealtimeAlertListeners() internally when ready
    loadHistoryAlerts();
  }).catch(error => {
    console.error('Failed to load thresholds:', error);
    showFirebaseError();
  });
}

// Show Firebase error message
function showFirebaseError() {
  const alertsList = document.getElementById('activeAlertsList');
  const historyList = document.getElementById('historyAlertsList');
  
  const errorMessage = `
    <div class="no-alerts">
      <i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i>
      <p>Firebase Connection Required</p>
      <span>Please ensure Firebase is properly configured and connected</span>
    </div>
  `;
  
  if (alertsList) alertsList.innerHTML = errorMessage;
  if (historyList) historyList.innerHTML = errorMessage;
}

// Load thresholds from Firebase
function loadThresholds() {
  return new Promise((resolve, reject) => {
    const thresholdsRef = firebase.database().ref('thresholds');
    
    thresholdsRef.once('value')
      .then((snapshot) => {
        if (snapshot.exists()) {
          thresholds = snapshot.val();
          resolve();
        } else {
          console.error('No thresholds found in Firebase');
          reject('No thresholds configured');
        }
      })
      .catch((error) => {
        console.error('Error loading thresholds:', error);
        reject(error);
      });
  });
}

// Switch between tabs
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  const tabButtons = document.querySelectorAll('.alerts-tab-btn');
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update tab content
  const activeTabContent = document.getElementById('activeTab');
  const historyTabContent = document.getElementById('alertsHistoryTab');
  
  if (tabName === 'active') {
    if (activeTabContent) {
      activeTabContent.classList.add('active');
      activeTabContent.style.display = 'block';
    }
    if (historyTabContent) {
      historyTabContent.classList.remove('active');
      historyTabContent.style.display = 'none';
    }
  } else if (tabName === 'alertsHistory') {
    if (activeTabContent) {
      activeTabContent.classList.remove('active');
      activeTabContent.style.display = 'none';
    }
    if (historyTabContent) {
      historyTabContent.classList.add('active');
      historyTabContent.style.display = 'block';
    }
    displayHistoryAlerts();
  }
}

// ========================================
// FIXED SECTION - Load active alerts from Firebase
// ========================================
function loadActiveAlerts() {
  // Prevent setting up listeners multiple times
  if (alertsListenersSetup) {
    return;
  }
  alertsListenersSetup = true;

  const alertsRef = firebase.database().ref('alerts/active');

  // STEP 1: Load all existing alerts first with once('value').
  // We collect their IDs into a Set so child_added can skip them.
  alertsRef.once('value', (snapshot) => {
    const alertsList = document.getElementById('activeAlertsList');
    if (!alertsList) return;

    activeAlerts = [];
    const preloadedIds = new Set(); // <-- tracks IDs already loaded

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const alert = {
          id: childSnapshot.key,
          ...childSnapshot.val()
        };
        activeAlerts.push(alert);
        preloadedIds.add(childSnapshot.key); // mark as already loaded
      });

      if (activeAlerts.length > 0) {
        alertsList.innerHTML = activeAlerts.map(alert => createAlertCard(alert, true)).join('');
        const acknowledgeBtn = document.getElementById('acknowledgeAllBtn');
        if (acknowledgeBtn) acknowledgeBtn.disabled = false;
      } else {
        showNoActiveAlerts(alertsList);
      }
    } else {
      showNoActiveAlerts(alertsList);
    }

    updateActiveAlertsCount();

    // STEP 2: Attach child_added/changed/removed listeners.
    // child_added fires for all existing nodes first — we skip them via preloadedIds.
    setupActiveAlertsListeners(preloadedIds);

    // STEP 3: Only NOW start the sensor threshold listener.
    // activeAlerts is fully populated here, so createOrUpdateAlert() can correctly
    // find existing alerts and update instead of creating duplicates.
    setupRealtimeAlertListeners();
  });
}

// ========================================
// FIXED SECTION - Setup real-time listeners for active alerts
// ========================================
function setupActiveAlertsListeners(preloadedIds) {
  const alertsRef = firebase.database().ref('alerts/active');

  // child_added fires for every existing node first, then for new ones.
  // We skip existing ones using the preloadedIds Set.
  alertsRef.on('child_added', (snapshot) => {
    const id = snapshot.key;

    // Skip nodes that were already loaded by once('value')
    if (preloadedIds.has(id)) {
      preloadedIds.delete(id); // clean up to allow re-use if the same key is re-added
      return;
    }

    const alert = {
      id,
      ...snapshot.val()
    };

    // Extra guard: skip if somehow already in our array
    if (activeAlerts.find(a => a.id === id)) {
      return;
    }

    activeAlerts.push(alert);
    addAlertCard(alert);
    updateActiveAlertsCount();
  });

  // Listen for updated alerts
  alertsRef.on('child_changed', (snapshot) => {
    const updatedAlert = {
      id: snapshot.key,
      ...snapshot.val()
    };

    const index = activeAlerts.findIndex(a => a.id === updatedAlert.id);
    if (index !== -1) {
      activeAlerts[index] = updatedAlert;
      updateAlertCard(updatedAlert);
    }
  });

  // Listen for removed alerts
  alertsRef.on('child_removed', (snapshot) => {
    const removedId = snapshot.key;
    activeAlerts = activeAlerts.filter(a => a.id !== removedId);
    removeAlertCard(removedId);
    updateActiveAlertsCount();
  });
}
// ========================================
// END OF FIXED SECTION
// ========================================

// Helper: show empty state
function showNoActiveAlerts(alertsList) {
  alertsList.innerHTML = `
    <div class="no-alerts">
      <i class="fas fa-check-circle"></i>
      <p>No active alerts at this time</p>
      <span>Your pond water quality is within normal parameters</span>
    </div>
  `;
  const acknowledgeBtn = document.getElementById('acknowledgeAllBtn');
  if (acknowledgeBtn) acknowledgeBtn.disabled = true;
}

// Add a new alert card to the DOM
function addAlertCard(alert) {
  const alertsList = document.getElementById('activeAlertsList');
  if (!alertsList) return;
  
  // Remove "no alerts" message if it exists
  const noAlerts = alertsList.querySelector('.no-alerts');
  if (noAlerts) {
    noAlerts.remove();
  }
  
  // Create and insert the new card
  const cardHTML = createAlertCard(alert, true);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = cardHTML;
  const card = tempDiv.firstElementChild;
  
  // Add with animation
  card.style.opacity = '0';
  card.style.transform = 'translateY(-10px)';
  alertsList.insertBefore(card, alertsList.firstChild);
  
  // Trigger animation
  setTimeout(() => {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  }, 10);
  
  // Enable acknowledge all button
  const acknowledgeBtn = document.getElementById('acknowledgeAllBtn');
  if (acknowledgeBtn) acknowledgeBtn.disabled = false;
}

// Update a specific alert card without full re-render
function updateAlertCard(alert) {
  const card = document.querySelector(`[data-alert-id="${alert.id}"]`);
  if (!card) return;
  
  const severity = alert.severity || 'warning';
  const value = alert.value || '--';
  const threshold = alert.threshold || '--';
  const timestamp = formatTimestamp(alert.timestamp);
  const unit = getParameterUnit(alert.parameter);
  
  // Update card class if severity changed
  const oldSeverity = card.className.match(/alert-card (warning|critical)/)?.[1];
  if (oldSeverity && oldSeverity !== severity) {
    card.classList.remove(oldSeverity);
    card.classList.add(severity);
    
    card.style.animation = 'pulse 0.5s ease-in-out';
    setTimeout(() => {
      card.style.animation = '';
    }, 500);
  }
  
  // Update severity badge
  const severityBadge = card.querySelector('.alert-severity-badge');
  if (severityBadge) {
    severityBadge.className = `alert-severity-badge ${severity}`;
    severityBadge.textContent = severity;
  }
  
  // Update value with highlight effect
  const valueElements = card.querySelectorAll('.alert-info-value');
  if (valueElements[0]) {
    valueElements[0].className = `alert-info-value ${severity}-value`;
    valueElements[0].style.transition = 'background-color 0.3s ease';
    valueElements[0].style.backgroundColor = 'rgba(14, 165, 233, 0.2)';
    valueElements[0].textContent = `${value} ${unit}`;
    
    setTimeout(() => {
      valueElements[0].style.backgroundColor = '';
    }, 300);
  }
  
  if (valueElements[1]) {
    valueElements[1].textContent = `${threshold} ${unit}`;
  }
  
  if (valueElements[2]) {
    valueElements[2].textContent = severity.charAt(0).toUpperCase() + severity.slice(1);
  }
  
  const timestampElement = card.querySelector('.alert-timestamp');
  if (timestampElement) {
    timestampElement.innerHTML = `<i class="fas fa-clock"></i> ${timestamp}`;
  }
  
  const messageElement = card.querySelector('.alert-title');
  if (messageElement && alert.message) {
    messageElement.textContent = alert.message;
  }
}

// Remove an alert card from the DOM
function removeAlertCard(alertId) {
  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (!card) return;
  
  card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  
  setTimeout(() => {
    card.remove();
    
    const alertsList = document.getElementById('activeAlertsList');
    if (alertsList && activeAlerts.length === 0) {
      showNoActiveAlerts(alertsList);
    }
  }, 300);
}

// Load history alerts from Firebase
function loadHistoryAlerts() {
  const historyRef = firebase.database().ref('alerts/history');
  
  historyRef.orderByChild('timestamp').limitToLast(100).on('value', (snapshot) => {
    historyAlerts = [];
    
    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const alert = {
          id: childSnapshot.key,
          ...childSnapshot.val()
        };
        historyAlerts.push(alert);
      });
      
      historyAlerts.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    displayHistoryAlerts();
  }, (error) => {
    console.error('Error loading history alerts:', error);
  });
}

// Display history alerts
function displayHistoryAlerts() {
  const historyList = document.getElementById('historyAlertsList');
  
  if (!historyList) {
    console.error('History alerts list element not found');
    return;
  }
  
  const filteredHistory = filterHistoryAlerts();
  
  if (filteredHistory.length === 0) {
    historyList.innerHTML = `
      <div class="no-alerts">
        <i class="fas fa-inbox"></i>
        <p>No alert history available</p>
        <span>Past alerts will appear here once they are acknowledged or resolved</span>
      </div>
    `;
    return;
  }
  
  historyList.innerHTML = filteredHistory.map(alert => createAlertCard(alert, false)).join('');
}

// Create alert card HTML
function createAlertCard(alert, isActive) {
  const severity = alert.severity || 'warning';
  const parameter = alert.parameter || 'Unknown';
  const value = alert.value || '--';
  const threshold = alert.threshold || '--';
  const timestamp = formatTimestamp(alert.timestamp);
  const icon = getParameterIcon(parameter);
  const unit = getParameterUnit(parameter);
  
  let statusBadge = '';
  if (!isActive) {
    if (alert.dismissed) {
      statusBadge = '<span class="alert-severity-badge dismissed">Dismissed</span>';
    } else if (alert.acknowledged) {
      statusBadge = '<span class="alert-severity-badge resolved">Acknowledged</span>';
    } else if (alert.autoResolved) {
      statusBadge = '<span class="alert-severity-badge auto-resolved">Auto-Resolved</span>';
    }
  } else {
    statusBadge = `<span class="alert-severity-badge ${severity}">${severity}</span>`;
  }
  
  // For history cards: determine action label and when it happened
  let actionLabel = '';
  let actionTime = '';
  if (!isActive) {
    if (alert.dismissed) {
      actionLabel = '<i class="fas fa-times-circle"></i> Dismissed';
      actionTime = formatTimestamp(alert.dismissedAt);
    } else if (alert.autoResolved) {
      actionLabel = '<i class="fas fa-magic"></i> Auto-Resolved';
      actionTime = formatTimestamp(alert.acknowledgedAt);
    } else if (alert.acknowledged) {
      actionLabel = '<i class="fas fa-check-circle"></i> Acknowledged';
      actionTime = formatTimestamp(alert.acknowledgedAt);
    }
  }

  // Active cards show Acknowledge / Dismiss buttons in the footer
  const footerActions = isActive ? `
      <div class="alert-actions">
        <button class="alert-btn alert-btn-acknowledge" onclick="acknowledgeAlert('${alert.id}')">
          <i class="fas fa-check"></i> Acknowledge
        </button>
        <button class="alert-btn alert-btn-dismiss" onclick="dismissAlert('${alert.id}')">
          <i class="fas fa-times"></i> Dismiss
        </button>
      </div>` : '';

  // History cards show Action as an info row inside the card body
  const actionRow = !isActive ? `
        <div class="alert-info-item">
          <span class="alert-info-label">Action</span>
          <span class="alert-info-value">${actionLabel} <span class="action-timestamp">${actionTime}</span></span>
        </div>` : '';

  const cardClass = !isActive && (alert.acknowledged || alert.dismissed || alert.autoResolved) ? 'resolved' : severity;

  return `
    <div class="alert-card ${cardClass}" data-alert-id="${alert.id}">
      <div class="alert-header">
        <div class="alert-title-group">
          <div class="alert-icon">
            <i class="${icon}"></i>
          </div>
          <div class="alert-title-text">
            <h3 class="alert-title">${alert.message || `${parameter} ${severity.toUpperCase()}`}</h3>
            <p class="alert-parameter">${parameter.toUpperCase()}</p>
          </div>
        </div>
        ${statusBadge}
      </div>
      
      <div class="alert-body">
        <div class="alert-info-item">
          <span class="alert-info-label">Current Value</span>
          <span class="alert-info-value ${severity}-value">${value} ${unit}</span>
        </div>
        <div class="alert-info-item">
          <span class="alert-info-label">Threshold</span>
          <span class="alert-info-value">${threshold} ${unit}</span>
        </div>
        <div class="alert-info-item">
          <span class="alert-info-label">Severity</span>
          <span class="alert-info-value">${severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
        </div>
        ${actionRow}
      </div>
      
      <div class="alert-footer">
        <div class="alert-timestamp">
          <i class="fas fa-clock"></i>
          ${timestamp}
        </div>
        ${footerActions}
      </div>
    </div>
  `;
}

// Get parameter icon
function getParameterIcon(parameter) {
  const icons = {
    'do': 'fas fa-wind',
    'temperature': 'fas fa-thermometer-half',
    'salinity': 'fas fa-tint',
    'turbidity': 'fas fa-eye',
    'ph': 'fas fa-flask'
  };
  return icons[parameter.toLowerCase()] || 'fas fa-exclamation-triangle';
}

// Get parameter unit
function getParameterUnit(parameter) {
  const units = {
    'do': 'mg/L',
    'temperature': '°C',
    'salinity': 'ppt',
    'turbidity': 'NTU',
    'ph': ''
  };
  return units[parameter.toLowerCase()] || '';
}

// Format timestamp
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) {
    return 'Just now';
  }
  
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  
  const options = { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return date.toLocaleDateString('en-US', options);
}

// Filter active alerts
function filterActiveAlerts() {
  const severityFilter = document.getElementById('severityFilter');
  const parameterFilter = document.getElementById('parameterFilter');
  
  const severity = severityFilter ? severityFilter.value : 'all';
  const parameter = parameterFilter ? parameterFilter.value : 'all';
  
  return activeAlerts.filter(alert => {
    const matchesSeverity = severity === 'all' || alert.severity === severity;
    const matchesParameter = parameter === 'all' || alert.parameter === parameter;
    return matchesSeverity && matchesParameter;
  });
}

// Filter history alerts
function filterHistoryAlerts() {
  const dateFromFilter = document.getElementById('dateFromFilter');
  const dateToFilter = document.getElementById('dateToFilter');
  const severityFilter = document.getElementById('historySeverityFilter');
  const parameterFilter = document.getElementById('historyParameterFilter');
  
  const dateFrom = dateFromFilter ? dateFromFilter.value : '';
  const dateTo = dateToFilter ? dateToFilter.value : '';
  const severity = severityFilter ? severityFilter.value : 'all';
  const parameter = parameterFilter ? parameterFilter.value : 'all';
  
  return historyAlerts.filter(alert => {
    if (dateFrom) {
      const fromDate = new Date(dateFrom).setHours(0, 0, 0, 0);
      if (alert.timestamp < fromDate) return false;
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo).setHours(23, 59, 59, 999);
      if (alert.timestamp > toDate) return false;
    }
    
    if (severity !== 'all' && alert.severity !== severity) return false;
    if (parameter !== 'all' && alert.parameter !== parameter) return false;
    
    return true;
  });
}

// Apply filters
function filterAlerts() {
  displayActiveAlerts();
}

function filterHistory() {
  displayHistoryAlerts();
}

// Display active alerts (used when filters are applied)
function displayActiveAlerts() {
  const alertsList = document.getElementById('activeAlertsList');
  
  if (!alertsList) {
    console.error('Active alerts list element not found');
    return;
  }
  
  const filteredAlerts = filterActiveAlerts();
  
  if (filteredAlerts.length === 0) {
    showNoActiveAlerts(alertsList);
    return;
  }
  
  const acknowledgeBtn = document.getElementById('acknowledgeAllBtn');
  if (acknowledgeBtn) acknowledgeBtn.disabled = false;
  
  alertsList.innerHTML = filteredAlerts.map(alert => createAlertCard(alert, true)).join('');
}

// Acknowledge single alert
function acknowledgeAlert(alertId) {
  const alert = activeAlerts.find(a => a.id === alertId);
  if (!alert) {
    console.error('Alert not found:', alertId);
    return;
  }
  
  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (card) {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
  }
  
  const historyData = {
    parameter: alert.parameter,
    value: alert.value,
    threshold: alert.threshold,
    severity: alert.severity,
    message: alert.message,
    timestamp: alert.timestamp,
    acknowledged: true,
    acknowledgedAt: Date.now()
  };
  
  const historyRef = firebase.database().ref('alerts/history').push();
  historyRef.set(historyData)
    .then(() => {
      return firebase.database().ref('alerts/active/' + alertId).remove();
    })
    .catch(error => {
      console.error('Error acknowledging alert:', error);
      if (card) {
        card.style.opacity = '1';
        card.style.transform = 'translateX(0)';
      }
      alert('Failed to acknowledge alert. Please try again.');
    });
}

// Dismiss alert
function dismissAlert(alertId) {
  if (!confirm('Are you sure you want to dismiss this alert without acknowledging it?')) {
    return;
  }
  
  const alert = activeAlerts.find(a => a.id === alertId);
  if (!alert) {
    console.error('Alert not found:', alertId);
    return;
  }
  
  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (card) {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateX(-20px)';
  }
  
  const historyData = {
    parameter: alert.parameter,
    value: alert.value,
    threshold: alert.threshold,
    severity: alert.severity,
    message: alert.message,
    timestamp: alert.timestamp,
    acknowledged: false,
    dismissed: true,
    dismissedAt: Date.now()
  };
  
  const historyRef = firebase.database().ref('alerts/history').push();
  historyRef.set(historyData)
    .then(() => {
      return firebase.database().ref('alerts/active/' + alertId).remove();
    })
    .catch(error => {
      console.error('Error dismissing alert:', error);
      if (card) {
        card.style.opacity = '1';
        card.style.transform = 'translateX(0)';
      }
      alert('Failed to dismiss alert. Please try again.');
    });
}

// Acknowledge all alerts
function acknowledgeAll() {
  if (activeAlerts.length === 0) return;
  
  if (!confirm(`Are you sure you want to acknowledge all ${activeAlerts.length} active alerts?`)) {
    return;
  }
  
  const acknowledgedTime = Date.now();
  const promises = [];
  
  const cards = document.querySelectorAll('.alert-card');
  cards.forEach(card => {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
  });
  
  activeAlerts.forEach(alert => {
    const historyData = {
      parameter: alert.parameter,
      value: alert.value,
      threshold: alert.threshold,
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp,
      acknowledged: true,
      acknowledgedAt: acknowledgedTime
    };
    
    const historyRef = firebase.database().ref('alerts/history').push();
    promises.push(historyRef.set(historyData));
    promises.push(firebase.database().ref('alerts/active/' + alert.id).remove());
  });
  
  Promise.all(promises)
    .then(() => {
      console.log('All alerts acknowledged successfully');
    })
    .catch(error => {
      console.error('Error acknowledging all alerts:', error);
      cards.forEach(card => {
        card.style.opacity = '1';
        card.style.transform = 'scale(1)';
      });
      alert('Failed to acknowledge all alerts. Please try again.');
    });
}

// Export history to CSV
function exportHistory() {
  const filteredHistory = filterHistoryAlerts();
  
  if (filteredHistory.length === 0) {
    alert('No alerts to export');
    return;
  }
  
  const headers = ['Timestamp', 'Parameter', 'Severity', 'Value', 'Threshold', 'Action'];
  const rows = filteredHistory.map(alert => {
    let action = 'Unknown';
    if (alert.autoResolved) action = 'Auto-Resolved';
    else if (alert.acknowledged) action = 'Acknowledged';
    else if (alert.dismissed) action = 'Dismissed';
    return [
      new Date(alert.timestamp).toLocaleString(),
      alert.parameter,
      alert.severity,
      alert.value,
      alert.threshold,
      action
    ];
  });
  
  let csvContent = headers.join(',') + '\n';
  rows.forEach(row => {
    csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alerts_history_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// Setup date filters with default values
function setupDateFilters() {
  const today = new Date();
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const dateToFilter = document.getElementById('dateToFilter');
  const dateFromFilter = document.getElementById('dateFromFilter');
  
  if (dateToFilter) {
    dateToFilter.value = today.toISOString().split('T')[0];
  }
  
  if (dateFromFilter) {
    dateFromFilter.value = oneWeekAgo.toISOString().split('T')[0];
  }
}

// Update active alerts count badge
function updateActiveAlertsCount() {
  const count = activeAlerts.length;
  const badge = document.getElementById('activeAlertsCount');
  
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

// Setup real-time alert listeners
function setupRealtimeAlertListeners() {
  const sensorsRef = firebase.database().ref('sensors');
  let lastCheckTime = Date.now();
  let previousReadings = {};
  
  sensorsRef.on('value', (snapshot) => {
    if (snapshot.exists()) {
      const sensorData = snapshot.val();
      
      let lastUpdate = 0;
      if (sensorData.lastUpdate) {
        if (typeof sensorData.lastUpdate === 'string') {
          lastUpdate = new Date(sensorData.lastUpdate).getTime();
        } else {
          lastUpdate = sensorData.lastUpdate;
        }
      }
      
      if (lastUpdate > lastCheckTime) {
        const hasChanges = checkIfValuesChanged(sensorData, previousReadings);
        
        if (hasChanges) {
          checkThresholds(sensorData);
          previousReadings = { ...sensorData };
        }
        
        lastCheckTime = lastUpdate;
      }
    }
  });
}

// Check if sensor values have changed
function checkIfValuesChanged(newData, oldData) {
  if (Object.keys(oldData).length === 0) {
    return true;
  }
  
  const parameters = ['do', 'temperature', 'salinity', 'turbidity', 'ph'];
  
  for (const param of parameters) {
    const newValue = newData[param];
    const oldValue = oldData[param];
    
    if (newValue !== undefined && oldValue !== undefined) {
      if (Math.abs(newValue - oldValue) > 0.01) {
        return true;
      }
    }
  }
  
  return false;
}

// Check sensor values against thresholds
function checkThresholds(sensorData) {
  if (!sensorData || Object.keys(thresholds).length === 0) {
    return;
  }
  
  Object.keys(thresholds).forEach(param => {
    const value = sensorData[param];
    if (value === undefined || value === null) return;
    
    const threshold = thresholds[param];
    if (!threshold) return;
    
    let severity = null;
    let thresholdValue = '';
    let message = '';
    
    if (value < threshold.warnMin) {
      severity = 'critical';
      thresholdValue = `Critical Min: ${threshold.warnMin}`;
      message = `${param.toUpperCase()} critically low - below critical minimum`;
    } else if (value > threshold.warnMax) {
      severity = 'critical';
      thresholdValue = `Critical Max: ${threshold.warnMax}`;
      message = `${param.toUpperCase()} critically high - above critical maximum`;
    } else if (value >= threshold.warnMin && value < threshold.safeMin) {
      severity = 'warning';
      thresholdValue = `Warning Range: ${threshold.warnMin}-${threshold.safeMin}`;
      message = `${param.toUpperCase()} in warning zone (below safe minimum)`;
    } else if (value > threshold.safeMax && value <= threshold.warnMax) {
      severity = 'warning';
      thresholdValue = `Warning Range: ${threshold.safeMax}-${threshold.warnMax}`;
      message = `${param.toUpperCase()} in warning zone (above safe maximum)`;
    }
    
    if (severity) {
      createOrUpdateAlert(param, value, thresholdValue, severity, message);
    } else {
      autoResolveAlert(param);
    }
  });
}

// Create or update alert (prevents duplicates)
function createOrUpdateAlert(parameter, value, threshold, severity, message) {
  const existingAlert = activeAlerts.find(a => a.parameter === parameter);
  
  if (existingAlert) {
    const severityChanged = existingAlert.severity !== severity;
    
    const alertRef = firebase.database().ref('alerts/active/' + existingAlert.id);
    alertRef.update({
      value: typeof value === 'number' ? value.toFixed(2) : value,
      threshold: threshold,
      severity: severity,
      message: message,
      timestamp: Date.now()
    });
    
    if (severityChanged) {
      console.log(`Alert severity changed for ${parameter}: ${existingAlert.severity} → ${severity}`);
    }
    
    return;
  }
  
  const alertRef = firebase.database().ref('alerts/active').push();
  const alert = {
    parameter: parameter,
    value: typeof value === 'number' ? value.toFixed(2) : value,
    threshold: threshold,
    severity: severity,
    message: message,
    timestamp: Date.now()
  };
  
  alertRef.set(alert);
}

// Auto-resolve alerts when values return to normal
function autoResolveAlert(parameter) {
  const activeAlert = activeAlerts.find(a => a.parameter === parameter);
  
  if (activeAlert) {
    const historyData = {
      parameter: activeAlert.parameter,
      value: activeAlert.value,
      threshold: activeAlert.threshold,
      severity: activeAlert.severity,
      message: activeAlert.message,
      timestamp: activeAlert.timestamp,
      acknowledged: true,
      acknowledgedAt: Date.now(),
      autoResolved: true,
      resolvedMessage: 'Parameter returned to normal range'
    };
    
    const historyRef = firebase.database().ref('alerts/history').push();
    historyRef.set(historyData)
      .then(() => {
        return firebase.database().ref('alerts/active/' + activeAlert.id).remove();
      });
  }
}

console.log('Alerts.js (FIXED VERSION) loaded successfully');