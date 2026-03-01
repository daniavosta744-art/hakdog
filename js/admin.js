// admin.js - ADMIN USER MANAGEMENT FUNCTIONALITY

console.log("admin.js loading...");

document.addEventListener('DOMContentLoaded', async function() {
  console.log("DOM loaded");
  
  if (typeof firebase === 'undefined') {
    console.error("Firebase is not loaded!");
    return;
  }
  
  const database = firebase.database();
  console.log("Firebase initialized");

  // Check if user is admin
  const currentUser = window.getCurrentUser();
  if (!currentUser || currentUser.role !== 'admin') {
    console.log("Not an admin, redirecting...");
    window.location.href = '/html/dashboard.html';
    return;
  }

  console.log("Admin user confirmed:", currentUser.email);

  // Load users from Firebase
  async function loadUsers() {
    try {
      console.log("Loading users from Firebase...");
      
      const usersRef = database.ref('users');
      const snapshot = await usersRef.once('value');
      
      if (!snapshot.exists()) {
        console.log("No users found");
        displayNoUsers();
        return;
      }

      const users = snapshot.val();
      console.log("Users loaded:", Object.keys(users).length);
      
      displayUsers(users);
      updateStatistics(users);
      
    } catch (error) {
      console.error("Error loading users:", error);
      displayError("Failed to load users. Please refresh the page.");
    }
  }

  // Display users in table
  function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    Object.keys(users).forEach(uid => {
      const user = users[uid];
      const row = createUserRow(uid, user);
      tbody.appendChild(row);
    });
  }

  // Create user table row
  function createUserRow(uid, user) {
    const tr = document.createElement('tr');
    
    // Email
    const tdEmail = document.createElement('td');
    tdEmail.textContent = user.email || 'N/A';
    tr.appendChild(tdEmail);

    // Role
    const tdRole = document.createElement('td');
    const roleBadge = document.createElement('span');
    roleBadge.className = `role-badge role-${user.role || 'user'}`;
    roleBadge.textContent = (user.role || 'user').toUpperCase();
    tdRole.appendChild(roleBadge);
    tr.appendChild(tdRole);

    // Status
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    const status = user.accountStatus || 'active';
    statusBadge.className = `status-badge status-${status}`;
    statusBadge.textContent = status.toUpperCase();
    tdStatus.appendChild(statusBadge);
    tr.appendChild(tdStatus);

    // Created
    const tdCreated = document.createElement('td');
    tdCreated.textContent = user.createdAt ? formatDate(user.createdAt) : 'N/A';
    tr.appendChild(tdCreated);

    // Last Login
    const tdLastLogin = document.createElement('td');
    tdLastLogin.textContent = user.lastLogin ? formatDate(user.lastLogin) : 'Never';
    tr.appendChild(tdLastLogin);

    // Actions
    const tdActions = document.createElement('td');
    
    // Change Role button
    const btnChangeRole = document.createElement('button');
    btnChangeRole.className = 'action-btn btn-edit';
    btnChangeRole.innerHTML = '<i class="fas fa-user-cog"></i> Change Role';
    btnChangeRole.onclick = () => changeUserRole(uid, user);
    tdActions.appendChild(btnChangeRole);

    // Enable/Disable button
    const isDisabled = status === 'disabled';
    const btnToggleStatus = document.createElement('button');
    btnToggleStatus.className = `action-btn ${isDisabled ? 'btn-enable' : 'btn-disable'}`;
    btnToggleStatus.innerHTML = isDisabled ? 
      '<i class="fas fa-check"></i> Enable' : 
      '<i class="fas fa-ban"></i> Disable';
    btnToggleStatus.onclick = () => toggleUserStatus(uid, user);
    tdActions.appendChild(btnToggleStatus);

    tr.appendChild(tdActions);

    return tr;
  }

  // Update statistics
  function updateStatistics(users) {
    let totalUsers = 0;
    let activeUsers = 0;
    let adminCount = 0;
    let disabledCount = 0;

    Object.values(users).forEach(user => {
      totalUsers++;
      
      if (user.accountStatus === 'active') {
        activeUsers++;
      }
      
      if (user.accountStatus === 'disabled' || user.accountStatus === 'suspended') {
        disabledCount++;
      }
      
      if (user.role === 'admin') {
        adminCount++;
      }
    });

    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('activeUsers').textContent = activeUsers;
    document.getElementById('adminCount').textContent = adminCount;
    document.getElementById('disabledCount').textContent = disabledCount;
  }

  // Change user role
  async function changeUserRole(uid, user) {
    const currentRole = user.role || 'user';
    
    const newRole = prompt(
      `Change role for ${user.email}\n\nCurrent role: ${currentRole}\n\nEnter new role (admin/user):`,
      currentRole
    );

    if (!newRole) {
      return; // User cancelled
    }

    const trimmedRole = newRole.trim().toLowerCase();

    if (trimmedRole !== 'admin' && trimmedRole !== 'user') {
      alert('Invalid role. Please enter "admin" or "user".');
      return;
    }

    if (trimmedRole === currentRole) {
      alert('User already has this role.');
      return;
    }

    try {
      console.log(`Changing role for ${uid} to ${trimmedRole}`);
      
      await database.ref('users/' + uid + '/role').set(trimmedRole);
      await database.ref('users/' + uid + '/roleUpdatedAt').set(firebase.database.ServerValue.TIMESTAMP);
      
      alert(`Successfully changed role to ${trimmedRole}`);
      loadUsers(); // Reload table
      
    } catch (error) {
      console.error('Error changing role:', error);
      alert('Failed to change role: ' + error.message);
    }
  }

  // Toggle user status (enable/disable)
  async function toggleUserStatus(uid, user) {
    const currentStatus = user.accountStatus || 'active';
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    
    const action = newStatus === 'disabled' ? 'disable' : 'enable';
    const confirmMsg = `Are you sure you want to ${action} ${user.email}?`;
    
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      console.log(`Changing status for ${uid} to ${newStatus}`);
      
      await database.ref('users/' + uid + '/accountStatus').set(newStatus);
      await database.ref('users/' + uid + '/statusUpdatedAt').set(firebase.database.ServerValue.TIMESTAMP);
      
      alert(`Successfully ${action}d account`);
      loadUsers(); // Reload table
      
    } catch (error) {
      console.error('Error changing status:', error);
      alert('Failed to change status: ' + error.message);
    }
  }

  // Format timestamp to readable date
  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  // Display no users message
  function displayNoUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748b;">No users found</td></tr>';
  }

  // Display error message
  function displayError(message) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: #ef4444;"><i class="fas fa-exclamation-triangle"></i> ${message}</td></tr>`;
  }

  // Load users on page load
  loadUsers();

  // Refresh users every 30 seconds
  setInterval(loadUsers, 30000);

  console.log("✅ Admin.js fully loaded and ready");
});