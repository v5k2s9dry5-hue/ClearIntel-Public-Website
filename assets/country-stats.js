'use strict';
(()=>{
 const button=document.getElementById('country-stats-load');
 if(!button)return;
 const list=document.getElementById('country-stats-results'),status=document.getElementById('country-stats-status');
 button.addEventListener('click',async()=>{
   button.disabled=true;status.textContent='Checking World Bank indicators…';
   try{
     const response=await fetch('/api/country-stats/'+encodeURIComponent(button.dataset.code),{cache:'no-store',signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw Error('Unavailable');
     const data=await response.json();
     if(!['available','stale','no-data'].includes(data.status)){
       status.textContent=data.status==='checking'?'Another check is in progress. Try again shortly.':'Statistics unavailable; open World Bank Data directly.';
       return;
     }
     list.replaceChildren();
     for(const row of data.observations||[]){
       if(!Number.isFinite(row.value)||!/^\d{4}$/.test(row.year)||!/^https:\/\/data\.worldbank\.org\/indicator\/[A-Z0-9.]+$/.test(row.source_url))continue;
       const dt=document.createElement('dt'),dd=document.createElement('dd'),link=document.createElement('a');
       dt.textContent=row.label+' · '+row.year;
       link.href=row.source_url;link.textContent=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(row.value);dd.append(link);list.append(dt,dd);
     }
     status.textContent=data.status==='no-data'?'No matching World Bank observations returned.':(data.status==='stale'?'Older cached data — refresh unavailable.':'Latest available published observations. Years can differ by indicator.')+' Not live estimates.';
   }catch{status.textContent='Statistics unavailable; open World Bank Data directly.';}
   finally{button.disabled=false;}
 });
})();
