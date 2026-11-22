'use strict';
(() => {
  const dashboard = document.getElementById('top');
  const toggle = document.getElementById('sidebar-toggle');
  const preference = 'clearintel.sidebar.collapsed';
  function setCollapsed(collapsed) {
    dashboard.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? 'Show sidebar' : 'Hide sidebar';
  }
  let collapsed = false;
  try { collapsed = localStorage.getItem(preference) === 'true'; } catch {}
  setCollapsed(collapsed);
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    setCollapsed(collapsed);
    try { localStorage.setItem(preference, String(collapsed)); } catch {}
  });
})();
