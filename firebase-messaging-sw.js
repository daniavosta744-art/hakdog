  // ========================================
  // FIREBASE MESSAGING SERVICE WORKER
  // Bangus Pond Water Quality Monitor
  // ========================================
  // IMPORTANT: This file MUST be placed at the ROOT of your website
  // e.g. if your site is at https://yoursite.com, this file must be at
  // https://yoursite.com/firebase-messaging-sw.js
  // ========================================
  // Import Firebase scripts for service worker

  importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
  importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

  // Firebase config — must match your firebase.js
  firebase.initializeApp({
  apiKey: "AIzaSyBLahiL7WFpeDmoWV3ZlRCg288Shwxw_EE",
  authDomain: "prototypefishda.firebaseapp.com",
  databaseURL: "https://prototypefishda-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "prototypefishda",
  storageBucket: "prototypefishda.appspot.com",
  messagingSenderId: "452322894750",
  appId: "1:452322894750:web:4d10904fb4b320c261ac8f"
  });

  const messaging = firebase.messaging();

  // ── BACKGROUND MESSAGE HANDLER ────────────────────────────────────────────────
  // This fires when a notification arrives and the browser tab is in the background
  // or completely closed. It shows the notification manually.
  messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const { title, body, icon } = payload.notification || {};

    const notificationTitle = title || 'Bangus Pond Alert';
    const notificationOptions = {
      body:  body  || 'A water quality alert has been triggered.',
      icon:  icon  || '../images/gataw.png',
      badge: '../images/gataw.png',
      tag:   'bangus-pond-alert', // replaces previous notification instead of stacking
      renotify: true,             // vibrate/sound even if tag matches
      requireInteraction: false,  // auto-dismiss (user just closes it)
      data: {
        url: '/html/alerts.html'  // stored but not used for click (per your request)
      }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });

  // ── NOTIFICATION CLICK HANDLER ───────────────────────────────────────────────
  // Per your request: clicking the notification just dismisses it
  self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // just dismiss
  });

  console.log('[SW] firebase-messaging-sw.js loaded.');