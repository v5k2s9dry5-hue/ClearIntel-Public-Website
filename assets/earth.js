(() => {
  'use strict';
  const canvas = document.getElementById('earth-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) return;
  const dashboard = document.getElementById('top');
  const viewControls = document.getElementById('dashboard-view-controls');
  const mapTab = document.getElementById('dashboard-map-tab');
  const feedTab = document.getElementById('dashboard-feed-tab');
  const showMap = document.getElementById('dashboard-show-map');
  const mobileDashboard = window.matchMedia('(max-width: 860px)');
  const issStatus = document.getElementById('iss-status');
  const latText = document.getElementById('iss-lat');
  const lonText = document.getElementById('iss-lon');
  const timeText = document.getElementById('iss-time');
  const locate = document.getElementById('iss-find');
  const motion = document.getElementById('earth-motion');
  const ukView = document.getElementById('earth-uk-view');
  const layer = document.getElementById('globe-layer');
  const reportPanel = document.getElementById('earthquake-panel');
  const issPanel = document.getElementById('iss-panel');
  const reportWindow = document.getElementById('quake-window');
  const reportPause = document.getElementById('quake-pause');
  const reportStatus = document.getElementById('quake-status');
  const reportList = document.getElementById('quake-list');
  const reportDetail = document.getElementById('quake-detail');
  const reportGroup = document.getElementById('quake-group');
  const reportGroupTitle = document.getElementById('quake-group-title');
  const reportShowAll = document.getElementById('quake-show-all');
  const utcTime = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
  const reportLayers = {
    earthquakes: {
      endpoint:'/api/earthquakes', name:'USGS earthquake', minimum:' · M4.5+',
      timeField:'occurred_at_ms', timeLabel:'Event time', feedTime:'generated_at_ms', feedLabel:'Feed updated',
      marker:'#5de5f4', selectedMarker:'#cdffff', window:'1',
      title:event=>`M${event.magnitude.toFixed(1)} · ${event.place}`,
      source:()=> 'USGS report', status:()=>'',
    },
    wildfires: {
      endpoint:'/api/wildfires', name:'NASA EONET wildfire', minimum:'',
      timeField:'observed_at_ms', timeLabel:'Observation time', feedTime:'checked_at_ms', feedLabel:'Feed checked',
      marker:'#ffae68', selectedMarker:'#ffe6c4', window:'7',
      title:event=>event.title, source:event=>event.source,
      status:event=>event.closed?'Closed in EONET':'Open in EONET',
    },
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RAD = Math.PI / 180;
  const UK_ZOOM = 7;
  let rot = -18, tilt = 19, playing = !reduced, dragPointer = null, px = 0, py = 0;
  let zoomed = false, previousWorld = null, coastline = null;
  let points = [], currentISS = null, lastDraw = 0, lastTick = 0;
  let reportsPaused = false;
  let visibleReports = [], pins = [], selectedReport = null, clusterIds = null;
  let dragDistance = 0, issLoading = false;
  const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
  const project = (lon,lat,cx,cy,r) => {
    const a=(lon-rot)*RAD, b=lat*RAD, t=tilt*RAD;
    const front=Math.cos(b)*Math.cos(a)*Math.cos(t)+Math.sin(b)*Math.sin(t);
    return {x:cx+r*Math.cos(b)*Math.sin(a),
            y:cy-r*(Math.sin(b)*Math.cos(t)-Math.cos(b)*Math.cos(a)*Math.sin(t)), front};
  };
  function fit() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.floor(canvas.clientWidth*ratio));
    canvas.height=Math.max(1,Math.floor(canvas.clientHeight*ratio));
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function drawGrid(lonLine) {
    return Array.from({length:181},(_,i)=>[lonLine,-90+i]);
  }
  function strokeTrack(coords,cx,cy,r,fillLand=false) {
    ctx.beginPath(); let drawing=false, allVisible=true;
    for(const [lon,lat] of coords) {
      const p=project(lon,lat,cx,cy,r);
      if(p.front>0.005) { if(!drawing)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); drawing=true; }
      else{drawing=false;allVisible=false;}
    }
    if(fillLand&&allVisible){ctx.closePath();ctx.fill();}
    ctx.stroke();
  }
  function insideCoastline(lon,lat){
    if(!coastline)return false;
    const [west,south,east,north]=coastline.bounds;
    return lon>=west&&lon<=east&&lat>=south&&lat<=north;
  }
  function drawCoastline(cx,cy,r){
    if(!coastline)return;
    ctx.fillStyle='#224768';ctx.strokeStyle='#9bdbef';ctx.lineWidth=zoomed?1.05:.65;
    for(const {coords,closed} of coastline.tracks)strokeTrack(coords,cx,cy,r,closed);
  }
  function drawReportPins(cx,cy,r){
    const activeLayer=reportLayers[layer.value];
    const groups=[];
    for(const event of visibleReports){
      const point=project(event.longitude,event.latitude,cx,cy,r);
      if(point.front<=.035)continue;
      let closest=null, distance=27;
      for(const group of groups){
        const gap=Math.hypot(point.x-group.x,point.y-group.y);
        if(gap<distance){closest=group;distance=gap;}
      }
      if(closest){
        closest.events.push(event);
        closest.x+=(point.x-closest.x)/closest.events.length;
        closest.y+=(point.y-closest.y)/closest.events.length;
      }else{groups.push({x:point.x,y:point.y,events:[event]});}
    }

    ctx.save();
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='800 10px system-ui';
    for(let i=groups.length-1;i>=0;i--){
      const group=groups[i];
      const count=group.events.length;
      const selected=group.events.some(event=>event.id===selectedReport);
      const radius=count>99?15:count>1?12:selected?7:4;
      ctx.beginPath();ctx.arc(group.x,group.y,radius,0,2*Math.PI);
      ctx.fillStyle=selected?activeLayer.selectedMarker:activeLayer.marker;ctx.fill();
      ctx.strokeStyle='#071b24';ctx.lineWidth=1.5;ctx.stroke();
      if(count>1){ctx.fillStyle='#071b24';ctx.fillText(String(count),group.x,group.y);}
      group.hitRadius=Math.max(14,radius+4);
    }
    ctx.restore();
    return groups;
  }
  function draw() {
    const width=canvas.clientWidth, height=canvas.clientHeight;
    if(!width||!height)return;
    ctx.clearRect(0,0,width,height);
    const cx=width/2, cy=height/2-4, r=Math.min(width*0.39,height*0.45)*(zoomed?UK_ZOOM:1);
    const halo=ctx.createRadialGradient(cx,cy,r*.8,cx,cy,r*1.4);
    halo.addColorStop(0,'rgba(72,152,246,.23)');halo.addColorStop(1,'rgba(31,72,130,0)');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(cx,cy,r*1.4,0,Math.PI*2);ctx.fill();
    const ocean=ctx.createRadialGradient(cx-r*.36,cy-r*.4,r*.04,cx,cy,r*1.15);
    ocean.addColorStop(0,'#1a395d');ocean.addColorStop(.65,'#102745');ocean.addColorStop(1,'#081628');
    ctx.fillStyle=ocean;ctx.strokeStyle='#3d6289';ctx.lineWidth=1.25;
    ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r-.4,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='rgba(129,176,223,.23)';ctx.lineWidth=.65;
    for(let lon=-180;lon<=180;lon+=30)strokeTrack(drawGrid(lon),cx,cy,r);
    for(let lat=-75;lat<=75;lat+=15)strokeTrack(Array.from({length:361},(_,i)=>[-180+i,lat]),cx,cy,r);
    for(const [lon,lat] of points){
      if(insideCoastline(lon,lat))continue;
      const p=project(lon,lat,cx,cy,r);
      if(p.front>0.015){
        ctx.fillStyle=p.front>.35?'rgba(124,183,235,.72)':'rgba(85,138,191,.48)';
        ctx.fillRect(p.x-1.1,p.y-1.1,2.2,2.2);
      }
    }
    drawCoastline(cx,cy,r);
    if(layer.value==='iss'&&currentISS){
      const p=project(currentISS.longitude,currentISS.latitude,cx,cy,r);
      if(p.front>0){
        ctx.fillStyle='#c5ffda';ctx.strokeStyle='#a8e8c1';ctx.lineWidth=1.1;
        ctx.beginPath();ctx.arc(p.x,p.y,7.2,0,2*Math.PI);ctx.stroke();
        ctx.beginPath();ctx.arc(p.x,p.y,3.1,0,2*Math.PI);ctx.fill();
        ctx.font='700 11px system-ui';ctx.fillStyle='#f4fff9';ctx.fillText('ISS',p.x+12,p.y-8);
      }
    }
    const shade=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
    shade.addColorStop(0,'rgba(8,14,17,.22)');shade.addColorStop(.45,'rgba(0,0,0,0)');shade.addColorStop(1,'rgba(0,0,0,.37)');
    ctx.fillStyle=shade;ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.fill();
    ctx.restore();
    if(!zoomed){
      ctx.strokeStyle='rgba(143,184,231,.21)';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(cx,cy,r*1.13,r*.30,-.3,0,2*Math.PI);ctx.stroke();
    }
    pins=reportLayers[layer.value]?drawReportPins(cx,cy,r):[];
    ctx.fillStyle='#9ebbd6';ctx.font='9px system-ui';
    ctx.fillText(zoomed?'REGIONAL VIEW':'EARTH / ILLUSTRATIVE',12,18);
  }
  function frame(now){
    if(!lastTick)lastTick=now;
    const delta=Math.min(now-lastTick,80);lastTick=now;
    if(playing&&dragPointer===null){
      rot=(rot+delta*.0033/(zoomed?UK_ZOOM:1))%360;
      if(now-lastDraw>35){draw();lastDraw=now;}
    }
    requestAnimationFrame(frame);
  }
  function showDashboardView(view){
    dashboard.dataset.mobileView=view;
    mapTab.setAttribute('aria-pressed',String(view==='map'));
    feedTab.setAttribute('aria-pressed',String(view==='feed'));
    if(view==='map'){fit();draw();}
  }
  if(viewControls){
    mapTab.addEventListener('click',()=>showDashboardView('map'));
    feedTab.addEventListener('click',()=>showDashboardView('feed'));
    showMap.addEventListener('click',()=>{showDashboardView('map');mapTab.focus();});
    viewControls.hidden=false;
    showDashboardView('map');
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0||dragPointer!==null)return;
    dragPointer=e.pointerId;dragDistance=0;px=e.clientX;py=e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==dragPointer)return;
    const dx=e.clientX-px, dy=e.clientY-py;
    dragDistance+=Math.hypot(dx,dy);
    // The projection subtracts the view longitude from every point.
    const scale=zoomed?UK_ZOOM:1;
    rot=(rot-dx*.48/scale)%360;
    tilt=clamp(tilt+dy*.25/scale,-90,90);
    px=e.clientX;py=e.clientY;draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(e.pointerId!==dragPointer)return;
    dragPointer=null;
    if(dragDistance+Math.hypot(e.clientX-px,e.clientY-py)>6||!reportLayers[layer.value])return;
    const box=canvas.getBoundingClientRect();
    const x=(e.clientX-box.left)*canvas.clientWidth/box.width;
    const y=(e.clientY-box.top)*canvas.clientHeight/box.height;
    let nearest=null, distance=Infinity;
    for(const pin of pins){
      const fromPointer=Math.hypot(pin.x-x,pin.y-y);
      if(fromPointer<=pin.hitRadius&&fromPointer<distance){nearest=pin;distance=fromPointer;}
    }
    if(!nearest)return;
    if(viewControls&&mobileDashboard.matches)showDashboardView('feed');
    if(nearest.events.length>1){
      clusterIds=new Set(nearest.events.map(event=>event.id));
      selectedReport=null;
      setRotation(false);
      renderReports();
      reportGroupTitle.focus();
      draw();
    }else{
      clusterIds=null;
      selectReport(nearest.events[0]);
      if(viewControls&&mobileDashboard.matches)reportDetail.focus();
    }
  });
  function cancelDrag(e){if(e.pointerId===dragPointer)dragPointer=null;}
  canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('lostpointercapture',cancelDrag);
  function setRotation(active){
    playing=active;
    motion.textContent=playing?'Pause rotation':'Resume rotation';
    motion.setAttribute('aria-pressed',String(!playing));
  }
  setRotation(playing);
  motion.addEventListener('click',()=>setRotation(!playing));
  function setZoomed(active){
    zoomed=active;
    ukView.textContent=active?'World view':'Zoom to UK';
  }
  ukView.addEventListener('click',()=>{
    if(zoomed){
      setZoomed(false);
      ({rot,tilt}=previousWorld);
      setRotation(previousWorld.playing);
      previousWorld=null;
    }else{
      previousWorld={rot,tilt,playing};
      rot=-4.5;tilt=54.7;
      setZoomed(true);
      setRotation(false);
    }
    draw();
  });
  function leaveRegionalView(){
    if(!zoomed)return;
    setZoomed(false);
    previousWorld=null;
  }
  locate.addEventListener('click',()=>{
    if(!currentISS)return;
    leaveRegionalView();
    rot=currentISS.longitude;tilt=clamp(currentISS.latitude*.35,-35,35);
    if(viewControls&&mobileDashboard.matches){showDashboardView('map');mapTab.focus();}
    else{draw();}
  });
  async function refreshISS() {
    if(issLoading)return;
    issLoading=true;
    try {
      const response=await fetch('/api/iss',{cache:'no-store'});
      if(!response.ok)throw Error('ISS feed unavailable');
      const obj=await response.json();
      const date=new Date(obj.timestamp*1000);
      if(!Number.isFinite(obj.latitude)||!Number.isFinite(obj.longitude)||Number.isNaN(date.getTime()))throw Error('Invalid ISS data');
      currentISS=obj;locate.disabled=false;
      issStatus.classList.add('live');issStatus.textContent='ISS position received · Source: Where the ISS at? · UTC observation';
      latText.textContent=obj.latitude.toFixed(2)+'°';lonText.textContent=obj.longitude.toFixed(2)+'°';
      timeText.textContent=date.toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' UTC';
      draw();
    } catch(_) {
      currentISS=null;locate.disabled=true;
      issStatus.classList.remove('live');issStatus.textContent='Live ISS tracking unavailable · Earth animation is illustrative.';
      latText.textContent='—';lonText.textContent='—';timeText.textContent='—';
    } finally {issLoading=false;}
  }

  function selectReport(event){
    selectedReport=event.id;
    if(!insideCoastline(event.longitude,event.latitude))leaveRegionalView();
    rot=event.longitude;tilt=event.latitude;
    setRotation(false);
    renderReports();
    draw();
  }

  function renderReports(){
    const active=reportLayers[layer.value];
    if(!active)return;
    const focused=document.activeElement?.dataset.reportId;
    const now=Date.now();
    const cutoff=now-Number(reportWindow.value)*86400000;
    visibleReports=(active.feed?.events||[]).filter(event=>event[active.timeField]>=cutoff);
    const cluster=clusterIds?visibleReports.filter(event=>clusterIds.has(event.id)):[];
    if(!cluster.length)clusterIds=null;
    reportGroup.hidden=!clusterIds;
    if(clusterIds)reportGroupTitle.textContent=`${cluster.length} ${cluster.length===1?'report':'reports'} in this group`;
    reportList.replaceChildren();
    for(const event of clusterIds?cluster:visibleReports){
      const row=document.createElement('li');
      const button=document.createElement('button');
      button.type='button';button.dataset.reportId=event.id;
      const label=document.createElement('span');label.textContent=active.title(event);
      const time=document.createElement('time');time.className='report-time';
      time.dateTime=new Date(event[active.timeField]).toISOString();
      time.textContent=`${utcTime.format(event[active.timeField])} UTC`;
      button.append(label,time);
      button.setAttribute('aria-pressed',String(event.id===selectedReport));
      button.addEventListener('click',()=>selectReport(event));
      row.append(button);reportList.append(row);
      if(focused===event.id)button.focus({preventScroll:true});
    }
    const selected=visibleReports.find(event=>event.id===selectedReport);
    reportDetail.hidden=!selected;
    if(showMap)showMap.hidden=!selected;
    if(selected){
      const title=document.createElement('strong');title.textContent=active.title(selected);
      const date=document.createElement('span');
      const status=active.status(selected);
      date.textContent=`${active.timeLabel} ${utcTime.format(selected[active.timeField])} UTC${status?' · '+status:''}`;
      const link=document.createElement('a');link.href=selected.url;link.target='_blank';
      link.rel='noopener noreferrer';link.textContent=`View ${active.source(selected)}`;
      const existingLink=reportDetail.querySelector('a');
      if(existingLink?.href===link.href){
        reportDetail.querySelector('strong').textContent=title.textContent;
        reportDetail.querySelector('span').textContent=date.textContent;
      }else{reportDetail.replaceChildren(title,date,link);}
    }
    if(!active.feed){
      reportStatus.textContent=reportsPaused?'Updates paused':active.failed?`${active.name} feed unavailable.`:`Checking ${active.name} reports…`;
      reportStatus.classList.toggle('stale',Boolean(active.failed));
      return;
    }
    const updated=active.feed[active.feedTime];
    const stale=active.failed||active.feed.stale||now-updated>300000;
    const count=visibleReports.length;
    const summary=count?`${count} ${active.name} ${count===1?'report':'reports'}${active.minimum}`:`No ${active.name} reports in this window${active.minimum}`;
    const status=(reportsPaused?'Updates paused · ':'')+(stale?'Showing older data · ':'');
    reportStatus.textContent=`${status}${summary} · ${active.feedLabel} ${utcTime.format(updated)} UTC`;
    reportStatus.classList.toggle('stale',stale);
  }

  async function refreshReports(){
    const active=reportLayers[layer.value];
    if(!active||reportsPaused||active.loading)return;
    active.loading=true;
    try{
      const response=await fetch(active.endpoint,{cache:'no-store'});
      if(!response.ok)throw Error('Report feed unavailable');
      const latest=await response.json();
      if(!Number.isFinite(latest[active.feedTime])||!Array.isArray(latest.events))throw Error('Invalid report data');
      if(!reportsPaused){active.feed=latest;active.failed=false;}
    }catch(_){if(!reportsPaused)active.failed=true;}
    finally{
      active.loading=false;
      if(reportLayers[layer.value]===active){renderReports();draw();}
    }
  }

  reportShowAll.addEventListener('click',()=>{
    clusterIds=null;
    renderReports();draw();
    (reportList.querySelector('button')||reportWindow).focus({preventScroll:true});
  });
  reportWindow.addEventListener('change',()=>{
    reportLayers[layer.value].window=reportWindow.value;
    clusterIds=null;renderReports();draw();
  });
  reportPause.addEventListener('click',()=>{
    reportsPaused=!reportsPaused;
    reportPause.textContent=reportsPaused?'Resume updates':'Pause updates';
    reportPause.setAttribute('aria-pressed',String(reportsPaused));
    renderReports();
    draw();
    if(!reportsPaused)refreshReports();
  });
  function changeLayer(){
    const active=reportLayers[layer.value];
    dashboard.dataset.layer=layer.value;
    clusterIds=null;selectedReport=null;visibleReports=[];
    reportPanel.hidden=!active;issPanel.hidden=Boolean(active);
    if(active){
      reportWindow.value=active.window;
      reportList.setAttribute('aria-label',`${active.name} reports`);
      renderReports();refreshReports();
    }else{refreshISS();}
    draw();
  }
  layer.addEventListener('change',changeLayer);
  fetch('/assets/earth-land.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(Array.isArray(data)){points=data;draw();}}).catch(()=>{});
  fetch('/assets/uk-coastline.json').then(response=>{
    if(!response.ok)throw Error('Coastline unavailable');
    return response.json();
  }).then(data=>{
    if(!Array.isArray(data.bounds)||data.bounds.length!==4||!Array.isArray(data.tracks))return;
    coastline={bounds:data.bounds,tracks:data.tracks.map(coords=>{
      const first=coords[0], last=coords.at(-1);
      return {coords,closed:coords.length>=4&&first[0]===last[0]&&first[1]===last[1]};
    })};
    ukView.disabled=false;
    draw();
  }).catch(()=>{});
  if('ResizeObserver' in window)new ResizeObserver(()=>{fit();draw();}).observe(canvas);
  else window.addEventListener('resize',()=>{fit();draw();});
  fit();draw();requestAnimationFrame(frame);
  changeLayer();
  setInterval(()=>{if(!document.hidden&&layer.value==='iss')refreshISS();},30000);
  setInterval(()=>{
    if(document.hidden||!reportLayers[layer.value])return;
    if(reportsPaused){renderReports();draw();}else refreshReports();
  },60000);
})();
