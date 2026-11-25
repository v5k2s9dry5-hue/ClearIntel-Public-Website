'use strict';
(()=>{
 const $=id=>document.getElementById(id),first=$('compare-first'),second=$('compare-second'),button=$('compare-load'),copy=$('compare-copy'),status=$('compare-status'),out=$('compare-results');
 if(!first)return;
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
 button.addEventListener('click',async()=>{
   const left=first.value,right=second.value;if(left===right)return;
   button.disabled=copy.disabled=first.disabled=second.disabled=true;status.textContent='Checking latest published indicators…';
   try{
     const a = await fetchStats(left);
     const b = await fetchStats(right);
     const table=document.createElement('table');table.className='country-comparison-table';
     const heading=table.createTHead().insertRow();
     for(const value of ['Indicator',first.selectedOptions[0].text,second.selectedOptions[0].text]){const th=document.createElement('th');th.scope='col';th.textContent=value;heading.append(th);}
     const body=table.createTBody(),keys=['SP.POP.TOTL','NY.GDP.MKTP.CD','AG.LND.TOTL.K2','NY.GDP.MKTP.KD.ZG','FP.CPI.TOTL.ZG','NY.GDP.PCAP.CD','SL.UEM.TOTL.ZS','SP.DYN.LE00.IN','IT.NET.USER.ZS'],labels=['Population','GDP (current US$)','Land area (km²)','GDP growth (%)','Inflation (%)','GDP per capita (US$)','Unemployment (% of labour force, ILO modelled)','Life expectancy (years)','Internet use (% of population)'];
     keys.forEach((key,i)=>{
       const row=body.insertRow(),th=document.createElement('th');th.scope='row';const source=document.createElement('a');source.href='https://data.worldbank.org/indicator/'+key;source.textContent=labels[i];th.append(source);row.append(th);
       for(const data of [a,b]){const item=(data.observations||[]).find(x=>x.indicator===key),cell=row.insertCell();cell.textContent=item&&Number.isFinite(item.value)?new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(item.value)+' ('+item.year+')'+(data.status==='stale'?' · Older cache':''):'Not available';}
     });
     out.replaceChildren(table);status.textContent='World Bank published observations · '+left+': '+a.status+' · '+right+': '+b.status+'. Not live estimates.';
   }finally{first.disabled=second.disabled=false;sync();}
 });
})();
