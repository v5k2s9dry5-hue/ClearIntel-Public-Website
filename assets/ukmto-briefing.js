'use strict';
(() => {
  const panel = document.getElementById('ukmto-reports');
  const layer = document.getElementById('globe-layer');
  if (!panel || !layer) return;
  const source = 'https://www.ukmto.org/recent-incidents';
  let loaded = false;
  const add = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value != null) node.textContent = value;
    return node;
  };
  function render(data) {
    if (!Array.isArray(data?.events) || !/^2026-11-\d\d$/.test(data.curated_on_utc)) throw Error('Invalid UKMTO briefing');
    const heading = add('h3', '', 'UKMTO published incident notices');
    const time = add('p', 'ukmto-briefing-status',
      'Selected UKMTO reports, manually checked ' + data.curated_on_utc +
      '. NOT live or automatically refreshed; check original bulletins for updates.');
    const list = add('ol', 'ukmto-report-list');
    for (const item of data.events.slice(0, 12)) {
      if (!/^\d{1,4}-\d\d$/.test(item.id) ||
          !['Attack', 'Advisory', 'Suspicious activity', 'Attempted boarding'].includes(item.type) ||
          !Number.isFinite(Date.parse(item.at_utc))) continue;
      let linkUrl;
      try {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' || url.hostname !== 'www.ukmto.org' ||
            url.username || url.password) continue;
        linkUrl = url.href;
      } catch (_) { continue; }
      const li = add('li', 'ukmto-report');
      const meta = add('div', 'ukmto-report-meta',
        'UKMTO ' + item.id + ' · ' + item.type + ' · ' +
        new Date(item.at_utc).toLocaleString('en-GB',
          {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}) + ' UTC');
      const title = add('a', 'ukmto-report-link', String(item.title).slice(0, 180));
      title.href = linkUrl;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      const region = add('span', 'ukmto-report-region', String(item.region).slice(0, 110));
      const summary = add('p', 'ukmto-report-summary', String(item.summary).slice(0, 350));
      li.append(meta, title, region, summary);
      list.append(li);
    }
    if (!list.children.length) throw Error('No valid UKMTO records');
    const disclaimer = add('p', 'ukmto-briefing-status',
      'Source: UKMTO, © Crown copyright, Open Government Licence v3.0. These are public reports, not independently verified events or maritime navigation advice. No vessel positions are tracked.');
    const original = add('a', '', 'View the current official UKMTO incident list');
    original.href = source;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const licence = add('a', '', 'OGL attribution');
    licence.href = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
    licence.target = '_blank';
    licence.rel = 'noopener noreferrer';
    const links = add('p', 'ukmto-briefing-links');
    links.append(original, document.createTextNode(' · '), licence);
    panel.replaceChildren(heading, time, list, disclaimer, links);
  }
  async function load() {
    if (loaded) return;
    loaded = true;
    panel.replaceChildren(add('p', 'ukmto-briefing-status', 'Loading selected UKMTO incident notices…'));
    try {
      const response = await fetch('/assets/ukmto-incidents.json', {cache:'no-cache'});
      if (!response.ok) throw Error('Unavailable');
      render(await response.json());
    } catch (_) {
      loaded = false;
      panel.replaceChildren(add('p', 'ukmto-briefing-status',
        'The saved UKMTO incident briefing is unavailable. Please consult the official reports.'));
      const a = add('a', '', 'Open official UKMTO incident reports');
      a.href = source; a.target = '_blank'; a.rel = 'noopener noreferrer';
      panel.append(a);
    }
  }
  function onLayer() {
    if (layer.value === 'maritime') load();
  }
  layer.addEventListener('change', onLayer);
  onLayer();
})();
