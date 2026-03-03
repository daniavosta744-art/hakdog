// signup.js - FIXED: Only create database account AFTER email verification + ROLE SUPPORT

console.log("signup.js loading...");

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded");
  
  if (typeof firebase === 'undefined') {
    console.error("Firebase is not loaded!");
    return;
  }
  
  const auth = firebase.auth();
  const database = firebase.database();
  console.log("Firebase initialized");

  // DOM Elements
  const signupForm = document.getElementById('signupForm');
  const verificationStep = document.getElementById('verificationStep');
  const successArea = document.getElementById('successArea');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const footerLinks = document.getElementById('footerLinks');
  const pageTagline = document.getElementById('pageTagline');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('signupPassword');
  const emailDisplay = document.getElementById('emailDisplay');
  const resendEmailBtn = document.getElementById('resendEmailBtn');
  const checkVerificationBtn = document.getElementById('checkVerificationBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  // State variables
  let tempUser = null;
  let userEmail = '';
  let checkInterval = null;

  // Password toggle
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function() {
      const type = passwordInput.getAttribute('type');
      
      if (type === 'password') {
        passwordInput.setAttribute('type', 'text');
        togglePassword.textContent = 'Hide';
      } else {
        passwordInput.setAttribute('type', 'password');
        togglePassword.textContent = 'Show';
      }
    });

    togglePassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePassword.click();
      }
    });
  }

  // Password validation
  function validatePassword(password) {
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/`~;']/.test(password);
    const isLongEnough = password.length >= 8;

    if (!isLongEnough) {
      return { valid: false, message: 'Password must be at least 8 characters long' };
    }
    if (!hasUppercase) {
      return { valid: false, message: 'Password must contain at least one uppercase letter (A-Z)' };
    }
    if (!hasLowercase) {
      return { valid: false, message: 'Password must contain at least one lowercase letter (a-z)' };
    }
    if (!hasNumber) {
      return { valid: false, message: 'Password must contain at least one number (0-9)' };
    }
    if (!hasSymbol) {
      return { valid: false, message: 'Password must contain at least one special character (!@#$%^&*...)' };
    }

    return { valid: true };
  }

  // Real-time password strength
  if (passwordInput) {
    passwordInput.addEventListener('input', function() {
      const password = this.value;
      const helpText = document.querySelector('.password-help');
      
      if (password.length === 0) {
        helpText.innerHTML = '<i class="fas fa-info-circle"></i> Use at least 8 characters with uppercase, lowercase, numbers, and symbols';
        helpText.style.color = '#94a3b8';
        return;
      }

      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSymbol = /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/`~;']/.test(password);
      const isLongEnough = password.length >= 8;

      const meetsAll = hasUppercase && hasLowercase && hasNumber && hasSymbol && isLongEnough;

      if (meetsAll) {
        helpText.innerHTML = '<i class="fas fa-check-circle"></i> Password is strong!';
        helpText.style.color = '#22c55e';
      } else {
        const missing = [];
        if (!isLongEnough) missing.push('8+ characters');
        if (!hasUppercase) missing.push('uppercase');
        if (!hasLowercase) missing.push('lowercase');
        if (!hasNumber) missing.push('number');
        if (!hasSymbol) missing.push('symbol');
        
        helpText.innerHTML = `<i class="fas fa-exclamation-circle"></i> Missing: ${missing.join(', ')}`;
        helpText.style.color = '#f59e0b';
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

  // Save user data to database (ONLY called after email verification)
  async function saveUserToDatabase(user) {
    try {
      const userData = {
        uid: user.uid,
        email: user.email,
        emailVerified: true,
        role: 'user', // Default role for new signups
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        lastLogin: firebase.database.ServerValue.TIMESTAMP,
        accountStatus: 'disabled' // Default to disabled - admin must enable
      };

      await database.ref('users/' + user.uid).set(userData);
      console.log("✅ User data saved to database successfully");
      return true;
    } catch (error) {
      console.error("❌ Error saving user data to database:", error);
      return false;
    }
  }

  // Auto-check verification status
  function startAutoCheck() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }

    console.log("🔄 Starting auto-check for email verification...");

    checkInterval = setInterval(async () => {
      if (!tempUser) {
        console.log("No temp user, stopping auto-check");
        clearInterval(checkInterval);
        return;
      }

      try {
        await tempUser.reload();
        console.log("Email verified status:", tempUser.emailVerified);
        
        if (tempUser.emailVerified) {
          console.log("✅ Email verified! Processing account completion...");
          clearInterval(checkInterval);
          await handleVerificationSuccess();
        }
      } catch (error) {
        console.error('Error checking verification:', error);
        // Stop checking if session expired
        if (error.code === 'auth/user-token-expired' || error.code === 'auth/user-not-found') {
          clearInterval(checkInterval);
          showError('Session expired. Please try signing up again.');
        }
      }
    }, 3000); // Check every 3 seconds
  }

  // Handle successful verification
  async function handleVerificationSuccess() {
    showLoading('Completing your account setup...');
    
    try {
      // Get the current user (they're still signed in from signup)
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('No user found');
      }

      console.log("✅ User email verified:", user.uid);

      // Save user data to database NOW (only after verification)
      loadingText.textContent = 'Creating your account...';
      console.log("💾 Saving user data to database...");
      
      const dataSaved = await saveUserToDatabase(user);
      
      if (!dataSaved) {
        throw new Error('Failed to save user data to database');
      }

      console.log("✅ Account created in database successfully!");

      // Sign out the user - they need to login manually
      await auth.signOut();
      console.log("🔓 User signed out - will need to login");

      hideLoading();
      
      // Show success screen
      verificationStep.style.display = 'none';
      successArea.style.display = 'block';
      pageTagline.textContent = 'Success!';
      
      showSuccess('Account created successfully!');
      
      console.log("🎉 Account creation complete! User can now login.");

    } catch (error) {
      console.error('❌ Error completing account setup:', error);
      hideLoading();
      
      showError('Error completing setup: ' + (error.message || 'Unknown error'));
      
      // Still redirect to login after error
      setTimeout(() => {
        window.location.href = '../index.html';
      }, 3000);
    }
  }

  // STEP 1: Handle signup form submission
  signupForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearMessages();
    
    const email = document.getElementById('signupEmail').value.trim();
    const password = passwordInput.value;

    console.log("📝 Signup attempt for:", email);

    if (!email) {
      showError('Please enter your email address');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      showError(passwordValidation.message);
      return;
    }

    // Store email for display
    userEmail = email;

    showLoading('Creating your account...');
    
    try {
      // Create user account (Firebase Auth only, NO database entry yet)
      console.log("🔐 Creating Firebase Auth account...");
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      tempUser = userCredential.user;
      console.log("✅ Firebase Auth user created:", tempUser.uid);
      console.log("⚠️  Database entry will be created AFTER email verification with role: 'user'");

      // Send verification email
      loadingText.textContent = 'Sending verification email...';
      console.log("📧 Sending verification email...");
      
      await tempUser.sendEmailVerification();
      
      console.log("✅ Verification email sent successfully!");

      hideLoading();

      // Show verification step
      signupForm.style.display = 'none';
      footerLinks.style.display = 'none';
      verificationStep.style.display = 'block';
      pageTagline.textContent = 'Verify Your Email';
      emailDisplay.textContent = email;

      showSuccess('Verification email sent! Please check your inbox.');

      // Start auto-checking for verification
      startAutoCheck();

    } catch (error) {
      console.error('❌ Signup error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      hideLoading();

      // Clean up if account was created
      if (tempUser) {
        try {
          console.log("🗑️ Attempting to delete incomplete user account...");
          await tempUser.delete();
          tempUser = null;
          console.log("✅ Incomplete user account deleted");
        } catch (deleteError) {
          console.error("❌ Error deleting user:", deleteError);
        }
      }

      // Handle specific error codes
      switch (error.code) {
        case 'auth/email-already-in-use':
          showError('This email is already registered. Please sign in or use a different email.');
          break;
        case 'auth/invalid-email':
          showError('Invalid email address format.');
          break;
        case 'auth/operation-not-allowed':
          showError('Email/Password authentication is not enabled. Please contact support.');
          break;
        case 'auth/weak-password':
          showError('Password is too weak. Please use a stronger password.');
          break;
        case 'auth/network-request-failed':
          showError('Network error. Please check your connection and try again.');
          break;
        case 'auth/too-many-requests':
          showError('Too many attempts. Please try again later.');
          break;
        default:
          showError('Failed to create account: ' + (error.message || 'Unknown error'));
      }
    }
  });

  // Manual verification check
  if (checkVerificationBtn) {
    checkVerificationBtn.addEventListener('click', async function() {
      if (!tempUser) {
        showError('No user session found. Please try signing up again.');
        return;
      }

      clearMessages();
      showLoading('Checking verification status...');

      try {
        await tempUser.reload();
        console.log("🔍 Manual check - Email verified:", tempUser.emailVerified);
        
        if (tempUser.emailVerified) {
          await handleVerificationSuccess();
        } else {
          hideLoading();
          showError('Email not verified yet. Please check your inbox and click the verification link.');
        }
      } catch (error) {
        console.error('❌ Check verification error:', error);
        hideLoading();
        showError('Failed to check verification status. Please try again.');
      }
    });
  }

  // Resend verification email
  if (resendEmailBtn) {
    resendEmailBtn.addEventListener('click', async function() {
      if (!tempUser) {
        showError('No user session found. Please try signing up again.');
        return;
      }

      clearMessages();
      resendEmailBtn.disabled = true;
      resendEmailBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

      try {
        await tempUser.sendEmailVerification();
        console.log("✅ Verification email resent successfully!");

        showSuccess('Verification email sent! Please check your inbox.');
        
        setTimeout(() => {
          resendEmailBtn.disabled = false;
          resendEmailBtn.innerHTML = '<i class="fas fa-redo"></i> Resend Verification Email';
        }, 30000); // 30 seconds cooldown

      } catch (error) {
        console.error('❌ Resend error:', error);
        resendEmailBtn.disabled = false;
        resendEmailBtn.innerHTML = '<i class="fas fa-redo"></i> Resend Verification Email';
        
        if (error.code === 'auth/too-many-requests') {
          showError('Too many requests. Please wait a few minutes before trying again.');
        } else {
          showError('Failed to resend verification email: ' + (error.message || 'Unknown error'));
        }
      }
    });
  }

  // Sign out and go back
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      
      try {
        clearInterval(checkInterval);
        
        // Delete the temporary unverified account
        if (tempUser && !tempUser.emailVerified) {
          await tempUser.delete();
          console.log("🗑️ Unverified temporary account deleted");
        }
        
        await auth.signOut();
        console.log("👋 User signed out");
        
        // Reset form
        verificationStep.style.display = 'none';
        signupForm.style.display = 'block';
        footerLinks.style.display = 'block';
        pageTagline.textContent = 'Create Your Account';
        
        tempUser = null;
        userEmail = '';
        
        document.getElementById('signupEmail').value = '';
        passwordInput.value = '';
        
        clearMessages();
        
      } catch (error) {
        console.error('❌ Sign out error:', error);
        showError('Failed to sign out. Please try again.');
      }
    });
  }

  // Monitor auth state changes
  auth.onAuthStateChanged((user) => {
    console.log("🔄 Auth state changed:", user ? user.email : "No user");
    
    // Don't redirect - let user manually go to login
    if (user && user.emailVerified) {
      console.log("✅ Verified user detected:", user.email);
    }
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', function() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }
  });

  console.log("✅ Signup.js fully loaded and ready");
});