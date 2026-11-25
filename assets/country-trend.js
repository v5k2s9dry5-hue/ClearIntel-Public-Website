'use strict';
(() => {
  const panel = document.getElementById('country-trend');
  if (!panel) return;
  const indicator = document.getElementById('trend-indicator');
  const button = document.getElementById('trend-load');
  const status = document.getElementById('trend-status');
  const results = document.getElementById('trend-results');
  const valueFormat = new Intl.NumberFormat('en-GB', {maximumFractionDigits: 2});
  const axisFormat = new Intl.NumberFormat('en-GB', {notation: 'compact', maximumFractionDigits: 2});

  function svgNode(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function trendChart(rows, label) {
    const first = Number(rows[0].year);
    const last = Number(rows.at(-1).year);
    const values = rows.map(row => row.value);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const left = 61, right = 380, top = 14, bottom = 139;
    const x = year => left + (year - first) * (right - left) / (last - first);
    const y = value => maximum === minimum ? (top + bottom) / 2
      : bottom - (value - minimum) * (bottom - top) / (maximum - minimum);
    const chart = svgNode('svg', {
      viewBox: '0 0 397 163',
      class: 'country-trend-chart',
      role: 'img',
      'aria-label': label + ' by year, ' + first + ' to ' + last + '. Exact values are in the table below.',
    });
    const ticks = minimum === maximum ? [minimum] : [minimum, (minimum + maximum) / 2, maximum];
    for (const value of ticks) {
      const position = y(value);
      chart.append(
        svgNode('line', {x1: left, x2: right, y1: position, y2: position, class: 'trend-grid'}),
        svgNode('text', {x: left - 6, y: position + 4, 'text-anchor': 'end'}, axisFormat.format(value))
      );
    }
    chart.append(
      svgNode('text', {x: left, y: 157, 'text-anchor': 'middle'}, first),
      svgNode('text', {x: right, y: 157, 'text-anchor': 'middle'}, last)
    );
    let previous = null;
    for (const row of rows) {
      const year = Number(row.year);
      const point = {year, x: x(year), y: y(row.value)};
      if (previous && year === previous.year + 1) {
        chart.append(svgNode('line', {
          x1: previous.x, y1: previous.y, x2: point.x, y2: point.y, class: 'trend-connector'
        }));
      }
      chart.append(svgNode('circle', {cx: point.x, cy: point.y, r: 3.5, class: 'trend-point'}));
      previous = point;
    }
    return chart;
  }

  function trendTable(rows, label) {
    const table = document.createElement('table');
    table.className = 'country-comparison-table';
    const heading = table.createTHead().insertRow();
    for (const title of ['Year', label]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = title;
      heading.append(th);
    }
    const body = table.createTBody();
    for (const observation of rows) {
      const row = body.insertRow();
      row.insertCell().textContent = observation.year;
      row.insertCell().textContent = valueFormat.format(observation.value);
    }
    return table;
  }

  indicator.addEventListener('change', () => {
    results.replaceChildren();
    status.textContent = 'Select Load trend to check this indicator.';
  });

  button.addEventListener('click', async () => {
    const key = indicator.value;
    const label = indicator.selectedOptions[0].text;
    button.disabled = indicator.disabled = true;
    status.textContent = 'Checking annual World Bank observations…';
    try {
      const response = await fetch('/api/country-trend/' + encodeURIComponent(panel.dataset.code) + '/' +
        encodeURIComponent(key), {signal: AbortSignal.timeout(12000), cache: 'no-store'});
      if (!response.ok) throw Error('Trend unavailable');
      const data = await response.json();
      if (data.status === 'checking') {
        status.textContent = 'Another source check is in progress. Try again shortly.';
        return;
      }
      if (!['available', 'stale', 'no-data'].includes(data.status)) throw Error('Trend unavailable');
      const rows = data.observations.filter(row =>
        row.indicator === key && /^\d{4}$/.test(row.year) && Number.isFinite(row.value)
      ).sort((a, b) => a.year.localeCompare(b.year));
      results.replaceChildren();
      if (!rows.length) {
        status.textContent = 'No annual figures were returned for this indicator.';
        return;
      }
      if (rows.length > 1) results.append(trendChart(rows, label));
      const link = document.createElement('a');
      link.href = 'https://data.worldbank.org/indicator/' + key;
      link.textContent = 'World Bank indicator source';
      results.append(trendTable(rows, label), link);
      status.textContent = data.status === 'stale' ? 'Older cached observations. Refresh unavailable.'
        : rows.length + ' annual observations from World Bank Data.';
    } catch {
      status.textContent = results.children.length ? 'Refresh unavailable. Showing the previously loaded observations.'
        : 'Annual figures unavailable. Try again or open World Bank Data.';
    } finally {
      button.disabled = indicator.disabled = false;
    }
  });
})();
