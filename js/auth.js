// auth.js - Authentication and User Management for Dashboard (WITH ROLE DISPLAY + PUSH NOTIFICATIONS)

console.log("auth.js loading...");

document.addEventListener('DOMContentLoaded', function() {
  console.log("Auth DOM loaded");
  
  // Check if Firebase is loaded
  if (typeof firebase === 'undefined') {
    console.error("Firebase is not loaded!");
    redirectToLogin();
    return;
  }

  // Initialize Firebase Auth
  const auth = firebase.auth();
  const database = firebase.database();
  
  // DOM Elements
  const logoutBtn = document.getElementById('logoutBtn');
  const userEmailDisplay = document.getElementById('userEmail');
  const dropdownUserName = document.getElementById('dropdownUserName');
  const dropdownUserEmail = document.getElementById('dropdownUserEmail');
  const dropdownUserRole = document.getElementById('dropdownUserRole');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  let currentUser = null;

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  
  function showLoading(text = 'Loading...') {
    if (loadingText) loadingText.textContent = text;
    if (loadingOverlay) loadingOverlay.classList.add('active');
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.remove('active');
  }

  function redirectToLogin() {
    console.log("🔄 Redirecting to login...");
    localStorage.removeItem('userSession');
    window.location.href = '../index.html';
  }

  function capitalizeRole(role) {
    if (!role) return 'User';
    
    const roleMap = {
      'guest': 'Guest',
      'user': 'User',
      'admin': 'Admin',
      'moderator': 'Moderator',
      'staff': 'Staff'
    };
    
    return roleMap[role.toLowerCase()] || role.charAt(0).toUpperCase() + role.slice(1);
  }

  function displayUserInfo(email, role = 'user', isGuest = false) {
    if (userEmailDisplay) {
      if (isGuest) {
        userEmailDisplay.textContent = 'Guest User';
        userEmailDisplay.title = 'Logged in as guest';
        
        if (dropdownUserName) dropdownUserName.textContent = 'Guest User';
        if (dropdownUserEmail) dropdownUserEmail.textContent = 'guest@fishda.local';
        if (dropdownUserRole) dropdownUserRole.textContent = capitalizeRole('guest');
        
        console.log("✅ Guest user display updated");
      } else {
        const username = email.split('@')[0];
        
        userEmailDisplay.textContent = username;
        userEmailDisplay.title = email;
        
        if (dropdownUserName) dropdownUserName.textContent = username;
        if (dropdownUserEmail) dropdownUserEmail.textContent = email;
        if (dropdownUserRole) dropdownUserRole.textContent = capitalizeRole(role);
        
        console.log("✅ User display updated:", email, "Role:", role);
      }
    }
  }

  async function updateLastLogin(uid) {
    try {
      await database.ref('users/' + uid).update({
        lastLogin: firebase.database.ServerValue.TIMESTAMP
      });
      console.log("✅ Last login timestamp updated");
    } catch (error) {
      console.error("❌ Error updating last login:", error);
    }
  }

  async function loadUserData(uid) {
    try {
      const snapshot = await database.ref('users/' + uid).once('value');
      const userData = snapshot.val();
      
      if (userData) {
        console.log("✅ User data loaded from database");
        return userData;
      } else {
        console.warn("⚠️ No user data found in database");
        return null;
      }
    } catch (error) {
      console.error("❌ Error loading user data:", error);
      return null;
    }
  }

  // ============================================
  // AUTH STATE MANAGEMENT (WITH ROLE DISPLAY)
  // ============================================
  
  auth.onAuthStateChanged(async (user) => {
    console.log("🔄 Auth state changed");
    
    if (user) {
      console.log("✅ User signed in:", user.uid);
      console.log("   Is anonymous:", user.isAnonymous);
      
      // ── GUEST USER ──────────────────────────────────────────────────────────
      // Guests do NOT get push notifications
      if (user.isAnonymous) {
        console.log("👤 Guest user detected");
        
        currentUser = user;
        displayUserInfo('guest@fishda.local', 'guest', true);
        
        const userSession = localStorage.getItem('userSession');
        if (!userSession) {
          console.log("⚠️ No guest session found, creating one");
          localStorage.setItem('userSession', JSON.stringify({
            uid: user.uid,
            username: 'Guest User',
            email: 'guest@fishda.local',
            role: 'guest',
            isLoggedIn: true,
            isGuest: true,
            timestamp: new Date().toISOString()
          }));
        }
        
        // Hide loading overlay
        hideLoading();
        
        console.log("🎉 Guest authenticated and dashboard ready");
        return; // Stop here for guests — no push notifications
      }
      
      // ── REGULAR USER / ADMIN ────────────────────────────────────────────────
      console.log("👤 Regular user detected:", user.email);
      
      // Check if email is verified
      if (!user.emailVerified) {
        console.warn("⚠️ User email not verified");
        hideLoading();
        alert('Please verify your email before accessing the dashboard.');
        await auth.signOut();
        redirectToLogin();
        return;
      }
      
      // User is authenticated and verified
      currentUser = user;
      
      // Load user data to get role
      const userData = await loadUserData(user.uid);
      const userRole = userData?.role || 'user';
      
      // Display user info with role
      displayUserInfo(user.email, userRole, false);
      
      // Update last login timestamp
      await updateLastLogin(user.uid);
      
      // Update session storage with user data
      localStorage.setItem('userSession', JSON.stringify({
        uid: user.uid,
        username: userData?.username || user.email.split('@')[0],
        email: user.email,
        role: userRole,
        isLoggedIn: true,
        isGuest: false,
        timestamp: new Date().toISOString()
      }));

      // ── PUSH NOTIFICATIONS ────────────────────────────────────────────────
      // Only for admin and user roles — userRole is fully defined here
      if (userRole === 'admin' || userRole === 'user') {
        if (typeof initPushNotifications === 'function') {
          initPushNotifications(user.uid);
          console.log("🔔 Push notifications initialized for role:", userRole);
        } else {
          console.warn("⚠️ initPushNotifications not found — is notifications.js loaded?");
        }
      }

      // Set up foreground notification handler (shows toast when tab is active)
      if (typeof setupForegroundNotifications === 'function') {
        setupForegroundNotifications();
      }
      // ── END PUSH NOTIFICATIONS ────────────────────────────────────────────
      
      // Hide loading overlay
      hideLoading();
      
      console.log("🎉 User authenticated and dashboard ready");
      
    } else {
      // No user is signed in
      console.log("❌ No user signed in - redirecting to login");
      redirectToLogin();
    }
  });

  // ============================================
  // LOGOUT FUNCTIONALITY
  // ============================================
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      
      console.log("🚪 Logout button clicked");
      
      // Close the profile dropdown
      if (typeof closeProfileDropdown === 'function') {
        closeProfileDropdown();
      }
      
      // Check if user is guest
      const userSession = localStorage.getItem('userSession');
      let isGuest = false;
      
      if (userSession) {
        try {
          const session = JSON.parse(userSession);
          isGuest = session.isGuest === true;
        } catch (error) {
          console.error("Error parsing session:", error);
        }
      }
      
      // Show confirmation dialog (skip for guests)
      const confirmLogout = isGuest ? true : confirm('Are you sure you want to logout?');
      
      if (!confirmLogout) {
        console.log("Logout cancelled by user");
        return;
      }
      
      showLoading('Logging out...');
      
      try {
        // Remove FCM token BEFORE signing out so this browser
        // stops receiving push notifications after logout
        if (typeof removePushToken === 'function' && currentUser && !isGuest) {
          console.log("🔔 Removing push token on logout...");
          await removePushToken(currentUser.uid);
        }

        // Sign out from Firebase
        await auth.signOut();
        console.log("✅ User signed out successfully");
        
        // Clear session storage
        localStorage.removeItem('userSession');
        sessionStorage.clear();
        
        console.log("✅ Session cleared");
        
        // Redirect to login page
        setTimeout(() => {
          redirectToLogin();
        }, 500);
        
      } catch (error) {
        console.error("❌ Logout error:", error);
        hideLoading();
        alert('Error logging out: ' + error.message);
      }
    });
  } else {
    console.warn("⚠️ Logout button not found in DOM");
  }

  // ============================================
  // PAGE VISIBILITY - SECURITY
  // ============================================
  
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !currentUser) {
      console.log("⚠️ Page visible but no user - redirecting");
      redirectToLogin();
    }
  });

  // ============================================
  // SESSION TIMEOUT (DISABLED FOR GUESTS)
  // ============================================
  
  let inactivityTimer;
  const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 hour

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    
    const userSession = localStorage.getItem('userSession');
    if (userSession) {
      try {
        const session = JSON.parse(userSession);
        if (session.isGuest) {
          return; // Guests don't timeout
        }
      } catch (error) {
        console.error("Error checking guest status:", error);
      }
    }
    
    inactivityTimer = setTimeout(() => {
      console.log("⏰ Session timeout due to inactivity");
      alert('Your session has expired due to inactivity. Please login again.');
      auth.signOut().then(() => {
        redirectToLogin();
      });
    }, INACTIVITY_TIMEOUT);
  }

  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer, true);
  });

  resetInactivityTimer();

  console.log("✅ Auth.js fully loaded and active");
});