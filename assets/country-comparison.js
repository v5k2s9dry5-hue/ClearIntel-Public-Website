'use strict';
(()=>{
 const $=id=>document.getElementById(id),first=$('compare-first'),second=$('compare-second'),button=$('compare-load'),copy=$('compare-copy'),download=$('compare-download'),status=$('compare-status'),out=$('compare-results');
 if(!first)return;
 const indicators = [
   ['SP.POP.TOTL', 'Population'],
   ['NY.GDP.MKTP.CD', 'GDP (current US$)'],
   ['AG.LND.TOTL.K2', 'Land area (km²)'],
   ['NY.GDP.MKTP.KD.ZG', 'GDP growth (%)'],
   ['FP.CPI.TOTL.ZG', 'Inflation (%)'],
   ['NY.GDP.PCAP.CD', 'GDP per capita (US$)'],
   ['SL.UEM.TOTL.ZS', 'Unemployment (% of labour force, ILO modelled)'],
   ['SP.DYN.LE00.IN', 'Life expectancy (years)'],
   ['IT.NET.USER.ZS', 'Internet use (% of population)'],
 ];
 const statusLabels = {
   available: 'Data available', stale: 'Older cached data', 'no-data': 'No published figures returned',
   checking: 'Source busy', unavailable: 'Source unavailable',
 };
 let comparison = null;
 const formatValue = new Intl.NumberFormat('en-GB', {maximumFractionDigits: 2});
 const countries=[...document.querySelectorAll('.directory li[data-code]')].map(li=>({code:li.dataset.code,name:li.querySelector('a span:last-child').textContent.trim()}));
 for(const select of [first,second])for(const item of countries)select.add(new Option(item.name,item.code));
 const params = new URLSearchParams(location.search);
 const hasCountry = code => countries.some(item => item.code === code);
 const requestedFirst = params.get('first')?.toUpperCase();
 const requestedSecond = params.get('second')?.toUpperCase();
 first.value = hasCountry(requestedFirst) ? requestedFirst : 'GB';
 second.value = hasCountry(requestedSecond) && requestedSecond !== first.value
   ? requestedSecond : first.value === 'US' ? 'GB' : 'US';
 const sync = () => {
   button.disabled = copy.disabled = !first.value || !second.value || first.value === second.value;
 };
 function changeCountries() {
   sync();
   comparison = null;
   download.hidden = true;
   out.replaceChildren();
   status.textContent = button.disabled ? 'Choose two different countries.' : 'Select Compare indicators to load the latest published figures.';
 }
 first.addEventListener('change', changeCountries);
 second.addEventListener('change', changeCountries);
 changeCountries();
 copy.addEventListener('click', async () => {
   const url = new URL('/countries', location.origin);
   url.searchParams.set('first', first.value);
   url.searchParams.set('second', second.value);
   url.hash = 'country-comparison';
   history.replaceState(history.state, '', url);
   try {
     await navigator.clipboard.writeText(url.href);
     status.textContent = 'Comparison link copied.';
   } catch {
     status.textContent = 'The comparison link is in your browser address bar.';
   }
 });
 async function fetchStats(code){
   try{const response=await fetch('/api/country-stats/'+encodeURIComponent(code),{signal:AbortSignal.timeout(12000),cache:'no-store'});return response.ok?await response.json():{status:'unavailable',observations:[]};}
   catch{return {status:'unavailable',observations:[]};}
 }
 function comparisonCountry(select, data) {
   return {
     code: select.value,
     name: select.selectedOptions[0].text,
     status: data.status,
     checkedAt: data.checked_at_utc || '',
     observations: new Map((data.observations || []).filter(item => Number.isFinite(item.value))
       .map(item => [item.indicator, item])),
   };
 }

 function renderComparison(countries) {
   const table = document.createElement('table');
   table.className = 'country-comparison-table';
   const heading = table.createTHead().insertRow();
   for (const value of ['Indicator', ...countries.map(country => country.name)]) {
     const th = document.createElement('th');
     th.scope = 'col';
     th.textContent = value;
     heading.append(th);
   }
   const body = table.createTBody();
   for (const [key, label] of indicators) {
     const row = body.insertRow();
     const th = document.createElement('th');
     th.scope = 'row';
     const source = document.createElement('a');
     source.href = 'https://data.worldbank.org/indicator/' + key;
     source.textContent = label;
     th.append(source);
     row.append(th);
     for (const country of countries) {
       const item = country.observations.get(key);
       const cell = row.insertCell();
       cell.textContent = item
         ? formatValue.format(item.value) + ' (' + item.year + ')' + (country.status === 'stale' ? ' · Older cache' : '')
         : 'Not available';
     }
   }
   out.replaceChildren(table);
   status.textContent = countries.map(country =>
     country.name + ' · ' + (statusLabels[country.status] || statusLabels.unavailable)).join(' / ');
 }

 button.addEventListener('click', async () => {
   if (button.disabled) return;
   button.disabled = copy.disabled = first.disabled = second.disabled = true;
   comparison = null;
   download.hidden = true;
   status.textContent = 'Checking latest published indicators…';
   try {
     const a = await fetchStats(first.value);
     const b = await fetchStats(second.value);
     comparison = [comparisonCountry(first, a), comparisonCountry(second, b)];
     renderComparison(comparison);
     download.hidden = !comparison.some(country => country.observations.size);
   } finally {
     first.disabled = second.disabled = false;
     sync();
   }
 });

 download.addEventListener('click', () => {
   if (!comparison || download.hidden) return;
   const rows = [['Country code', 'Country', 'Indicator code', 'Indicator', 'Value',
     'Observation year', 'Source status', 'Source checked (UTC)', 'World Bank source']];
   for (const country of comparison) {
     for (const [key, label] of indicators) {
       const item = country.observations.get(key);
       rows.push([country.code, country.name, key, label, item?.value ?? '', item?.year ?? '',
         country.status, country.checkedAt, 'https://data.worldbank.org/indicator/' + key]);
     }
   }
   const csv = rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n');
   const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {type: 'text/csv;charset=utf-8'}));
   const link = document.createElement('a');
   link.href = url;
   link.download = 'ClearIntel-country-comparison-' + comparison.map(country => country.code).join('-') + '.csv';
   document.body.append(link);
   link.click();
   link.remove();
   setTimeout(() => URL.revokeObjectURL(url), 1000);
 });
})();
