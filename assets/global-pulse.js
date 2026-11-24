'use strict';
(() => {
  const root=document.getElementById('global-pulse');
  if(!root)return;
  const layer=document.getElementById('globe-layer');
  const list=document.getElementById('pulse-latest');
  const status=document.getElementById('pulse-latest-status');
  const snapshots={};
  const sources={
    earthquakes:{label:'USGS',field:'occurred_at_ms',id:'pulse-quakes',unit:'earthquakes',time:'generated_at_ms'},
    wildfires:{label:'NASA EONET',field:'observed_at_ms',id:'pulse-fires',unit:'wildfire observations',time:'checked_at_ms'}
  };
  function safeUrl(value){
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
  }
  function render(){
    const now=Date.now(), recent=[];
    for(const [key,source] of Object.entries(sources)){
      const snap=snapshots[key];
      if(!snap)continue;
      const node=document.getElementById(source.id);
      if(!Array.isArray(snap.events)){node.textContent=source.label+' · Unavailable';continue;}
      const age=now-Number(snap[source.time]);
      const stale=snap.stale||snap.unavailable||!Number.isFinite(age)||age< -60000||age>300000;
      const events=snap.events.filter(e=>e&&Number.isFinite(e[source.field])&&e[source.field]>=now-86400000&&e[source.field]<=now);
      node.textContent=source.label+' · '+events.length+' '+source.unit+(stale?' · Older snapshot':' · Last 24h');
      for(const e of events){
        const url=safeUrl(e.url);
        if(!url)continue;
        const title=key==='earthquakes'?'M'+String(e.magnitude)+' earthquake — '+String(e.place):String(e.title);
        recent.push({time:e[source.field],title:title.slice(0,180),url,source:source.label,stale});
      }
    }
    recent.sort((a,b)=>b.time-a.time);
    list.replaceChildren();
    for(const row of recent.slice(0,3)){
      const li=document.createElement('li'), link=document.createElement('a'), meta=document.createElement('small');
      link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
      meta.textContent=row.source+' · '+new Date(row.time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC'+(row.stale?' · Older snapshot':'');
      li.append(link,meta);list.append(li);
    }
    status.textContent=recent.length?'Recent source observations (not a global news feed).':Object.keys(snapshots).length?'No recent linked observations received; coverage may be incomplete.':'Waiting for observations from connected sources.';
  }
  for(const key of Object.keys(sources)){
    window.addEventListener('clearintel:'+ (key==='earthquakes'?'earthquake':'wildfire')+'-snapshot',event=>{
      const data=event.detail||{};
      snapshots[key]=Array.isArray(data.events)?data:snapshots[key]?{...snapshots[key],unavailable:true}:data;
      render();
    });
  }
  for(const btn of root.querySelectorAll('[data-pulse-layer]')){
    btn.addEventListener('click',()=>{
      layer.value=btn.dataset.pulseLayer;
      layer.dispatchEvent(new Event('change',{bubbles:true}));
      const feed=btn.hasAttribute('data-pulse-feed');
      if(matchMedia('(max-width:860px)').matches)document.getElementById(feed?'dashboard-feed-tab':'dashboard-map-tab').click();
      const target=document.getElementById(feed?'dashboard-feed-heading':'dashboard-map-heading');
      target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});
    });
  }
  for(const link of document.querySelectorAll('a[href="#dashboard-map"],a[href="#dashboard-feed"]')){
    link.addEventListener('click',()=>{
      if(matchMedia('(max-width:860px)').matches)document.getElementById(link.hash==='#dashboard-feed'?'dashboard-feed-tab':'dashboard-map-tab').click();
    });
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
})();
