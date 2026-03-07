// ========================================
// NOTIFICATIONS.JS
// Bangus Pond Water Quality Monitor
// ========================================
// HOW IT WORKS:
//   1. Called after login for Admin and User roles only (not guest)
//   2. Requests browser notification permission
//   3. Generates FCM token for this browser
//   4. Saves token to Firebase under fcmTokens/{uid}
//   5. Token is used by Render (smsAlerts.js) to send push notifications
// ========================================

const VAPID_KEY = 'BGfXhraSo7Sp8_jc-v7cJLsHTT0_aTpTu3TLygrGm-oh4lY6pxsAohqPhZW44FT5pBkOuISm7Ympw7cm1HTfnZE';

// ── INIT ──────────────────────────────────────────────────────────────────────
/**
 * Call this after a user/admin logs in.
 * Handles the full permission → token → save flow.
 *
 * @param {string} uid - The Firebase Auth user ID
 */
async function initPushNotifications(uid) {
  try {
    // Only proceed if Firebase Messaging is available
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      console.warn('[Notifications] Firebase Messaging not available.');
      return;
    }

    // Check if browser supports notifications
    if (!('Notification' in window)) {
      console.warn('[Notifications] This browser does not support notifications.');
      return;
    }

    // Check if service worker is supported
    if (!('serviceWorker' in navigator)) {
      console.warn('[Notifications] Service workers not supported in this browser.');
      return;
    }

    console.log('[Notifications] Initializing push notifications for uid:', uid);

    // Register the service worker
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    console.log('[Notifications] Service worker registered:', registration);

    // Initialize Firebase Messaging
    const messaging = firebase.messaging();

    // Check current permission status
    const currentPermission = Notification.permission;
    console.log('[Notifications] Current permission status:', currentPermission);

    if (currentPermission === 'denied') {
      console.warn('[Notifications] User has previously denied notifications.');
      _showNotificationBanner('denied');
      return;
    }

    if (currentPermission === 'granted') {
      // Already granted — just refresh the token silently
      console.log('[Notifications] Permission already granted, refreshing token...');
      await _getAndSaveToken(messaging, uid);
      return;
    }

    // Permission is 'default' — show the browser prompt
    // Small delay so it doesn't pop up instantly on login
    setTimeout(async () => {
      try {
        console.log('[Notifications] Requesting notification permission...');
        const permission = await Notification.requestPermission();

        if (permission === 'granted') {
          console.log('[Notifications] ✅ Permission granted!');
          await _getAndSaveToken(messaging, uid);
          _showNotificationBanner('granted');
        } else {
          console.log('[Notifications] ❌ Permission denied by user.');
          _showNotificationBanner('denied');
        }
      } catch (error) {
        console.error('[Notifications] Error requesting permission:', error);
      }
    }, 2000); // 2 second delay after login

  } catch (error) {
    console.error('[Notifications] Initialization error:', error);
  }
}

// ── TOKEN MANAGEMENT ──────────────────────────────────────────────────────────
/**
 * Get the FCM token for this browser and save it to Firebase.
 */
async function _getAndSaveToken(messaging, uid) {
  try {
    const token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready
    });

    if (token) {
      console.log('[Notifications] FCM token obtained:', token.substring(0, 20) + '...');
      await _saveTokenToFirebase(uid, token);
    } else {
      console.warn('[Notifications] No token received — permission may not be granted.');
    }
  } catch (error) {
    console.error('[Notifications] Error getting FCM token:', error);
  }
}

/**
 * Save the FCM token to Firebase under fcmTokens/{uid}/{tokenHash}
 * Using tokenHash as key prevents duplicate tokens for same browser.
 */
