// ===========================
// HAMBURGER / SIDEBAR TOGGLE
// ===========================
  function toggleSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerBtn');

    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
    hamburger.classList.toggle('active');
  }

  // Close sidebar when a nav link is clicked (nice on mobile)
  document.querySelectorAll('.sidebar ul li a').forEach(link => {
    link.addEventListener('click', () => {
      const sidebar  = document.getElementById('sidebar');
      const overlay  = document.getElementById('sidebarOverlay');
      const hamburger = document.getElementById('hamburgerBtn');
      
      // Only auto-close on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        hamburger.classList.remove('active');
      }
    });
  });

  // ===========================
  // BATTERY INDICATOR COLOR
  // ===========================
  function updateBatteryColor(percentage) {
    const batteryIndicator = document.getElementById('batteryIndicator');
    const batteryIcon = batteryIndicator.querySelector('i');
    
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

  // ===========================
  // STARS (dark mode)
  // ===========================
  function createStars() {
    const starsContainer = document.getElementById('starsContainer');
    for (let i = 0; i < 50; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      const size = Math.random() * 2 + 1;
      star.style.left  = `${Math.random() * 100}%`;
      star.style.top   = `${Math.random() * 100}%`;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.animationDelay = `${Math.random() * 3}s`;
      starsContainer.appendChild(star);
    }
  }

  // ===========================
  // DARK MODE TOGGLE
  // ===========================
  function toggleDarkMode() {
    const toggle         = document.getElementById('darkModeToggle');
    const modeTransition = document.getElementById('modeTransition');

    modeTransition.classList.add('active');

    setTimeout(() => {
      if (toggle.checked) {
        document.body.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      setTimeout(() => modeTransition.classList.remove('active'), 300);
    }, 100);
  }

  // ===========================
  // PROFILE DROPDOWN TOGGLE
  // ===========================
  function toggleProfileDropdown() {
    const trigger = document.getElementById('profileTrigger');
    const dropdown = document.getElementById('profileDropdown');
    
    trigger.classList.toggle('active');
    dropdown.classList.toggle('show');
  }

  function closeProfileDropdown() {
    const trigger = document.getElementById('profileTrigger');
    const dropdown = document.getElementById('profileDropdown');
    
    trigger.classList.remove('active');
    dropdown.classList.remove('show');
  }

  // ===========================
  // INIT
  // ===========================
  document.addEventListener('DOMContentLoaded', function() {
    createStars();

    // Restore saved theme
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark');
      const toggle = document.getElementById('darkModeToggle');
      if (toggle) toggle.checked = true;
    }

    // Close sidebar when clicking outside on mobile
    document.getElementById('sidebarOverlay').addEventListener('click', function() {
      toggleSidebar();
    });

    // Profile dropdown functionality
    const profileTrigger = document.getElementById('profileTrigger');
    
    if (profileTrigger) {
      profileTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleProfileDropdown();
      });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      const container = document.querySelector('.profile-dropdown-container');
      const dropdown = document.getElementById('profileDropdown');
      
      if (container && !container.contains(e.target)) {
        closeProfileDropdown();
      }
    });
  });

