// login.js - SIMPLIFIED LOGIN WITH ACCOUNT EXISTENCE CHECK + ROLE-BASED REDIRECT

console.log("login.js loading...");

// Main initialization function
function initLogin() {
  console.log("Initializing login...");
  
  // Check if Firebase is initialized
  if (typeof firebase === 'undefined') {
    console.error("Firebase is not loaded!");
    return;
  }
  
  // Get Firebase instances
  const auth = firebase.auth();
  const database = firebase.database();
  console.log("Firebase initialized for login");

  // DOM Elements
  const loginForm = document.getElementById('loginForm');
  const guestBtn = document.getElementById('guestBtn');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('loginPassword');

  // Password toggle functionality
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function() {
      const type = passwordInput.getAttribute('type');
      
      if (type === 'password') {
        passwordInput.setAttribute('type', 'text');
        togglePassword.textContent = 'Hide';
        togglePassword.setAttribute('aria-label', 'Hide password');
      } else {
        passwordInput.setAttribute('type', 'password');
        togglePassword.textContent = 'Show';
        togglePassword.setAttribute('aria-label', 'Show password');
      }
    });

    togglePassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePassword.click();
      }
    });
  }

  // Helper functions
  function showLoading(text = 'Processing...') {
    loadingText.textContent = text;
    loadingOverlay.classList.add('active');
  }

  function hideLoading() {
    loadingOverlay.classList.remove('active');
  }

  function showError(message) {
    errorMessage.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    errorMessage.classList.add('show');
    successMessage.classList.remove('show');
    
    setTimeout(() => {
      errorMessage.classList.remove('show');
    }, 5000);
  }

  function showSuccess(message) {
    successMessage.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    successMessage.classList.add('show');
    errorMessage.classList.remove('show');
    
    setTimeout(() => {
      successMessage.classList.remove('show');
    }, 3000);
  }

  function clearMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
  }

  // Check if user account exists in Firebase Database
  async function checkAccountExists(uid) {
    try {
      console.log('🔍 Checking if account exists in database for UID:', uid);
      const userRef = database.ref('users/' + uid);
      const snapshot = await userRef.once('value');
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        console.log('✅ Account found in database:', userData);
        return {
          exists: true,
          data: userData
        };
      } else {
        console.log('❌ Account NOT found in database');
        return {
          exists: false,
          data: null
        };
      }
    } catch (error) {
      console.error('❌ Error checking account existence:', error);
      throw error;
    }
  }

  // Redirect based on user role
  function redirectBasedOnRole(role) {
    console.log('🔄 Redirecting based on role:', role);
    
    switch(role) {
      case 'admin':
        window.location.href = 'admindashboard.html';
        break;
      case 'user':
        window.location.href = 'dashboard.html';
        break;
      case 'guest':
        window.location.href = 'dashboard.html';
        break;
      default:
        // If role is not set or unknown, default to user dashboard
        console.warn('Unknown role, defaulting to user dashboard');
        window.location.href = 'dashboard.html';
    }
  }

  // Handle login form submission
  loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearMessages();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = passwordInput.value;

    console.log('📧 Login attempt for:', email);

    // Validate inputs
    if (!email || !password) {
      showError('Please fill in all fields');
      return;
    }

    showLoading('Signing in...');

    try {
      console.log('🔐 Authenticating with Firebase...');
      
      // Try to sign in with the credentials
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;
      
      console.log('✅ Firebase Auth successful! UID:', user.uid);

      // Check if email is verified
      if (!user.emailVerified) {
        console.log('❌ Email not verified');
        await auth.signOut();
        hideLoading();
        showError('Email not verified. Please verify your email before logging in. Check your inbox for the verification link.');
        return;
      }

      console.log('✅ Email is verified');

      // Check if account exists in database
      console.log('🔍 Checking if account exists in database...');
      
      const accountCheck = await checkAccountExists(user.uid);
      
      if (!accountCheck.exists) {
        console.log('❌ Account does not exist in database');
        await auth.signOut();
        hideLoading();
        showError('Account not found in our database. Please complete the signup process first.');
        
        // Redirect to signup after 3 seconds
        setTimeout(() => {
          window.location.href = 'signup.html';
        }, 3000);
        return;
      }

      console.log('✅ Account exists in database');

      // Check account status
      if (accountCheck.data.accountStatus === 'disabled' || accountCheck.data.accountStatus === 'suspended') {
        console.log('❌ Account is disabled/suspended');
        await auth.signOut();
        hideLoading();
        showError('Your account has been disabled. Please contact support.');
        return;
      }

      console.log('✅ Account status is active');

      // Get user role
      const userRole = accountCheck.data.role || 'user'; // Default to 'user' if no role
      console.log('👤 User role:', userRole);

      // Update lastLogin in database
      try {
        await database.ref('users/' + user.uid + '/lastLogin').set(firebase.database.ServerValue.TIMESTAMP);
        console.log('✅ Updated lastLogin timestamp in database');
      } catch (dbError) {
        console.log('⚠️ Could not update lastLogin:', dbError);
        // Don't fail login if this fails
      }

      // Store user session
      localStorage.setItem('userSession', JSON.stringify({
        uid: user.uid,
        email: user.email,
        role: userRole,
        isLoggedIn: true,
        isGuest: false,
        timestamp: new Date().toISOString()
      }));

      hideLoading();
      showSuccess('Login successful! Redirecting...');

      // Redirect based on role
      setTimeout(() => {
        redirectBasedOnRole(userRole);
      }, 1500);

    } catch (authError) {
      console.log('❌ Authentication error:', authError.code);
      hideLoading();
      
      // Handle specific authentication errors
      if (authError.code === 'auth/user-not-found') {
        showError('No account found with this email. Please sign up first.');
        setTimeout(() => {
          window.location.href = 'signup.html';
        }, 2000);
      } else if (authError.code === 'auth/wrong-password') {
        showError('Incorrect password. Please try again.');
      } else if (authError.code === 'auth/invalid-email') {
        showError('Invalid email format. Please check your email.');
      } else if (authError.code === 'auth/user-disabled') {
        showError('This account has been disabled. Please contact support.');
      } else if (authError.code === 'auth/too-many-requests') {
        showError('Too many failed attempts. Please try again later.');
      } else if (authError.code === 'auth/network-request-failed') {
        showError('Network error. Please check your connection.');
      } else {
        showError('Login failed. Please check your credentials and try again.');
      }
    }
  });

  // ========================================
  // FIXED: Guest access with Firebase auth
  // ========================================
  guestBtn.addEventListener('click', async function() {
    console.log('🎭 Guest button clicked');
    showLoading('Logging in as guest...');
    
    try {
      // First, authenticate anonymously with Firebase
      const result = await auth.signInAnonymously();
      console.log('✅ Firebase anonymous authentication successful:', result.user.uid);
      
      // Create proper guest session with Firebase uid
      const guestSession = {
        uid: result.user.uid, // Use Firebase anonymous user UID
        email: 'guest@fishda.local',
        role: 'guest',
        isLoggedIn: true,
        isGuest: true,
        timestamp: new Date().toISOString()
      };
      
      console.log('📝 Creating guest session:', guestSession);
      localStorage.setItem('userSession', JSON.stringify(guestSession));
      
      console.log('✅ Guest session created, redirecting to dashboard...');
      
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error signing in as guest:', error);
      hideLoading();
      showError('Failed to login as guest: ' + error.message);
    }
  });

  // Check if already logged in and redirect
  auth.onAuthStateChanged((user) => {
    if (user && !user.isAnonymous) {
      const userSession = localStorage.getItem('userSession');
      if (userSession) {
        const session = JSON.parse(userSession);
        if (session.isLoggedIn && !session.isGuest) {
          console.log("User already logged in, redirecting based on role");
          redirectBasedOnRole(session.role || 'user');
        }
      }
    }
  });

  console.log("✅ Login initialization complete!");
}

// Run immediately if DOM is already loaded, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogin);
} else {
  initLogin();
}
