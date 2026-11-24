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
  const chart=document.getElementById('pulse-chart');
  const chartSeries=document.getElementById('pulse-series');
  const chartAxis=document.getElementById('pulse-axis');
  const chartNote=document.getElementById('pulse-chart-note');
  const NS='http://www.w3.org/2000/svg';
  function drawChart(series,now){
    const peak=Math.max(1,...series.flatMap(s=>s.bins));
    chartSeries.replaceChildren();
    chartAxis.replaceChildren();
    const x=i=>8+i*284/5, y=n=>78-n*66/peak;
    const format=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
    for(let i=0;i<6;i++){
      const tick=document.createElement('span');
      tick.textContent=format(now-(6-i)*14400000);
      chartAxis.append(tick);
    }
    for(const s of series){
      const line=document.createElementNS(NS,'polyline');
      line.setAttribute('points',s.bins.map((n,i)=>x(i)+','+y(n)).join(' '));
      line.setAttribute('class','pulse-series '+s.key+(s.stale?' stale':''));
      chartSeries.append(line);
      for(let i=0;i<6;i++){
        const dot=document.createElementNS(NS,'circle');
        dot.setAttribute('cx',x(i));dot.setAttribute('cy',y(s.bins[i]));dot.setAttribute('r','2.5');
        dot.setAttribute('class','pulse-point '+s.key+(s.stale?' stale':''));
        chartSeries.append(dot);
      }
    }
    const details=series.map(s=>s.label+(s.stale?' (older snapshot)':'')+': '+s.bins.join(', '));
    chart.setAttribute('aria-label','Six four-hour UTC intervals. '+(details.join('; ')||'No source data yet.'));
    chartNote.textContent=series.length?details.join(' · ')+' | Counts per 4h UTC bin; different source types are not comparable risk measures.':'Waiting for source data. Unchecked sources are not plotted.';
  }
  function render(){
    const now=Date.now(), recent=[], series=[];
    for(const [key,source] of Object.entries(sources)){
      const snap=snapshots[key];
      if(!snap)continue;
      const node=document.getElementById(source.id);
      if(!Array.isArray(snap.events)){node.textContent=source.label+' · Unavailable';continue;}
      const age=now-Number(snap[source.time]);
      const stale=snap.stale||snap.unavailable||!Number.isFinite(age)||age< -60000||age>300000;
      const events=snap.events.filter(e=>e&&Number.isFinite(e[source.field])&&e[source.field]>=now-86400000&&e[source.field]<=now);
      node.textContent=source.label+' · '+events.length+' '+source.unit+(stale?' · Older snapshot':' · Last 24h');
      const bins=Array(6).fill(0);
      for(const e of events)bins[Math.min(5,Math.floor((e[source.field]-(now-86400000))/14400000))]++;
      series.push({key,label:source.label,bins,stale});
      for(const e of events){
        const url=safeUrl(e.url);
        if(!url)continue;
        const title=key==='earthquakes'?'M'+String(e.magnitude)+' earthquake — '+String(e.place):String(e.title);
        recent.push({time:e[source.field],title:title.slice(0,180),url,source:source.label,stale});
      }
    }
    drawChart(series,now);
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
