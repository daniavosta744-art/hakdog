// rolemanager.js - CENTRAL ROLE MANAGEMENT SYSTEM

console.log("role-manager.js loading...");

// ==========================================
// ROLE DEFINITIONS
// ==========================================

const ROLES = {
  ADMIN: 'admin',
  USER:  'user',
  GUEST: 'guest'
};

// ==========================================
// PERMISSION DEFINITIONS
// ==========================================

const PERMISSIONS = {
  admin: {
    canViewAllUsers:        true,
    canManageUsers:         true,
    canDeleteData:          true,
    canModifySettings:      true,
    canViewReports:         true,
    canExportData:          true,
    canManageAlerts:        true,
    canViewHistory:         true,
    canViewDashboard:       true,
    canAccessAllParameters: true
  },
  user: {
    canViewAllUsers:        false,
    canManageUsers:         false,
    canDeleteData:          false,
    canModifySettings:      false,
    canViewReports:         true,
    canExportData:          true,
    canManageAlerts:        true,
    canViewHistory:         true,
    canViewDashboard:       true,
    canAccessAllParameters: true
  },
  guest: {
    canViewAllUsers:        false,
    canManageUsers:         false,
    canDeleteData:          false,
    canModifySettings:      false,
    canViewReports:         false,
    canExportData:          false,
    canManageAlerts:        false,
    canViewHistory:         false,
    canViewDashboard:       true,
    canAccessAllParameters: false
  }
};

// ==========================================
// NAV MENU ITEMS PER ROLE
// ==========================================
// Each item: { label, icon (Font Awesome class), href }
// Only items listed here will appear in the sidebar for that role.

const NAV_MENU = {
  guest: [
    { label: 'Dashboard', icon: 'fas fa-tachometer-alt', href: '/html/dashboard.html' },
    { label: 'About',     icon: 'fas fa-info-circle',    href: '/html/about.html'     }
  ],
  user: [
    { label: 'Dashboard', icon: 'fas fa-tachometer-alt', href: '/html/dashboard.html' },
    { label: 'Alerts',    icon: 'fas fa-bell',           href: '/html/alerts.html'    },
    { label: 'History',   icon: 'fas fa-history',        href: '/html/history.html'   },
    { label: 'Reports',   icon: 'fas fa-chart-bar',      href: '/html/reports.html'   },
    { label: 'About',     icon: 'fas fa-info-circle',    href: '/html/about.html'     }
  ],
  admin: [
    { label: 'Admin Dashboard', icon: 'fas fa-user-shield',   href: '/html/admindashboard.html' },
    { label: 'Dashboard',       icon: 'fas fa-tachometer-alt', href: '/html/dashboard.html'     },
    { label: 'Alerts',          icon: 'fas fa-bell',           href: '/html/alerts.html'        },
    { label: 'History',         icon: 'fas fa-history',        href: '/html/history.html'       },
    { label: 'Reports',         icon: 'fas fa-chart-bar',      href: '/html/reports.html'       },
    { label: 'System Config',   icon: 'fas fa-cogs',           href: '/html/systemConfig.html'  },
    { label: 'About',           icon: 'fas fa-info-circle',    href: '/html/about.html'         }
  ]
};

// Role display labels
const ROLE_LABELS = {
  admin: 'Administrator',
  user:  'User',
  guest: 'Guest'
};

// ==========================================
// ROLE DETECTION
// ==========================================

async function getCurrentUserRole() {
  try {
    const userSession = localStorage.getItem('userSession');

    if (userSession) {
      const session = JSON.parse(userSession);

      if (session.isGuest) {
        console.log("User is guest");
        return ROLES.GUEST;
      }

      if (session.uid && typeof firebase !== 'undefined' && firebase.database) {
        const database = firebase.database();
        const snapshot = await database.ref('users/' + session.uid).once('value');

        if (snapshot.exists()) {
          const userData = snapshot.val();
          const role = userData.role || ROLES.USER;
          console.log("User role from Firebase:", role);
          return role;
        }
      }

      // Fallback to session role if Firebase unavailable
      if (session.role) {
        console.log("User role from session:", session.role);
        return session.role;
      }
    }

    console.log("No session found, defaulting to guest");
    return ROLES.GUEST;

  } catch (error) {
    console.error("Error getting user role:", error);
    return ROLES.GUEST;
  }
}

// ==========================================
// PERMISSION HELPERS
// ==========================================

async function hasPermission(permissionName) {
  try {
    const role = await getCurrentUserRole();
    const permissions = PERMISSIONS[role];

    if (!permissions) {
      console.warn("Unknown role:", role);
      return false;
    }

    const allowed = permissions[permissionName] || false;
    console.log(`Permission check: ${permissionName} for "${role}" = ${allowed}`);
    return allowed;

  } catch (error) {
    console.error("Error checking permission:", error);
    return false;
  }
}

