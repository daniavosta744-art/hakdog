document.addEventListener('DOMContentLoaded', function () {
  if (typeof renderNavMenu === 'function') {
    renderNavMenu('sidebar-nav'); // ← change 'sidebar-nav' to match your <ul> id
  } else {
    console.warn('nav-menu.js: renderNavMenu() not found. Is rolemanager.js loaded first?');
  }
});