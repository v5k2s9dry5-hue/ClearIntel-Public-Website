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
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RAD = Math.PI / 180;
  let rot = -18, tilt = 19, playing = !reduced, dragging = false, px = 0, py = 0;
  let points = [], currentISS = null, lastDraw = 0, lastTick = 0;
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
    if(currentISS){
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
    if(playing&&!dragging)rot=(rot+delta*.0033)%360;
    if(now-lastDraw>35){draw();lastDraw=now;}
    requestAnimationFrame(frame);
  }
  canvas.addEventListener('pointerdown',e=>{
    dragging=true;px=e.clientX;py=e.clientY;canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!dragging)return;
    rot+=(e.clientX-px)*.48;tilt=clamp(tilt+(e.clientY-py)*.25,-65,65);
    px=e.clientX;py=e.clientY;draw();
  });
  const end=()=>{dragging=false;};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  motion.textContent=playing?'Pause rotation':'Resume rotation';
  motion.addEventListener('click',()=>{playing=!playing;motion.textContent=playing?'Pause rotation':'Resume rotation';motion.setAttribute('aria-pressed',String(!playing));});
  locate.addEventListener('click',()=>{if(currentISS){rot=currentISS.longitude;tilt=clamp(currentISS.latitude*.35,-35,35);draw();}});
  async function refreshISS() {
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
    }
  }
  fetch('/assets/earth-land.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(Array.isArray(data)){points=data;draw();}}).catch(()=>{});
  if('ResizeObserver' in window)new ResizeObserver(()=>{fit();draw();}).observe(canvas);
  else window.addEventListener('resize',()=>{fit();draw();});
  fit();draw();requestAnimationFrame(frame);
  refreshISS();
  setInterval(()=>{if(!document.hidden)refreshISS();},30000);
})();
