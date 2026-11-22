'use strict';
(() => {
  const map = document.getElementById('dashboard-map');
  const button = document.getElementById('map-expand');
  const dialog = document.getElementById('expanded-map');
  if (!dialog.showModal) return;
  const anchor = document.createComment('Map position');
  map.before(anchor);
  button.hidden = false;
  button.addEventListener('click', () => {
    if (dialog.open) {
      dialog.close();
      return;
    }
    dialog.append(map);
    button.textContent = 'Close expanded map';
    dialog.showModal();
    button.focus();
  });
  dialog.addEventListener('close', () => {
    anchor.after(map);
    button.textContent = 'Expand map';
    button.focus({preventScroll: true});
  });
})();
