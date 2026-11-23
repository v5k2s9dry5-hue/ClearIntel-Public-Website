'use strict';
(() => {
  const root = document.getElementById('activity-pulse');
  if (!root) return;
  const bars = document.getElementById('activity-pulse-bars');
  const status = document.getElementById('activity-pulse-status');
  const summary = document.getElementById('activity-pulse-total');
  const checked = document.getElementById('activity-pulse-check');
  let snapshot = null;
  const label = t => new Date(t).toLocaleTimeString('en-GB', {timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
  function draw() {
    if (!snapshot) {
      status.textContent = 'Waiting for USGS feed';
      summary.textContent = '—';
      checked.textContent = 'No source observation yet';
      return;
    }
    const now = Date.now();
    const binWidth = 4 * 3600000;
    const start = now - 6 * binWidth;
    const counts = Array(6).fill(0);
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    for (const event of events) {
      const t = Number(event.occurred_at_ms);
      if (!Number.isFinite(t) || t < start || t > now) continue;
      const bin = Math.min(5, Math.floor((t - start) / binWidth));
      counts[bin] += 1;
    }
    const total = counts.reduce((a,b)=>a+b,0);
    const max = Math.max(...counts,1);
    const fragment = document.createDocumentFragment();
    for (let i=0;i<6;i++) {
      const time = start + i * binWidth;
      const col = document.createElement('div');
      col.className = 'activity-pulse-bin';
      const value = document.createElement('span');
      value.className = 'activity-pulse-value';
      value.textContent = String(counts[i]);
      const bar = document.createElement('div');
      bar.className = 'activity-pulse-bar';
      bar.style.height = (counts[i] ? Math.max(8,Math.round(66*counts[i]/max)) : 0)+'px';
      col.title = label(time) + '–' + label(time + binWidth) + ' UTC · ' + counts[i] + ' reported M4.5+ earthquakes';
      const tick = document.createElement('span');
      tick.className = 'activity-pulse-tick';
      tick.textContent = label(time);
      col.append(value,bar,tick);
      fragment.append(col);
    }
    bars.replaceChildren(fragment);
    bars.setAttribute('aria-label', 'USGS M4.5+ recorded earthquakes in six 4-hour UTC buckets: ' + counts.join(', '));
    summary.textContent = String(total);
    const observationAge = now - Number(snapshot.generated_at_ms);
    const validDate = Number.isFinite(observationAge) && observationAge >= -60000;
    const stale = snapshot.unavailable || snapshot.stale || !validDate || observationAge > 5*60000;
    status.textContent = stale ? 'Source delayed / older snapshot' : 'USGS feed checked';
    checked.textContent = validDate ? 'Source generated ' + new Date(snapshot.generated_at_ms).toLocaleString('en-GB',
      {timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}) + ' UTC' : 'Source generation time unavailable';
  }
  window.addEventListener('clearintel:earthquake-snapshot', event=>{
    if (Array.isArray(event.detail?.events)) snapshot = event.detail;
    else if (snapshot && event.detail?.unavailable) snapshot = {...snapshot, unavailable:true};
    draw();
  });
  draw();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)draw();});
})();
