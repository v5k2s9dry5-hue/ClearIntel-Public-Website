(() => {
  'use strict';
  const source=document.getElementById('national-alert-source'),load=document.getElementById('national-alert-load'),
    status=document.getElementById('national-alert-status'),list=document.getElementById('national-alert-list');
  if(!source||!load||!status||!list)return;
  let version=0,controller;
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const utc=value=>{const date=new Date(value||NaN);return Number.isFinite(date.getTime())?date.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Unknown';};
  source.addEventListener('change',()=>{
    version++;controller?.abort();list.replaceChildren();load.disabled=false;
    status.textContent='Not checked. Loads only on request.';
  });
  load.addEventListener('click',async()=>{
    const current=++version;controller?.abort();controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    load.disabled=true;status.textContent='Checking official source…';list.replaceChildren();
    try{
      const response=await fetch('/api/national-alerts/'+encodeURIComponent(source.value),{signal:controller.signal});
      if(!response.ok)throw Error('Unavailable');
      const data=await response.json();
      if(current!==version)return;
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
        list.append(item);
      }
    }catch(_){if(current===version)status.textContent='Official warning source unavailable. Check the authority directly.';}
    finally{clearTimeout(timer);if(current===version)load.disabled=false;}
  });
})();
