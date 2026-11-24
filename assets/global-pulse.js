'use strict';
(() => {
  const root=document.getElementById('global-pulse');
  if(!root)return;
  const layer=document.getElementById('globe-layer');
  const list=document.getElementById('pulse-latest');
  const status=document.getElementById('pulse-latest-status');
  const snapshots={};
  const publications={};
  const publicationNames={geopolitical:'FCDO',cyber:'NCSC',economic:'ECB',humanitarian:'GDACS',travel:'FCDO travel'};
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
    chartNote.textContent=series.length?details.join(' · ')+' | Counts per 4h UTC bin; source publications and observations are distinct, not risk measures.':'Waiting for source data. Unchecked sources are not plotted.';
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
    for(const [key,snap] of Object.entries(publications)){
      const name=publicationNames[key];
      const tile=root.querySelector('[data-pulse-category="'+key+'"] small');
      if(!tile)continue;
      if(!Array.isArray(snap.reports)){tile.textContent=name+' · Unavailable';continue;}
      const age=now-Date.parse(snap.checked_at_utc);
      const stale=snap.status!=='available'||!Number.isFinite(age)||age>300000||age< -60000;
      const rows=snap.reports.filter(r=>{
        const time=Date.parse(r?.published_at_utc);
        return Number.isFinite(time)&&time>=now-86400000&&time<=now&&safeUrl(r.url);
      });
      tile.textContent=name+' · '+rows.length+' recent publications'+(stale?' · Older snapshot':' · Last 24h');
      const bins=Array(6).fill(0);
      for(const row of rows){
        const time=Date.parse(row.published_at_utc);
        bins[Math.min(5,Math.floor((time-(now-86400000))/14400000))]++;
        recent.push({time,title:String(row.title).slice(0,180),url:safeUrl(row.url),source:name+' publication',stale});
      }
      series.push({key,label:name+' publications',bins,stale});
    }
    drawChart(series,now);
    recent.sort((a,b)=>b.time-a.time);
    const seen=new Set();
    list.replaceChildren();
    for(const row of recent.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;}).slice(0,3)){
      const li=document.createElement('li'), link=document.createElement('a'), meta=document.createElement('small');
      link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
      meta.textContent=row.source+' · '+new Date(row.time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC'+(row.stale?' · Older snapshot':'');
      li.append(link,meta);list.append(li);
    }
    status.textContent=recent.length?'Recent source observations and publications; coverage is not exhaustive.':(Object.keys(snapshots).length||Object.keys(publications).length)?'No recent linked observations received; coverage may be incomplete.':'Waiting for observations from connected sources.';
  }
  for(const key of Object.keys(sources)){
    window.addEventListener('clearintel:'+ (key==='earthquakes'?'earthquake':'wildfire')+'-snapshot',event=>{
      const data=event.detail||{};
      snapshots[key]=Array.isArray(data.events)?data:snapshots[key]?{...snapshots[key],unavailable:true}:data;
      render();
    });
  }
  const dedicated=document.getElementById('pulse-dedicated');
  const dedicatedTitle=document.getElementById('pulse-dedicated-title');
  const dedicatedStatus=document.getElementById('pulse-dedicated-status');
  const dedicatedList=document.getElementById('pulse-dedicated-list');
  const dedicatedSource=document.getElementById('pulse-dedicated-source');
  let selectedCategory=null, generation=0, lastCheck=0;
  const categories={
    humanitarian:['GDACS disaster alerts','https://www.gdacs.org/alerts/'],
    geopolitical:['FCDO official publications','https://www.gov.uk/government/organisations/foreign-commonwealth-development-office'],
    cyber:['NCSC cybersecurity news','https://www.ncsc.gov.uk/information/rss-feeds'],
    economic:['ECB economic releases','https://www.ecb.europa.eu/home/html/rss.en.html'],
    travel:['FCDO travel advice updates','https://www.gov.uk/foreign-travel-advice']
  };
  async function loadDedicated(category){
    const config=categories[category];
    if(!config)return;
    const revision=++generation;
    lastCheck=Date.now();
    dedicatedStatus.textContent='Checking official feed…';
    try{
      const response=await fetch('/api/intelligence-feed/'+category,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('Unavailable');
      const data=await response.json();
      if(revision!==generation)return;
      if(['available','stale'].includes(data.status)&&Array.isArray(data.reports)){
        publications[category]=data;
      }else{
        publications[category]=publications[category]?.reports?{...publications[category],status:'stale'}:{status:'unavailable'};
      }
      render();
      const rows=Array.isArray(data.reports)?data.reports:[];
      const items=[];
      for(const report of rows.slice(0,12)){
        const url=safeUrl(report.url), time=Date.parse(report.published_at_utc);
        if(!url||!Number.isFinite(time))continue;
        const li=document.createElement('li'), link=document.createElement('a'), meta=document.createElement('small');
        link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=String(report.title).slice(0,240);
        meta.textContent=new Date(time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC · Source publication/update';
        li.append(link,meta);items.push(li);
      }
      dedicatedList.replaceChildren(...items);
      const checked=Date.parse(data.checked_at_utc);
      const label=Number.isFinite(checked)?' · Checked '+new Date(checked).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC':'';
      dedicatedStatus.textContent=(data.status==='available'?'Latest available publications':data.status==='stale'?'Older cached publications — refresh unavailable':'Source unavailable')+label+(items.length?'':' · No linked publications returned')+(category==='humanitarian'?' · Sudden-onset disaster coverage only; broader ReliefWeb coverage awaits approval.':'');
    }catch{
      if(revision!==generation)return;
      publications[category]=publications[category]?.reports?{...publications[category],status:'stale'}:{status:'unavailable'};
      render();
      dedicatedStatus.textContent='Feed check unavailable. Open the official source for current information.';
    }
  }
  for(const btn of root.querySelectorAll('[data-pulse-category]')){
    btn.setAttribute('aria-controls','pulse-dedicated');
    btn.setAttribute('aria-expanded','false');
    btn.addEventListener('click',()=>{
      const category=btn.dataset.pulseCategory;
      if(selectedCategory===category&&!dedicated.hidden){
        generation++;selectedCategory=null;dedicated.hidden=true;btn.setAttribute('aria-expanded','false');return;
      }
      for(const other of root.querySelectorAll('[data-pulse-category]'))other.setAttribute('aria-expanded',String(other===btn));
      selectedCategory=category; dedicated.hidden=false;
      dedicatedTitle.textContent=categories[category][0];
      dedicatedSource.href=categories[category][1];
      dedicatedList.replaceChildren(); dedicatedTitle.focus({preventScroll:true});
      loadDedicated(category);
    });
  }
  setInterval(()=>{if(!document.hidden&&selectedCategory&&Date.now()-lastCheck>=300000)loadDedicated(selectedCategory);},30000);
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
