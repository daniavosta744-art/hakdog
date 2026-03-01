// forgot-password.js - PASSWORD RESET WITH ACCOUNT EXISTENCE CHECK

console.log("forgot-password.js loading...");

// Main initialization function
function initForgotPassword() {
  console.log("Initializing forgot password...");
  
  // Check if Firebase is initialized
  if (typeof firebase === 'undefined') {
    console.error("Firebase is not loaded!");
    return;
  }
  
  // Get Firebase instances
  const auth = firebase.auth();
  const database = firebase.database();
  console.log("Firebase initialized for password reset");

  // DOM Elements
  const resetForm = document.getElementById('resetForm');
  const successArea = document.getElementById('successArea');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const footerLinks = document.getElementById('footerLinks');
  const pageTagline = document.getElementById('pageTagline');
  const emailDisplay = document.getElementById('emailDisplay');
  const resetEmailInput = document.getElementById('resetEmail');

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
    }, 10000);
  }

  function showSuccess(message) {
    successMessage.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    successMessage.classList.add('show');
    errorMessage.classList.remove('show');
    
    setTimeout(() => {
      successMessage.classList.remove('show');
    }, 10000);
  }

  function clearMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
  }

  // Check if user exists in Firebase Database
  async function checkUserExistsInDatabase(email) {
    try {
      console.log('🔍 Checking if user exists in database with email:', email);
      
      // Query the database to find user by email
      const usersRef = database.ref('users');
      const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        const uid = Object.keys(userData)[0];
        console.log('✅ User found in database:', uid);
        return {
          exists: true,
          uid: uid,
          data: userData[uid]
        };
      } else {
        console.log('❌ User NOT found in database');
        return {
          exists: false
        };
      }
    } catch (error) {
      console.error('❌ Error checking user in database:', error);
      throw error;
    }
  }

  // Handle reset form submission
  resetForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearMessages();
    
    const email = resetEmailInput.value.trim();

    console.log('📧 Password reset attempt for:', email);

    // Validate email
    if (!email) {
      showError('Please enter your email address');
      return;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showError('Please enter a valid email address');
      return;
    }

    showLoading('Checking account...');

    try {
      console.log('🔍 Step 1: Checking if account exists in database...');
      
      // Check if user exists in database first
      const userCheck = await checkUserExistsInDatabase(email);
      
      if (!userCheck.exists) {
        console.log('❌ Account not found in database');
        hideLoading();
        showError('No account found with this email address. Please check your email or sign up for a new account.');
        return;
      }

      console.log('✅ Account found in database');

      // Check account status
      if (userCheck.data.accountStatus === 'disabled' || userCheck.data.accountStatus === 'suspended') {
        console.log('❌ Account is disabled/suspended');
        hideLoading();
        showError('Your account has been disabled. Please contact support.');
        return;
      }

      console.log('✅ Account status is active');

      // Check if email is verified
      if (!userCheck.data.emailVerified) {
        console.log('⚠️  Email not verified');
        hideLoading();
        showError('Your email is not verified. Please verify your email first before resetting your password.');
        return;
      }

      console.log('✅ Email is verified');

      // All checks passed - send password reset email
      loadingText.textContent = 'Sending reset link...';
      console.log('📧 Sending password reset email...');
      
      await auth.sendPasswordResetEmail(email);
      
      console.log('✅ Password reset email sent successfully!');

      hideLoading();

      // Show success screen
      emailDisplay.textContent = email;
      resetForm.style.display = 'none';
      footerLinks.style.display = 'none';
      successArea.style.display = 'block';
      pageTagline.textContent = 'Email Sent!';

      showSuccess('Password reset link sent to your email!');

    } catch (error) {
      console.error('❌ Password reset error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      hideLoading();

      // Handle specific Firebase Auth errors
      switch (error.code) {
        case 'auth/user-not-found':
          showError('No account found with this email address. Please check your email or sign up.');
          break;
        case 'auth/invalid-email':
          showError('Invalid email address format. Please check your email.');
          break;
        case 'auth/too-many-requests':
          showError('Too many reset attempts. Please try again later.');
          break;
        case 'auth/network-request-failed':
          showError('Network error. Please check your connection and try again.');
          break;
        case 'auth/user-disabled':
          showError('This account has been disabled. Please contact support.');
          break;
        default:
          showError('Failed to send reset email. Please try again later.');
      }
    }
  });

  // Focus on email input on page load
  if (resetEmailInput) {
    resetEmailInput.focus();
  }

  console.log("✅ Forgot password initialization complete!");
}

// Run immediately if DOM is already loaded, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initForgotPassword);
} else {
  initForgotPassword();
}