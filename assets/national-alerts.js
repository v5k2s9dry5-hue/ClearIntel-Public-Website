(() => {
  'use strict';
  const source=document.getElementById('national-alert-source'),load=document.getElementById('national-alert-load'),
    status=document.getElementById('national-alert-status'),list=document.getElementById('national-alert-list');
  if(!source||!load||!status||!list)return;
  const filters=document.getElementById('national-alert-filters'),query=document.getElementById('national-alert-query'),severity=document.getElementById('national-alert-severity'),reset=document.getElementById('national-alert-reset'),count=document.getElementById('national-alert-filter-count');
  const retryDelay=3000;
  const maxRetries=3;
  let version=0,controller,entries=[];
  function clearFilters(){entries=[];filters.hidden=true;query.value='';severity.replaceChildren(new Option('All severities',''));count.textContent='';}
  function applyFilters(){const term=query.value.trim().toLowerCase();let shown=0;for(const {row,item} of entries){const visible=(!severity.value||row.severity===severity.value)&&[row.area,row.title,row.severity].some(value=>String(value||'').toLowerCase().includes(term));item.hidden=!visible;if(visible)shown++;}count.textContent=shown+' of '+entries.length+' displayed warnings match.';reset.disabled=!term&&!severity.value;}
  query.addEventListener('input',applyFilters);severity.addEventListener('change',applyFilters);reset.addEventListener('click',()=>{query.value='';severity.value='';applyFilters();query.focus();});
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const utc=value=>{const date=new Date(value||NaN);return Number.isFinite(date.getTime())?date.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Unknown';};
  source.addEventListener('change',()=>{
    version++;controller?.abort();list.replaceChildren();clearFilters();load.disabled=false;
    status.textContent='Not checked. Loads only on request.';
  });
  load.addEventListener('click',async()=>{
    const current=++version;
    controller?.abort();
    const request=new AbortController();
    controller=request;
    const endpoint='/api/national-alerts/'+encodeURIComponent(source.value);
    const timer=setTimeout(()=>request.abort(),15000);
    load.disabled=true;status.textContent='Checking official source…';list.replaceChildren();clearFilters();
    try{
      let data;
      for(let attempt=0;attempt<=maxRetries;attempt++){
        if(attempt)await new Promise(resolve=>setTimeout(resolve,retryDelay));
        if(current!==version)return;
        const response=await fetch(endpoint,{signal:request.signal});
        if(!response.ok)throw Error('Unavailable');
        data=await response.json();
        if(current!==version)return;
        if(data.status!=='checking')break;
      }
      if(!Array.isArray(data.alerts))throw Error('Invalid feed');
      if(data.status==='checking'||data.status==='unavailable'){
        status.textContent='Source '+data.status+'. No current warning count is available.';return;
      }
      if(!['available','stale'].includes(data.status))throw Error('Invalid status');
      status.textContent=(data.status==='stale'?'Previous snapshot — refresh unavailable. ':'Source checked. ')+
        utc(data.checked_at_utc)+' · Showing '+data.alerts.length+' of '+data.returned_count+' parsed warnings.';
      if(!data.alerts.length)status.textContent+=' No warnings returned by this check; not an all-clear.';
      for(const row of data.alerts){
        const item=document.createElement('li');
        const heading=node('strong',row.title);
        try{
          const url=new URL(row.url);
          if(url.protocol==='https:'&&!url.username&&!url.password&&['environment.data.gov.uk','api.weather.gov'].includes(url.hostname)){
            const a=node('a',row.title);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';item.append(a);
          }else item.append(heading);
        }catch(_){item.append(heading);}
        item.append(node('span',row.severity+' · '+row.area),node('span',row.time_basis+': '+(row.time_utc?utc(row.time_utc):row.source_time?String(row.source_time).replace('T',' ')+' (source timezone unspecified)':'Unknown')+(row.expires_utc?' · Expires: '+utc(row.expires_utc):'')));
        entries.push({row,item});list.append(item);
      }
      if(entries.length){for(const value of [...new Set(entries.map(entry=>entry.row.severity).filter(Boolean))].sort())severity.add(new Option(value,value));filters.hidden=false;applyFilters();}
    }catch(_){if(current===version)status.textContent='Official warning source unavailable. Check the authority directly.';}
    finally{clearTimeout(timer);if(current===version)load.disabled=false;}
  });
})();
