(() => {
  'use strict';
  const source=document.getElementById('national-alert-source'),load=document.getElementById('national-alert-load'),
    status=document.getElementById('national-alert-status'),list=document.getElementById('national-alert-list');
  if(!source||!load||!status||!list)return;
  const filters=document.getElementById('national-alert-filters'),query=document.getElementById('national-alert-query'),severity=document.getElementById('national-alert-severity'),reset=document.getElementById('national-alert-reset'),count=document.getElementById('national-alert-filter-count');
  let version=0,controller,entries=[],active=false,inView=false,busy=false,due=0,retryTimer,hasSnapshot=false;
  const panel=document.getElementById('national-alerts');
  function schedule(delay){clearTimeout(retryTimer);due=Date.now()+delay;if(active&&inView&&!document.hidden)retryTimer=setTimeout(()=>check(),delay);}
  function clearFilters(){entries=[];filters.hidden=true;query.value='';severity.replaceChildren(new Option('All severities',''));count.textContent='';}
  function applyFilters(){const term=query.value.trim().toLowerCase();let shown=0;for(const {row,item} of entries){const visible=(!severity.value||row.severity===severity.value)&&[row.area,row.title,row.severity].some(value=>String(value||'').toLowerCase().includes(term));item.hidden=!visible;if(visible)shown++;}count.textContent=shown+' of '+entries.length+' displayed warnings match.';reset.disabled=!term&&!severity.value;}
  query.addEventListener('input',applyFilters);severity.addEventListener('change',applyFilters);reset.addEventListener('click',()=>{query.value='';severity.value='';applyFilters();query.focus();});
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const utc=value=>{const date=new Date(value||NaN);return Number.isFinite(date.getTime())?date.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Unknown';};
  source.addEventListener('change',()=>{
    version++;controller?.abort();clearTimeout(retryTimer);busy=false;hasSnapshot=false;list.replaceChildren();clearFilters();load.disabled=false;due=0;
    if(active)check();else status.textContent='Waiting to check official source…';
  });
  async function check(){
    if(busy)return;
    active=true;busy=true;clearTimeout(retryTimer);
    const current=++version;controller?.abort();controller=new AbortController();
    const requestController=controller;
    const timer=setTimeout(()=>requestController.abort(),20000);
    load.disabled=true;status.textContent=hasSnapshot?'Refreshing official source… Previous results retained.':'Checking official source…';
    try{
      const response=await fetch('/api/national-alerts/'+encodeURIComponent(source.value),{signal:requestController.signal,cache:'no-store'});
      if(!response.ok)throw Error('Unavailable');
      const data=await response.json();
      if(current!==version)return;
      if(!Array.isArray(data.alerts))throw Error('Invalid feed');
      if(data.status==='checking'||data.status==='unavailable'){
        status.textContent='Source '+data.status+'. '+(hasSnapshot?'Previous results retained; current status unknown.':'No current warning count is available.')+' Retrying automatically.';
        schedule(data.status==='checking'?3000:60000);return;
      }
      if(!['available','stale'].includes(data.status))throw Error('Invalid status');
      const priorQuery=query.value,priorSeverity=severity.value,focused=list.contains(document.activeElement)?document.activeElement.href:null;
      entries=[];list.replaceChildren();severity.replaceChildren(new Option('All severities',''));filters.hidden=true;hasSnapshot=true;
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
        if(focused&&item.firstElementChild?.href===focused)item.firstElementChild.focus({preventScroll:true});
      }
      if(entries.length){for(const value of [...new Set(entries.map(entry=>entry.row.severity).filter(Boolean))].sort())severity.add(new Option(value,value));query.value=priorQuery;severity.value=[...severity.options].some(option=>option.value===priorSeverity)?priorSeverity:'';filters.hidden=false;applyFilters();}
      schedule(data.status==='stale'?60000:300000);
    }catch(_){if(current===version){status.textContent='Official warning source unavailable. '+(hasSnapshot?'Previous results retained; current status unknown. ':'')+'Retrying automatically. Check the authority directly.';schedule(60000);}}
    finally{clearTimeout(timer);if(current===version){busy=false;load.disabled=false;}}
  }
  load.addEventListener('click',()=>check());
  function resume(){if(!inView||document.hidden)return;if(!active||Date.now()>=due)check();else schedule(Math.max(0,due-Date.now()));}
  if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);if(inView)resume();else clearTimeout(retryTimer);});observer.observe(panel);}else{inView=true;resume();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(retryTimer);else resume();});
})();
