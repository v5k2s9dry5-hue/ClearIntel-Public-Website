'use strict';
(() => {
  const root=document.getElementById('global-pulse');
  if(!root)return;
  const layer=document.getElementById('globe-layer');
  const list=document.getElementById('pulse-latest');
  const status=document.getElementById('pulse-latest-status');
  const latestFilter=document.getElementById('pulse-latest-filter');
  const latestMore=document.getElementById('pulse-latest-more');
  const coverage=document.getElementById('pulse-coverage');
  let expandedLatest=false;
  latestFilter.addEventListener('change',()=>{expandedLatest=false;render();});
  latestMore.addEventListener('click',()=>{expandedLatest=!expandedLatest;render();});
  const healthList=document.getElementById('pulse-health-list');
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
  const legend=document.getElementById('pulse-legend');
  const hiddenSeries=new Set();
  const legendButtons=new Map();
  function drawChart(series,now){
    const active=series.filter(s=>!hiddenSeries.has(s.key));
    const peak=Math.max(1,...active.flatMap(s=>s.bins));
    for(const s of series){
      let button=legendButtons.get(s.key);
      if(!button){
        button=document.createElement('button');
        button.type='button';button.className='pulse-legend-item '+s.key;
        const swatch=document.createElement('span');swatch.className='pulse-swatch';swatch.setAttribute('aria-hidden','true');
        const label=document.createElement('span');
        button.append(swatch,label);
        button.addEventListener('click',()=>{
          if(hiddenSeries.has(s.key))hiddenSeries.delete(s.key);else hiddenSeries.add(s.key);
          render();
        });
        legendButtons.set(s.key,button);legend.append(button);
      }
      const count=s.bins.reduce((sum,n)=>sum+n,0);
      button.lastElementChild.textContent=s.label.replace(' publications','')+' · '+count+(s.stale?' (older)':'');
      button.setAttribute('aria-pressed',String(!hiddenSeries.has(s.key)));
      button.setAttribute('aria-label',s.label+', '+count+' records in last 24 hours'+(s.stale?', older snapshot':'')+'. Toggle chart series.');
    }
    for(const [key,button] of legendButtons)if(!series.some(s=>s.key===key)){button.remove();legendButtons.delete(key);}
    document.getElementById('pulse-peak').textContent=active.length?'Scale: 0–'+peak+' records per interval':'No series selected';
    chartSeries.replaceChildren();
    chartAxis.replaceChildren();
    const x=i=>8+i*284/5, y=n=>78-n*66/peak;
    const format=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
    for(let i=0;i<6;i++){
      const tick=document.createElement('span');
      tick.textContent=format(now-(6-i)*14400000);
      chartAxis.append(tick);
    }
    for(const s of active){
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
    const details=active.map(s=>s.label+(s.stale?' (older snapshot)':'')+': '+s.bins.join(', '));
    chart.setAttribute('aria-label','Six four-hour UTC intervals. '+(details.join('; ')||'No source data yet.'));
    chartNote.textContent=series.length?'Tap a source below to show or hide its line. Four-hour UTC intervals; counts are not risk measures.':'Waiting for source data. Unchecked sources are not plotted.';
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
        recent.push({key,time:e[source.field],title:title.slice(0,180),url,source:source.label,stale});
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
        recent.push({key,time,title:String(row.title).slice(0,180),url:safeUrl(row.url),source:name+' publication',stale});
      }
      series.push({key,label:name+' publications',bins,stale});
    }
    drawChart(series,now);
    const fresh=series.filter(s=>!s.stale).length;
    const older=series.length-fresh;
    const checked=Object.keys(snapshots).length+Object.keys(publications).length;
    coverage.textContent=fresh+' of 7 automatic sources current'+(older?' · '+older+' older':'')+(checked>series.length?' · '+(checked-series.length)+' unavailable':'');
    const stampLabel=value=>Number.isFinite(value)?new Date(value).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC':'Not recorded';
    const healthRows=[];
    for(const [key,name] of [...Object.entries(sources).map(([key,s])=>[key,s.label]),...Object.entries(publicationNames)]){
      const observation=Object.hasOwn(sources,key);
      const data=observation?snapshots[key]:publications[key];
      const last=observation?Number(data?.[sources[key].time]):Date.parse(data?.checked_at_utc);
      const plotted=series.find(s=>s.key===key);
      const state=!data?'Not checked':!plotted?'Unavailable':plotted.stale?'Older snapshot':'Current';
      const li=document.createElement('li'),label=document.createElement('strong'),detail=document.createElement('small');
      label.textContent=name+' · '+state;
      detail.textContent='Last successful snapshot check: '+stampLabel(last);
      li.dataset.health=state.toLowerCase().replace(' ','-');li.append(label,detail);healthRows.push(li);
    }
    healthList.replaceChildren(...healthRows);
    recent.sort((a,b)=>b.time-a.time);
    const recentList=document.getElementById('recent-reporting-list');
    const recentStatus=document.getElementById('recent-reporting-status');
    if(recentList&&recentStatus){
      const distinct=new Set();
      const top=recent.filter(row=>!row.stale&&!distinct.has(row.url)&&(distinct.add(row.url),true)).slice(0,6);
      const focused=recentList.contains(document.activeElement)?document.activeElement.href:null;
      recentList.replaceChildren();
      for(const row of top){const li=document.createElement('li'),link=document.createElement('a'),meta=document.createElement('small');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;meta.textContent=row.source+' · '+new Date(row.time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC';li.append(link,meta);recentList.append(li);if(focused===link.href)link.focus({preventScroll:true});}
      recentStatus.textContent=top.length?top.length+' recent records · '+fresh+' of 7 automatic sources current':'No current linked observations available. Coverage may be incomplete.';
    }
    const desk=document.getElementById('desktop-briefing-list'),deskStatus=document.getElementById('desktop-briefing-status');
    if(desk&&deskStatus){
      const distinct=new Set();
      const top=recent.filter(row=>Object.hasOwn(publicationNames,row.key)&&!row.stale&&!distinct.has(row.url)&&(distinct.add(row.url),true)).slice(0,4);
      const focused=desk.contains(document.activeElement)?document.activeElement.href:null;
      desk.replaceChildren();
      for(const row of top){
        const li=document.createElement('li'),link=document.createElement('a'),meta=document.createElement('small');
        link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
        meta.textContent=row.source+' · '+new Date(row.time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC';
        li.append(link,meta);desk.append(li);if(focused===link.href)link.focus({preventScroll:true});
      }
      deskStatus.textContent=top.length?fresh+' of 7 automatic sources current':'No recent current official publications available; coverage may be incomplete.';
    }
    const seen=new Set();
    const selected=latestFilter.value;
    const matches=recent.filter(row=>{
      if(selected!=='all'&&row.key!==selected)return false;
      if(seen.has(row.url))return false;
      seen.add(row.url);return true;
    });
    const limit=expandedLatest?12:3;
    const focusedUrl=list.contains(document.activeElement)?document.activeElement.href:null;
    list.replaceChildren();
    for(const row of matches.slice(0,limit)){
      const li=document.createElement('li'), link=document.createElement('a'), meta=document.createElement('small');
      link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
      meta.textContent=row.source+' · '+new Date(row.time).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC'+(row.stale?' · Older snapshot':'');
      li.append(link,meta);list.append(li);
      if(focusedUrl===link.href)link.focus({preventScroll:true});
    }
    latestMore.hidden=matches.length<=3;
    latestMore.textContent=expandedLatest?'Show fewer':'Show more ('+Math.min(12,matches.length)+' reports)';
    latestMore.setAttribute('aria-expanded',String(expandedLatest));
    status.textContent=matches.length?'Recent source observations and publications; coverage is not exhaustive.':(Object.keys(snapshots).length||Object.keys(publications).length)?'No linked reports for this selection in the last 24 hours. Coverage may be incomplete.':'Waiting for observations from connected sources.';
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
  function rememberPublication(category,data){
    const previous=publications[category];
    if(data?.status==='checking')return;
    if(['available','stale'].includes(data?.status)&&Array.isArray(data.reports)){
      if(previous?.checked_at_utc&&Date.parse(previous.checked_at_utc)>Date.parse(data.checked_at_utc))return;
      publications[category]=data;
    }else{
      publications[category]=previous?.reports?{...previous,status:'stale'}:{status:'unavailable'};
    }
  }
  let summaryBusy=false, summaryDue=0, publicationsPaused=false;
  const pauseButton=document.getElementById('pulse-pause');
  pauseButton.addEventListener('click',()=>{
    publicationsPaused=!publicationsPaused;
    pauseButton.setAttribute('aria-pressed',String(publicationsPaused));
    pauseButton.textContent=publicationsPaused?'Resume publication checks':'Pause publication checks';
    if(!publicationsPaused){refreshSummary();if(selectedCategory&&Date.now()-lastCheck>=300000)loadDedicated(selectedCategory);}
    render();
  });
  async function refreshSummary(){
    if(publicationsPaused||document.hidden||summaryBusy||Date.now()<summaryDue)return;
    summaryBusy=true;
    const started=Date.now();
    summaryDue=started+300000;
    try{
      const response=await fetch('/api/intelligence-pulse',{signal:AbortSignal.timeout(35000),cache:'no-store'});
      if(!response.ok)throw Error('Unavailable');
      const data=await response.json();
      if(data.status==='checking'){summaryDue=Date.now()+30000;return;}
      if(data.status!=='checked'||!data.feeds)throw Error('Invalid summary');
      for(const category of Object.keys(categories)){
        // A dedicated check made after the summary began takes precedence.
        if((publicationUpdated[category]||0)>started)continue;
        if(data.feeds[category]?.status==='checking')summaryDue=Math.min(summaryDue,Date.now()+30000);
        rememberPublication(category,data.feeds[category]);
      }
      render();
    }catch{
      summaryDue=Date.now()+60000;
      for(const category of Object.keys(categories)){
        if((publicationUpdated[category]||0)>started)continue;
        rememberPublication(category,null);
      }
      render();
    }finally{summaryBusy=false;}
  }
  const publicationUpdated={};
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
      publicationUpdated[category]=Date.now();
      rememberPublication(category,data);
      render();
      if(data.status==='checking'){dedicatedStatus.textContent='Another source check is in progress. Please check again shortly.';lastCheck=Date.now()-270000;return;}
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
      publicationUpdated[category]=Date.now();
      rememberPublication(category,null);
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
  setInterval(()=>{if(!publicationsPaused&&!document.hidden&&selectedCategory&&Date.now()-lastCheck>=300000)loadDedicated(selectedCategory);},30000);
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
  for(const link of document.querySelectorAll('a[href="#dashboard-source-guide"]'))link.addEventListener('click',()=>{document.getElementById('dashboard-source-guide').open=true;});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();refreshSummary();}});
  setInterval(refreshSummary,30000);
  refreshSummary();
  function bindPublicationFeed(key,label,dateBasis){
    const button=document.getElementById(key+'-load');
    const status=document.getElementById(key+'-status');
    const results=document.getElementById(key+'-results');
    button.addEventListener('click',async()=>{
      button.disabled=true;status.textContent='Checking official publications…';
      try{
        const response=await fetch('/api/intelligence-feed/'+key,{signal:AbortSignal.timeout(12000),cache:'no-store'});
        if(!response.ok)throw Error('Unavailable');
        const data=await response.json();
        if(data.status==='checking'){status.textContent='Another source check is in progress. Try again shortly.';return;}
        if(!['available','stale'].includes(data.status)||!Array.isArray(data.reports))throw Error('Unavailable');
        const rows=[];
        for(const report of data.reports.slice(0,12)){
          const url=safeUrl(report.url),stamp=Date.parse(report.published_at_utc);
          if(!url||!Number.isFinite(stamp))continue;
          const li=document.createElement('li'),link=document.createElement('a'),meta=document.createElement('small');
          link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=String(report.title).slice(0,240);
          meta.textContent=new Date(stamp).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC · '+dateBasis;
          li.append(link,meta);rows.push(li);
        }
        results.replaceChildren(...rows);
        const checked=Date.parse(data.checked_at_utc);
        status.textContent=(data.status==='stale'?'Older snapshot · ':'Latest available publications · ')+rows.length+' displayed'+(Number.isFinite(checked)?' · Checked '+new Date(checked).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'})+' UTC':'');
      }catch(_){status.textContent=results.children.length?'Refresh unavailable; retained earlier results.':'Source unavailable. Open '+label+' directly.';}
      finally{button.disabled=false;}
    });
  }
  bindPublicationFeed('sanctions','OFSI','OFSI publication/update');
  bindPublicationFeed('iaea','the IAEA','IAEA publication');
})();
