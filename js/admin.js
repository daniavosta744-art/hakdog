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

  // Modals and notification are defined in admindashboard.html

  // ============================================================
  // MODAL HELPERS
  // ============================================================

  function showNotification(message, type = 'success') {
    const notif = document.getElementById('adminNotification');
    const icon = document.getElementById('adminNotifIcon');
    const text = document.getElementById('adminNotifText');

    notif.className = 'admin-notification ' + type;
    text.textContent = message;
    icon.className = type === 'success'
      ? 'fas fa-check-circle'
      : type === 'error'
        ? 'fas fa-exclamation-circle'
        : 'fas fa-info-circle';

    notif.style.display = 'flex';
    requestAnimationFrame(() => notif.classList.add('show'));

    setTimeout(() => {
      notif.classList.remove('show');
      setTimeout(() => { notif.style.display = 'none'; }, 350);
    }, 3200);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  }

  // Close modals on overlay click
  document.getElementById('roleModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal('roleModal');
  });
  document.getElementById('statusModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal('statusModal');
  });

  document.getElementById('roleModalCancel').addEventListener('click', () => closeModal('roleModal'));
  document.getElementById('statusModalCancel').addEventListener('click', () => closeModal('statusModal'));

  // ============================================================
  // LOAD USERS
  // ============================================================

  window.loadUsers = async function loadUsers() {
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
    roleBadge.className = `role-badge ${user.role || 'user'}`;
    roleBadge.textContent = (user.role || 'user').toUpperCase();
    tdRole.appendChild(roleBadge);
    tr.appendChild(tdRole);

    // Status
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    const status = user.accountStatus || 'active';
    statusBadge.className = `status-badge ${status}`;
    statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${status.toUpperCase()}`;
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
    btnChangeRole.onclick = () => openRoleModal(uid, user);
    tdActions.appendChild(btnChangeRole);

    // Enable/Disable button
    const isDisabled = status === 'disabled';
    const btnToggleStatus = document.createElement('button');
    btnToggleStatus.className = `action-btn ${isDisabled ? 'btn-enable' : 'btn-delete'}`;
    btnToggleStatus.innerHTML = isDisabled
      ? '<i class="fas fa-check"></i> Enable'
      : '<i class="fas fa-ban"></i> Disable';
    btnToggleStatus.onclick = () => openStatusModal(uid, user);
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
      if (user.accountStatus === 'active' || !user.accountStatus) activeUsers++;
      if (user.accountStatus === 'disabled' || user.accountStatus === 'suspended') disabledCount++;
      if (user.role === 'admin') adminCount++;
    });

    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('activeUsers').textContent = activeUsers;
    document.getElementById('adminCount').textContent = adminCount;
    document.getElementById('disabledCount').textContent = disabledCount;
  }

  // ============================================================
  // ROLE MODAL
  // ============================================================

  let pendingRoleUid = null;
  let pendingRoleUser = null;

  function openRoleModal(uid, user) {
    pendingRoleUid = uid;
    pendingRoleUser = user;

    const currentRole = user.role || 'user';
    document.getElementById('roleModalDesc').textContent = `Changing role for: ${user.email}`;

    // Pre-select current role
    const radios = document.querySelectorAll('input[name="roleSelect"]');
    radios.forEach(r => {
      r.checked = r.value === currentRole;
    });

    // Highlight selected option
    updateRoleOptionHighlight();

    openModal('roleModal');
  }

  function updateRoleOptionHighlight() {
    document.querySelectorAll('.role-option').forEach(opt => opt.classList.remove('selected'));
    const checked = document.querySelector('input[name="roleSelect"]:checked');
    if (checked) checked.closest('.role-option').classList.add('selected');
  }

  document.querySelectorAll('input[name="roleSelect"]').forEach(radio => {
    radio.addEventListener('change', updateRoleOptionHighlight);
  });

  document.getElementById('roleModalConfirm').addEventListener('click', async () => {
    const selected = document.querySelector('input[name="roleSelect"]:checked');
    if (!selected) {
      showNotification('Please select a role.', 'error');
      return;
    }

    const newRole = selected.value;
    const currentRole = pendingRoleUser.role || 'user';

    if (newRole === currentRole) {
      showNotification('User already has this role.', 'info');
      closeModal('roleModal');
      return;
    }

    try {
      await database.ref('users/' + pendingRoleUid + '/role').set(newRole);
      await database.ref('users/' + pendingRoleUid + '/roleUpdatedAt').set(firebase.database.ServerValue.TIMESTAMP);

      closeModal('roleModal');
      showNotification(`Role successfully changed to ${newRole.toUpperCase()}.`, 'success');
      window.loadUsers();
    } catch (error) {
      console.error('Error changing role:', error);
      showNotification('Failed to change role: ' + error.message, 'error');
    }
  });

  // ============================================================
  // STATUS MODAL
  // ============================================================

  let pendingStatusUid = null;
  let pendingStatusUser = null;

  function openStatusModal(uid, user) {
    pendingStatusUid = uid;
    pendingStatusUser = user;

    const currentStatus = user.accountStatus || 'active';
    const willDisable = currentStatus === 'active';

    document.getElementById('statusModalTitle').textContent = willDisable ? 'Disable Account' : 'Enable Account';
    document.getElementById('statusModalDesc').textContent = willDisable
      ? `Are you sure you want to disable the account for ${user.email}? They will not be able to log in.`
      : `Are you sure you want to re-enable the account for ${user.email}?`;

    const icon = document.getElementById('statusModalIcon');
    const confirmBtn = document.getElementById('statusModalConfirm');
    const confirmIcon = document.getElementById('statusModalConfirmIcon');
    const confirmText = document.getElementById('statusModalConfirmText');

    if (willDisable) {
      icon.className = 'admin-modal-icon danger-icon';
      icon.querySelector('i').className = 'fas fa-ban';
      confirmBtn.className = 'admin-btn-confirm danger-confirm';
      confirmIcon.className = 'fas fa-ban';
      confirmText.textContent = 'Disable';
    } else {
      icon.className = 'admin-modal-icon success-icon';
      icon.querySelector('i').className = 'fas fa-check';
      confirmBtn.className = 'admin-btn-confirm success-confirm';
      confirmIcon.className = 'fas fa-check';
      confirmText.textContent = 'Enable';
    }

    openModal('statusModal');
  }

  document.getElementById('statusModalConfirm').addEventListener('click', async () => {
    const currentStatus = pendingStatusUser.accountStatus || 'active';
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    const action = newStatus === 'disabled' ? 'disabled' : 'enabled';

    try {
      await database.ref('users/' + pendingStatusUid + '/accountStatus').set(newStatus);
      await database.ref('users/' + pendingStatusUid + '/statusUpdatedAt').set(firebase.database.ServerValue.TIMESTAMP);

      closeModal('statusModal');
      showNotification(`Account successfully ${action}.`, 'success');
      window.loadUsers();
    } catch (error) {
      console.error('Error changing status:', error);
      showNotification('Failed to change status: ' + error.message, 'error');
    }
  });

  // ============================================================
  // UTILITIES
  // ============================================================

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  function displayNoUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748b;">No users found</td></tr>';
  }

  function displayError(message) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: #ef4444;"><i class="fas fa-exclamation-triangle"></i> ${message}</td></tr>`;
  }

  // Load on page load
  window.loadUsers();

  // Refresh every 30 seconds
  setInterval(window.loadUsers, 30000);

  console.log("✅ Admin.js fully loaded and ready");
});