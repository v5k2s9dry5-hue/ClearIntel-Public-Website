(() => {
  'use strict';
  const canvas = document.getElementById('earth-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) return;
  const issStatus = document.getElementById('iss-status');
  const latText = document.getElementById('iss-lat');
  const lonText = document.getElementById('iss-lon');
  const timeText = document.getElementById('iss-time');
  const locate = document.getElementById('iss-find');
  const motion = document.getElementById('earth-motion');
  const layer = document.getElementById('globe-layer');
  const quakePanel = document.getElementById('earthquake-panel');
  const issPanel = document.getElementById('iss-panel');
  const quakeWindow = document.getElementById('quake-window');
  const quakePause = document.getElementById('quake-pause');
  const quakeStatus = document.getElementById('quake-status');
  const quakeList = document.getElementById('quake-list');
  const quakeDetail = document.getElementById('quake-detail');
  const utcTime = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RAD = Math.PI / 180;
  let rot = -18, tilt = 19, playing = !reduced, dragPointer = null, px = 0, py = 0;
  let points = [], currentISS = null, lastDraw = 0, lastTick = 0;
  let quakeFeed = null, quakeFailed = false, quakePaused = false, quakeLoading = false;
  let visibleQuakes = [], pins = [], selectedQuake = null, dragDistance = 0, issLoading = false;
  const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
  const project = (lon,lat,cx,cy,r) => {
    const a=(lon-rot)*RAD, b=lat*RAD, t=tilt*RAD;
    const front=Math.cos(b)*Math.cos(a)*Math.cos(t)+Math.sin(b)*Math.sin(t);
    return {x:cx+r*Math.cos(b)*Math.sin(a),
            y:cy-r*(Math.sin(b)*Math.cos(t)-Math.cos(b)*Math.cos(a)*Math.sin(t)), front};
  };
  function fit() {
    const bounds=canvas.getBoundingClientRect();
    const ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.floor(bounds.width*ratio));
    canvas.height=Math.max(1,Math.floor(bounds.height*ratio));
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function drawGrid(lonLine) {
    return lonLine ? Array.from({length:181},(_,i)=>[lonLine,-90+i]) : [];
  }
  function strokeTrack(coords,cx,cy,r) {
    ctx.beginPath(); let drawing=false;
    for(const [lon,lat] of coords) {
      const p=project(lon,lat,cx,cy,r);
      if(p.front>0.005) { if(!drawing)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); drawing=true; }
      else drawing=false;
    }
    ctx.stroke();
  }
  function draw() {
    const width=canvas.clientWidth, height=canvas.clientHeight;
    if(!width||!height)return;
    ctx.clearRect(0,0,width,height);
    const cx=width/2, cy=height/2-4, r=Math.min(width*0.39,height*0.45);
    const halo=ctx.createRadialGradient(cx,cy,r*.8,cx,cy,r*1.4);
    halo.addColorStop(0,'rgba(45,168,124,.22)');halo.addColorStop(1,'rgba(15,65,55,0)');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(cx,cy,r*1.4,0,Math.PI*2);ctx.fill();
    const ocean=ctx.createRadialGradient(cx-r*.36,cy-r*.4,r*.04,cx,cy,r*1.15);
    ocean.addColorStop(0,'#173d44');ocean.addColorStop(.65,'#0c3038');ocean.addColorStop(1,'#06191f');
    ctx.fillStyle=ocean;ctx.strokeStyle='#456e66';ctx.lineWidth=1.25;
    ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r-.4,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='rgba(120,181,160,.22)';ctx.lineWidth=.65;
    for(let lon=-180;lon<=180;lon+=30)strokeTrack(drawGrid(lon),cx,cy,r);
    for(let lat=-75;lat<=75;lat+=15)strokeTrack(Array.from({length:361},(_,i)=>[-180+i,lat]),cx,cy,r);
    for(const [lon,lat] of points){
      const p=project(lon,lat,cx,cy,r);
      if(p.front>0.015){
        ctx.fillStyle=p.front>.35?'rgba(121,227,172,.73)':'rgba(78,158,127,.50)';
        ctx.fillRect(p.x-1.1,p.y-1.1,2.2,2.2);
      }
    }
    pins=[];
    if(layer.value==='earthquakes'){
      for(const event of [...visibleQuakes].reverse()){
        const pin=project(event.longitude,event.latitude,cx,cy,r);
        if(pin.front<=.035)continue;
        const selected=event.id===selectedQuake;
        ctx.beginPath();ctx.arc(pin.x,pin.y,selected?7:4,0,2*Math.PI);
        ctx.fillStyle=selected?'#cdffff':'#5de5f4';ctx.fill();
        ctx.strokeStyle='#071b24';ctx.lineWidth=1.5;ctx.stroke();
        pins.push({...pin,event});
      }
    }
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
    ctx.strokeStyle='rgba(151,212,174,.20)';ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(cx,cy,r*1.13,r*.30,-.3,0,2*Math.PI);ctx.stroke();
    ctx.fillStyle='#84b99e';ctx.font='9px system-ui';
    ctx.fillText('EARTH / ILLUSTRATIVE',12,18);
  }
  function frame(now){
    if(!lastTick)lastTick=now;
    const delta=Math.min(now-lastTick,80);lastTick=now;
    if(playing&&dragPointer===null)rot=(rot+delta*.0033)%360;
    if(now-lastDraw>35){draw();lastDraw=now;}
    requestAnimationFrame(frame);
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
    rot=(rot-dx*.48)%360;
    tilt=clamp(tilt+dy*.25,-90,90);
    px=e.clientX;py=e.clientY;draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(e.pointerId!==dragPointer)return;
    dragPointer=null;
    if(dragDistance+Math.hypot(e.clientX-px,e.clientY-py)>6||layer.value!=='earthquakes')return;
    const box=canvas.getBoundingClientRect();
    let nearest=null, distance=14;
    for(const pin of pins){
      const fromPointer=Math.hypot(pin.x-(e.clientX-box.left),pin.y-(e.clientY-box.top));
      if(fromPointer<distance){nearest=pin;distance=fromPointer;}
    }
    if(nearest)selectQuake(nearest.event);
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
  locate.addEventListener('click',()=>{if(currentISS){rot=currentISS.longitude;tilt=clamp(currentISS.latitude*.35,-35,35);draw();}});
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

  function quakeTitle(event){return `M${event.magnitude.toFixed(1)} · ${event.place}`;}

  function selectQuake(event){
    selectedQuake=event.id;
    rot=event.longitude;tilt=event.latitude;
    setRotation(false);
    renderQuakes();
    draw();
  }

  function renderQuakes(){
    const focused=document.activeElement?.dataset.quakeId;
    const now=Date.now();
    const cutoff=now-Number(quakeWindow.value)*86400000;
    visibleQuakes=(quakeFeed?.events||[]).filter(event=>event.occurred_at_ms>=cutoff);
    quakeList.replaceChildren();
    for(const event of visibleQuakes){
      const row=document.createElement('li');
      const button=document.createElement('button');
      button.type='button';button.dataset.quakeId=event.id;
      button.textContent=quakeTitle(event);
      button.setAttribute('aria-pressed',String(event.id===selectedQuake));
      button.addEventListener('click',()=>selectQuake(event));
      row.append(button);quakeList.append(row);
      if(focused===event.id)button.focus({preventScroll:true});
    }
    const selected=visibleQuakes.find(event=>event.id===selectedQuake);
    quakeDetail.hidden=!selected;
    if(selected){
      const title=document.createElement('strong');title.textContent=quakeTitle(selected);
      const date=document.createElement('span');date.textContent=`Event time ${utcTime.format(selected.occurred_at_ms)} UTC`;
      const link=document.createElement('a');link.href=selected.url;link.target='_blank';
      link.rel='noopener noreferrer';link.textContent='View USGS report';
      const existingLink=quakeDetail.querySelector('a');
      if(existingLink?.href===link.href){
        quakeDetail.querySelector('strong').textContent=title.textContent;
        quakeDetail.querySelector('span').textContent=date.textContent;
      }else{quakeDetail.replaceChildren(title,date,link);}
    }
    if(!quakeFeed){
      quakeStatus.textContent=quakeFailed?'USGS earthquake feed unavailable.':'Checking USGS earthquake reports…';
      return;
    }
    const stale=quakeFailed||quakeFeed.stale||now-quakeFeed.generated_at_ms>300000;
    const count=visibleQuakes.length;
    const summary=count?`${count} USGS reports · M4.5+`:'No M4.5+ USGS reports in this window';
    const status=(quakePaused?'Updates paused · ':'')+(stale?'Showing older data · ':'');
    quakeStatus.textContent=`${status}${summary} · Feed updated ${utcTime.format(quakeFeed.generated_at_ms)} UTC`;
    quakeStatus.classList.toggle('stale',stale);
  }

  async function refreshQuakes(){
    if(quakePaused||quakeLoading||layer.value!=='earthquakes')return;
    quakeLoading=true;
    try{
      const response=await fetch('/api/earthquakes',{cache:'no-store'});
      if(!response.ok)throw Error('USGS feed unavailable');
      const latest=await response.json();
      if(!Number.isFinite(latest.generated_at_ms)||!Array.isArray(latest.events))throw Error('Invalid earthquake data');
      if(quakePaused)return;
      quakeFeed=latest;quakeFailed=false;
    }catch(_){quakeFailed=true;}
    finally{quakeLoading=false;renderQuakes();draw();}
  }

  quakeWindow.addEventListener('change',()=>{renderQuakes();draw();});
  quakePause.addEventListener('click',()=>{
    quakePaused=!quakePaused;
    quakePause.textContent=quakePaused?'Resume updates':'Pause updates';
    quakePause.setAttribute('aria-pressed',String(quakePaused));
    renderQuakes();
    if(!quakePaused)refreshQuakes();
  });
  layer.addEventListener('change',()=>{
    const showingQuakes=layer.value==='earthquakes';
    quakePanel.hidden=!showingQuakes;issPanel.hidden=showingQuakes;
    draw();
    if(showingQuakes)refreshQuakes();else refreshISS();
  });
  fetch('/assets/earth-land.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(Array.isArray(data)){points=data;draw();}}).catch(()=>{});
  if('ResizeObserver' in window)new ResizeObserver(()=>{fit();draw();}).observe(canvas);
  else window.addEventListener('resize',()=>{fit();draw();});
  fit();draw();requestAnimationFrame(frame);
  refreshQuakes();
  setInterval(()=>{if(!document.hidden&&layer.value==='iss')refreshISS();},30000);
  setInterval(()=>{
    if(document.hidden||layer.value!=='earthquakes')return;
    if(quakePaused)renderQuakes();else refreshQuakes();
  },60000);
})();
