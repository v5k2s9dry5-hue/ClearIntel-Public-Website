'use strict';
(() => {
  const panel = document.getElementById('country-brief');
  const country = {id: panel.dataset.code, place: panel.dataset.place};
  const interval = 5 * 60 * 1000;
  let lastData = null;
  let due = 0;
  let pending = false;
  let timer;
  renderCountryCard(panel, country, null);

  function schedule() {
    clearTimeout(timer);
    if (!document.hidden && !pending) timer = setTimeout(refresh, Math.max(0, due - Date.now()));
  }

  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    let delay = interval;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/country-news/' + encodeURIComponent(country.id), {signal: controller.signal});
      if (response.status === 429) {
        delay = Math.max(interval, Number(response.headers.get('Retry-After') || 0) * 1000);
        renderCountryCard(panel, country, {data: lastData, failed: true, message: 'Country headlines are rate limited. ' + retryMessage(response)});
      } else {
        if (!response.ok) throw new Error();
        lastData = await response.json();
        renderCountryCard(panel, country, {data: lastData});
      }
    } catch {
      renderCountryCard(panel, country, {data: lastData, failed: true});
    } finally {
      clearTimeout(timeout);
      pending = false;
      due = Date.now() + delay;
      schedule();
    }
  }

  document.addEventListener('visibilitychange', schedule);
  schedule();
})();
