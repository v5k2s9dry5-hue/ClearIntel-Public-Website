(() => {
  'use strict';

  // The timeline only uses public feed timestamps. It does not infer incident times from news headlines.
  const mount = document.getElementById('report-timeline');
  if (!mount) return;
  const fullTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
  const shortDay = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: '2-digit', month: 'short'});
  const shortHour = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

  function node(tag, className, content) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  }

  function render(options) {
    const {events, timeField, windowDays, selectedStart, onSelect, label, ready} = options;
    const hours = Number(windowDays) === 1;
    const step = hours ? 2 * 3600000 : 86400000;
    const now = Date.now();
    const cutoff = now - Number(windowDays) * 86400000;
    const first = Math.floor(cutoff / step) * step;
    const last = Math.floor(now / step) * step;
    const counts = new Map();
    for (const event of events) {
      const timestamp = Number(event[timeField]);
      if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now) continue;
      const key = Math.floor(timestamp / step) * step;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    const focusedKey = document.activeElement?.dataset.timelineStart;
    const clearFocused = document.activeElement?.id === 'timeline-clear';

    const heading = node('div', 'timeline-heading');
    const title = node('strong', '', 'Event timeline');
    const clear = node('button', 'globe-control timeline-clear', 'All times');
    clear.type = 'button';
    clear.id = 'timeline-clear';
    clear.disabled = selectedStart === null;
    clear.addEventListener('click', () => onSelect(null));
    heading.append(title, clear);

    const description = node('p', 'timeline-description',
      (hours ? 'Two-hour' : 'Daily') + ' intervals · ' + label + ' (UTC)' +
      (ready ? '' : ' · Waiting for feed'));
    const bars = node('div', 'timeline-bars');
    bars.setAttribute('role', 'group');
    bars.setAttribute('aria-label', 'Filter visible reports by observation or event time');
    const total = events.length;
    const summary = node('p', 'timeline-summary',
      selectedStart === null ? 'All ' + total + ' reports shown on the map' :
      'Time filter applied to the map and feed');
    const buttons = new Map();

    for (let start = first; start <= last; start += step) {
      const count = counts.get(start) || 0;
      const end = Math.min(start + step, now);
      const selected = start === selectedStart;
      const button = node('button', 'timeline-column' + (selected ? ' is-selected' : ''));
      button.type = 'button';
      button.dataset.timelineStart = String(start);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', fullTime.format(Math.max(start, cutoff)) + ' to ' +
        fullTime.format(end) + ' UTC: ' + count + ' ' + label +
        (count === 1 ? ' report' : ' reports'));
      button.title = button.getAttribute('aria-label');
      button.disabled = !ready || (count === 0 && !selected);
      const number = node('span', 'timeline-count', String(count));
      const bar = node('span', 'timeline-bar');
      bar.style.height = Math.max(2, Math.round(46 * count / max)) + 'px';
      bar.setAttribute('aria-hidden', 'true');
      const tick = node('span', 'timeline-tick', hours ? shortHour.format(start) : shortDay.format(start));
      button.append(number, bar, tick);
      button.addEventListener('click', () => onSelect(selected ? null : start));
      bars.append(button);
      buttons.set(String(start), button);
    }
    mount.replaceChildren(heading, description, bars, summary);
    if (focusedKey && buttons.has(focusedKey)) buttons.get(focusedKey).focus({preventScroll: true});
    else if (clearFocused) clear.focus({preventScroll: true});
  }

  window.ClearIntelTimeline = {render};
})();