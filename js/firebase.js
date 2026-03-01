// js/firebase.js

console.log("firebase.js loading...");

var firebaseConfig = {
  apiKey: "AIzaSyBLahiL7WFpeDmoWV3ZlRCg288Shwxw_EE",
  authDomain: "prototypefishda.firebaseapp.com",
  databaseURL: "https://prototypefishda-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "prototypefishda",
  storageBucket: "prototypefishda.appspot.com",
  messagingSenderId: "452322894750",
  appId: "1:452322894750:web:4d10904fb4b320c261ac8f"
};

// Check if Firebase SDK is loaded
if (typeof firebase === 'undefined') {
  console.error("Firebase SDK not loaded!");
} else {
  console.log("Firebase SDK loaded successfully");
}

// Prevent duplicate initialization
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
  console.log("Firebase initialized");
} else {
  console.log("Firebase already initialized");
}

// Initialize Realtime Database reference
try {
  const database = firebase.database();
  console.log("Database reference created");
  window.database = database;
} catch (error) {
  console.error("Error creating database reference:", error);
}

// Initialize Firebase Messaging
try {
  if ('serviceWorker' in navigator && typeof firebase.messaging === 'function') {
    window.firebaseMessaging = firebase.messaging();
    console.log("Firebase Messaging initialized");
  } else if (!('serviceWorker' in navigator)) {
    console.warn("Service workers not supported — push notifications unavailable");
  } else {
    console.warn("Firebase Messaging SDK not loaded — add firebase-messaging.js before firebase.js");
  }
} catch (error) {
  console.warn("Firebase Messaging could not be initialized:", error.message);
}