async function _saveTokenToFirebase(uid, token) {
  try {
    const tokenData = {
      token:     token,
      uid:       uid,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      userAgent: navigator.userAgent.substring(0, 100), // for debugging
    };

    // Use a sanitized version of the token as the key (last 20 chars = unique enough)
    const tokenKey = token.slice(-20).replace(/[.#$[\]]/g, '_');

    await firebase.database()
      .ref(`fcmTokens/${uid}/${tokenKey}`)
      .set(tokenData);

    console.log('[Notifications] ✅ Token saved to Firebase for uid:', uid);
  } catch (error) {
    console.error('[Notifications] Error saving token to Firebase:', error);
  }
}

/**
 * Remove this browser's token from Firebase on logout.
 * Call this before auth.signOut().
 */
async function removePushToken(uid) {
  try {
    if (typeof firebase === 'undefined' || !firebase.messaging) return;

    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY });

    if (token) {
      const tokenKey = token.slice(-20).replace(/[.#$[\]]/g, '_');
      await firebase.database().ref(`fcmTokens/${uid}/${tokenKey}`).remove();
      await messaging.deleteToken();
      console.log('[Notifications] Token removed on logout.');
    }
  } catch (error) {
    console.warn('[Notifications] Could not remove token on logout:', error);
  }
}

// ── FOREGROUND MESSAGE HANDLER ────────────────────────────────────────────────
/**
 * Handle notifications when the app is in the FOREGROUND (tab is open/visible).
 * Firebase doesn't show a popup automatically when the tab is active,
 * so we show a custom in-page toast notification.
 */
function setupForegroundNotifications() {
  try {
    if (typeof firebase === 'undefined' || !firebase.messaging) return;

    const messaging = firebase.messaging();

    messaging.onMessage((payload) => {
      console.log('[Notifications] Foreground message received:', payload);

      const title = payload.notification?.title || 'Bangus Pond Alert';
      const body  = payload.notification?.body  || 'A water quality alert has been triggered.';

      _showToastNotification(title, body);
    });

    console.log('[Notifications] Foreground message handler set up.');
  } catch (error) {
    console.warn('[Notifications] Could not set up foreground handler:', error);
  }
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
/**
 * Show a small in-page toast when tab is active (foreground notifications).
 */
function _showToastNotification(title, body) {
  // Remove existing toast if any
  const existing = document.getElementById('fcm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'fcm-toast';
  toast.innerHTML = `
    <div class="fcm-toast-icon">🔔</div>
    <div class="fcm-toast-content">
      <div class="fcm-toast-title">${title}</div>
      <div class="fcm-toast-body">${body}</div>
    </div>
    <button class="fcm-toast-close" onclick="this.parentElement.remove()">✕</button>
  `;

  // Inline styles so it works without any CSS changes
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 99999;
    background: #1e293b;
    color: #f1f5f9;
    border-left: 4px solid #e74c3c;
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    max-width: 360px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease;
    font-family: Inter, sans-serif;
    font-size: 14px;
  `;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    .fcm-toast-title  { font-weight: 600; margin-bottom: 4px; }
    .fcm-toast-body   { opacity: 0.85; line-height: 1.4; }
    .fcm-toast-icon   { font-size: 20px; margin-top: 2px; }
    .fcm-toast-close  {
      background: none; border: none; color: #94a3b8;
      cursor: pointer; font-size: 16px; margin-left: auto;
      padding: 0; line-height: 1;
    }
    .fcm-toast-close:hover { color: #f1f5f9; }
    .fcm-toast-content { flex: 1; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(120%)';
      setTimeout(() => toast.remove(), 400);
    }
  }, 8000);
}

/**
 * Show a small banner below the header indicating notification status.
 */
function _showNotificationBanner(status) {
  const existing = document.getElementById('notification-banner');
  if (existing) existing.remove();

  if (status === 'granted') {
    // Don't show banner if already granted — no need to bother the user
    return;
  }

  if (status === 'denied') {
    const banner = document.createElement('div');
    banner.id = 'notification-banner';
    banner.innerHTML = `
      <i class="fas fa-bell-slash"></i>
      Notifications are blocked. Enable them in your browser settings to receive pond alerts.
      <button onclick="this.parentElement.remove()" style="margin-left:12px; background:none; border:none; color:inherit; cursor:pointer; font-size:16px;">✕</button>
    `;
    banner.style.cssText = `
      background: #7f1d1d;
      color: #fecaca;
      padding: 10px 20px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
      position: sticky;
      top: 0;
      z-index: 1000;
    `;
    // Insert after the top status bar
    const content = document.querySelector('.content');
    if (content) content.insertBefore(banner, content.firstChild);
  }
}


console.log('[Notifications] notifications.js loaded.');