function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'Unknown';
}

async function isAdmin() { return (await getCurrentUserRole()) === ROLES.ADMIN; }
async function isUser()  { return (await getCurrentUserRole()) === ROLES.USER;  }
async function isGuest() { return (await getCurrentUserRole()) === ROLES.GUEST; }

// ==========================================
// NAVIGATION MENU RENDERING
// ==========================================

/**
 * Renders the sidebar/nav menu for the current user's role.
 * Call this from any page: renderNavMenu('sidebar-nav');
 *
 * @param {string} containerId - The id of the <ul> or <nav> element to populate.
 */
async function renderNavMenu(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`renderNavMenu: element #${containerId} not found`);
    return;
  }

  const role = await getCurrentUserRole();
  const items = NAV_MENU[role] || NAV_MENU.guest;
  const currentPath = window.location.pathname;

  container.innerHTML = ''; // Clear existing items

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'nav-item';

    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'nav-link';

    // Highlight active page
    if (currentPath.endsWith(item.href.replace('/html', ''))) {
      a.classList.add('active');
    }

    a.innerHTML = `<i class="${item.icon}"></i> <span>${item.label}</span>`;
    li.appendChild(a);
    container.appendChild(li);
  });

  console.log(`✅ Nav menu rendered for role: "${role}" (${items.length} items)`);
}

// ==========================================
// ROLE-BASED UI (data-attribute API)
// ==========================================

/**
 * Reads [data-permission], [data-role], and [data-hide-for-role] attributes
 * on any element and shows/hides them based on the current user's role.
 *
 * Usage in HTML:
 *   <button data-permission="canManageUsers">Manage Users</button>
 *   <li data-role="admin">Admin Only Item</li>
 *   <li data-hide-for-role="guest">Hidden from Guests</li>
 */
async function applyRoleBasedUI() {
  try {
    const role = await getCurrentUserRole();
    const permissions = PERMISSIONS[role];

    if (!permissions) {
      console.warn("Unknown role, hiding all restricted elements");
      return;
    }

    // Show/hide by permission
    document.querySelectorAll('[data-permission]').forEach(el => {
      const perm = el.getAttribute('data-permission');
      el.style.display = permissions[perm] ? '' : 'none';
    });

    // Show only for matching role
    document.querySelectorAll('[data-role]').forEach(el => {
      const requiredRole = el.getAttribute('data-role');
      el.style.display = (role === requiredRole) ? '' : 'none';
    });

    // Hide for specific role
    document.querySelectorAll('[data-hide-for-role]').forEach(el => {
      const hideFor = el.getAttribute('data-hide-for-role');
      el.style.display = (role === hideFor) ? 'none' : '';
    });

    console.log(`✅ Role-based UI applied for role: "${role}"`);

  } catch (error) {
    console.error("Error applying role-based UI:", error);
  }
}

// ==========================================
// ADMIN: UPDATE USER ROLE IN FIREBASE
// ==========================================

async function updateUserRole(targetUserId, newRole) {
  try {
    const adminCheck = await isAdmin();
    if (!adminCheck) throw new Error("Only admins can update user roles");

    if (!Object.values(ROLES).includes(newRole)) {
      throw new Error("Invalid role: " + newRole);
    }

    const database = firebase.database();
    await database.ref('users/' + targetUserId + '/role').set(newRole);
    await database.ref('users/' + targetUserId + '/roleUpdatedAt')
                  .set(firebase.database.ServerValue.TIMESTAMP);

    console.log(`✅ Updated user ${targetUserId} role to "${newRole}"`);
    return true;

  } catch (error) {
    console.error("Error updating user role:", error);
    throw error;
  }
}

// ==========================================
// REDIRECT BASED ON ROLE
// ==========================================

async function redirectBasedOnRole() {
  try {
    const role = await getCurrentUserRole();

    switch (role) {
      case ROLES.ADMIN:
        window.location.href = '/html/admindashboard.html';
        break;
      case ROLES.USER:
        window.location.href = '/html/dashboard.html';
        break;
      case ROLES.GUEST:
      default:
        window.location.href = '/html/dashboard.html';
    }
  } catch (error) {
    console.error("Error redirecting based on role:", error);
    window.location.href = '/index.html';
  }
}

// ==========================================
// AUTO-INIT
// ==========================================

function initRoleManager() {
  console.log("Initializing role manager...");

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRoleBasedUI);
  } else {
    applyRoleBasedUI();
  }
}

initRoleManager();

console.log("✅ role-manager.js loaded");