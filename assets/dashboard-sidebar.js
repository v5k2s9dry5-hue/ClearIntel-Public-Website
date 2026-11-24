'use strict';
(() => {
  const dashboard = document.getElementById('top');
  const toggle = document.getElementById('sidebar-toggle');
  const preference = 'clearintel.sidebar.cinematic.v2.collapsed';
  function setCollapsed(collapsed) {
    dashboard.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const text = toggle.querySelector('.workspace-control-text');
    if (text) text.textContent = collapsed ? 'Show sidebar' : 'Hide sidebar';
  }
  let collapsed = true;
  try { collapsed = localStorage.getItem(preference) !== 'false'; } catch {}
  setCollapsed(collapsed);
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    setCollapsed(collapsed);
    try { localStorage.setItem(preference, String(collapsed)); } catch {}
  });
})();
