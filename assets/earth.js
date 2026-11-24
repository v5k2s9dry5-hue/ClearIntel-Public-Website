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
  const zoomIn = document.getElementById('earth-zoom-in');
  const zoomOut = document.getElementById('earth-zoom-out');
  const mapCredit = document.getElementById('earth-map-credit');
  const mapInstructions = document.getElementById('map-instructions');
  const projectionControls = document.getElementById('map-projection');
  const flatButton = document.getElementById('projection-flat');
  const globeButton = document.getElementById('projection-globe');
  const resetMap = document.getElementById('earth-reset-map');
  const militaryLegend = document.getElementById('military-map-legend');
  const militaryKind = document.getElementById('military-map-kind');
  const layer = document.getElementById('globe-layer');
  const reportPanel = document.getElementById('earthquake-panel');
  const issPanel = document.getElementById('iss-panel');
  const feedHeading = document.getElementById('dashboard-feed-heading');
  const reportControls = document.getElementById('report-controls');
  const reportTimeline = document.getElementById('report-timeline');
  const countryControls = document.getElementById('country-controls');
  const countrySelect = document.getElementById('country-select');
  const reportWindow = document.getElementById('quake-window');
  const reportPause = document.getElementById('quake-pause');
  const reportStatus = document.getElementById('quake-status');
  const reportList = document.getElementById('quake-list');
  const reportDetail = document.getElementById('quake-detail');
  const reportGroup = document.getElementById('quake-group');
  const reportGroupTitle = document.getElementById('quake-group-title');
  const reportShowAll = document.getElementById('quake-show-all');
  const utcTime = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
  const utcDate = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium'});
  const countryRefreshMs = 300000;
  let countryBrief = null;
  let selectedCityMention = null;
  let militaryArchive = null;
  const incidentFilter=document.getElementById('incident-severity');
  const incidentControls=document.getElementById('incident-controls');
  const severityColors={green:'#55d58e',amber:'#f1bd55',red:'#ff6b72'};
  const severityRank={green:1,amber:2,red:3};
  const reportLayers = {
    incidents: {
      endpoint:'/api/incident-alerts',name:'GDACS incident alert',minimum:'',
      timeField:'reported_at_ms',timeLabel:'Published',feedTime:'checked_at_ms',feedLabel:'Feed checked',
      marker:'#55d58e',selectedMarker:'#d5ffee',window:'1',
      title:event=>event.severity.toUpperCase()+' · '+event.title,
      source:()=> 'GDACS alert',status:()=> 'Provider humanitarian-impact rating',
    },
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
    countries: {
      endpoint:'/assets/countries.json', name:'Country news', mode:'countries',
      marker:'#a7ef8a', selectedMarker:'#e5ffd7', title:event=>event.place,
    },
    aviation: {
      endpoint:'/assets/military-reports.json?v=archive-expanded', name:'Military aviation', mode:'archive', category:'aviation', kind:'Aviation report',
      marker:'#f3ce70', selectedMarker:'#fff0b8', title:event=>event.title,
    },
    maritime: {
      endpoint:'/assets/military-reports.json?v=archive-expanded', name:'Naval activity', mode:'archive', category:'maritime', kind:'Naval report',
      marker:'#b3a7ff', selectedMarker:'#eee4ff', title:event=>event.title,
    },
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RAD = Math.PI / 180;
  const zoomLevels = [1,3,7];
  const UK_ZOOM = zoomLevels.at(-1);
  let rot = -18, tilt = 19, playing = !reduced, dragPointer = null, px = 0, py = 0;
  let zoom = 1, previousWorld = null, coastline = null, coastlineLoading = null;
  let worldMap = null, detailedMap = null, detailLoading = false, detailFailed = false;
  let points = [], currentISS = null, lastDraw = 0, lastTick = 0;
  let rotationFrame = null, mapInView = !('IntersectionObserver' in window);
  let reportsPaused = false;
  let visibleReports = [], pins = [], selectedReport = null, clusterIds = null;
  let timelineStart = null;
  let dragDistance = 0, issLoading = false, issRetryAt = 0;
  let flatMap = false, preferFlat = true, archiveActive = false;
  const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
  const project = (lon,lat,cx,cy,r) => {
    const a=(lon-rot)*RAD, b=lat*RAD, t=tilt*RAD;
    const front=Math.cos(b)*Math.cos(a)*Math.cos(t)+Math.sin(b)*Math.sin(t);
    return {x:cx+r*Math.cos(b)*Math.sin(a),
            y:cy-r*(Math.sin(b)*Math.cos(t)-Math.cos(b)*Math.cos(a)*Math.sin(t)), front};
  };
  function fit() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const width=Math.max(1,Math.floor(canvas.clientWidth*ratio));
    const height=Math.max(1,Math.floor(canvas.clientHeight*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  // Fixed geometry is reused rather than allocating thousands of coordinate pairs per frame.
  const meridians=Array.from({length:13},(_,line)=>
    Array.from({length:181},(_,i)=>[-180+line*30,-90+i]));
  const parallels=Array.from({length:11},(_,line)=>
    Array.from({length:361},(_,i)=>[-180+i,-75+line*15]));
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
  function insideCoastline(lon,lat,bounds=coastline?.bounds){
    if(!bounds)return false;
    const [west,south,east,north]=bounds;
    return lon>=west&&lon<=east&&lat>=south&&lat<=north;
  }
  function drawCoastline(cx,cy,r){
    if(!coastline)return;
    ctx.fillStyle='#224768';ctx.strokeStyle='#9bdbef';ctx.lineWidth=zoom>1?1.05:.65;
    for(const {coords,closed} of coastline.tracks)strokeTrack(coords,cx,cy,r,closed);
  }
  function prepareWorldMap(data){
    function prepare(tracks){
      return tracks.map(coords=>{
        let west=180,east=-180,south=90,north=-90;
        for(const [lon,lat] of coords){
          west=Math.min(west,lon);east=Math.max(east,lon);
          south=Math.min(south,lat);north=Math.max(north,lat);
        }
        return {coords,west,east,south,north};
      });
    }
    return {coastlines:prepare(data.coastlines),borders:prepare(data.borders)};
  }
  function drawWorldMap(map,cx,cy,r){
    const extent=Math.hypot(cx,cy+4)/r;
    const angle=Math.asin(Math.min(1,extent))+RAD;
    const centralLon=((rot+180)%360+360)%360-180;
    const latitude=angle/RAD;
    const longitude=Math.abs(tilt)+latitude>=90?180:Math.asin(Math.min(1,Math.sin(angle)/Math.cos(tilt*RAD)))/RAD;
    const west=centralLon-longitude,east=centralLon+longitude;
    function inView(track){
      if(extent>=1)return true;
      if(track.south>tilt+latitude||track.north<tilt-latitude)return false;
      if(longitude>=180)return true;
      return (track.east>=west&&track.west<=east)
        || (west < -180&&track.east>=west+360)
        || (east > 180&&track.west<=east-360);
    }
    ctx.strokeStyle='#6e99b3';ctx.lineWidth=zoom>1?.85:.65;
    for(const track of map.coastlines){if(inView(track))strokeTrack(track.coords,cx,cy,r);}
    ctx.strokeStyle='#3f6581';ctx.lineWidth=zoom>1?.7:.5;
    for(const track of map.borders){if(inView(track))strokeTrack(track.coords,cx,cy,r);}
  }
  const longitudeDelta = (lon, center) => ((lon - center + 180) % 360 + 360) % 360 - 180;
  const flatScale = width => width * zoom / 360;

  function flatPoint(lon, lat, cx, cy, scale){
    return {x:cx+longitudeDelta(lon,rot)*scale, y:cy-(lat-tilt)*scale, front:1};
  }

  function drawFlatMap(width,height){
    const cx=width/2, cy=height/2, scale=flatScale(width);
    ctx.fillStyle='#050c15';
    ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#173148';
    ctx.lineWidth=.7;
    ctx.beginPath();
    for(let lon=-180;lon<180;lon+=30){
      const {x}=flatPoint(lon,0,cx,cy,scale);
      ctx.moveTo(x,0);ctx.lineTo(x,height);
    }
    for(let lat=-75;lat<=75;lat+=15){
      const {y}=flatPoint(0,lat,cx,cy,scale);
      ctx.moveTo(0,y);ctx.lineTo(width,y);
    }
    ctx.stroke();
    const map=zoom>1&&detailedMap?detailedMap:worldMap;
    if(map){
      ctx.fillStyle='#10283b';
      ctx.strokeStyle='#507c98';
      ctx.lineWidth=.8;
      for(const track of map.coastlines)drawFlatTrack(track,cx,cy,scale,true);
      ctx.strokeStyle='#32566e';
      for(const track of map.borders)drawFlatTrack(track,cx,cy,scale,false);
    }else{
      ctx.fillStyle='#4f788e';
      for(const [lon,lat] of points){
        const {x,y}=flatPoint(lon,lat,cx,cy,scale);
        ctx.fillRect(x,y,1.5,1.5);
      }
    }
    pins=drawReportPins(cx,cy,scale,flatPoint);
  }

  function drawFlatTrack(track,cx,cy,scale,fill){
    if(track.south>tilt+cy/scale || track.north<tilt-cy/scale)return;
    const {coords,west,east}=track;
    // Repeat the geometry across the map seam so panning across 180° remains continuous.
    const center=rot+longitudeDelta((west+east)/2,rot);
    const shift=center-(west+east)/2;
    for(const offset of [shift-360,shift,shift+360]){
      if((west+offset-rot)*scale>cx || (east+offset-rot)*scale< -cx)continue;
      ctx.beginPath();
      let lastLon=null, canFill=true;
      for(const [lon,lat] of coords){
        const x=cx+(lon+offset-rot)*scale, y=cy-(lat-tilt)*scale;
        if(lastLon===null || Math.abs(lastLon-lon)>180){
          if(lastLon!==null)canFill=false;
          ctx.moveTo(x,y);
        }else ctx.lineTo(x,y);
        lastLon=lon;
      }
      const first=coords[0], last=coords.at(-1);
      if(fill&&canFill&&first[0]===last[0]&&first[1]===last[1])ctx.fill();
      ctx.stroke();
    }
  }

  function drawMilitaryMarker(group,active,selected){
    const {x,y}=group;
    const ink=selected?active.selectedMarker:active.marker;
    ctx.save();
    ctx.translate(x,y);
    ctx.beginPath();ctx.arc(0,0,selected?14:12,0,2*Math.PI);
    ctx.fillStyle='#101c2a';ctx.fill();
    ctx.strokeStyle=ink;ctx.lineWidth=selected?2:1;ctx.stroke();
    ctx.fillStyle=ink;
    ctx.beginPath();
    const outline=active.category==='aviation'
      ? [[0,-8],[2,-5],[2,-1],[8,3],[8,5],[2,3],[2,6],[4,7],[4,9],[0,8],[-4,9],[-4,7],[-2,6],[-2,3],[-8,5],[-8,3],[-2,-1],[-2,-5]]
      : [[0,-8],[6,-3],[5,5],[3,8],[-3,8],[-5,5],[-6,-3]];
    ctx.moveTo(...outline[0]);
    for(const [dx,dy] of outline.slice(1))ctx.lineTo(dx,dy);
    ctx.closePath();ctx.fill();
    if(active.category==='maritime'){
      ctx.fillStyle='#101c2a';ctx.fillRect(-2,-2,4,6);
    }
    ctx.restore();
    const label=group.events[0].place.split(',')[0];
    ctx.save();
    ctx.font='600 11px system-ui';ctx.textAlign='left';ctx.textBaseline='middle';
    const width=ctx.measureText(label).width+12;
    const left=x+width+17<canvas.clientWidth?x+17:x-width-17;
    ctx.fillStyle='#0b1929';ctx.fillRect(left,y-10,width,20);
    ctx.fillStyle=ink;ctx.fillText(label,left+6,y);
    ctx.restore();
    group.hitRadius=20;
  }

  function drawReportPins(cx,cy,r,projection=project){
    const activeLayer=reportLayers[layer.value];
    const groups=[];
    for(const event of visibleReports){
      const point=projection(event.longitude,event.latitude,cx,cy,r);
      if(point.front<=.035||point.x<0||point.y<0||point.x>canvas.clientWidth||point.y>canvas.clientHeight)continue;
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
      const cityPin=activeLayer.mode==='countries' && group.events.every(event=>event.cityMention);
      if(activeLayer.mode==='archive'&&count===1){
        drawMilitaryMarker(group,activeLayer,selected);
        continue;
      }
      const radius=count>99?15:count>1?12:cityPin?5:selected?7:4;
      const marker=layer.value==='incidents'?severityColors[group.events.reduce((level,event)=>severityRank[event.severity]>severityRank[level]?event.severity:level,'green')]:cityPin?'#78c8ec':selected?activeLayer.selectedMarker:activeLayer.marker;
      if(selected||count>1){
        ctx.save();ctx.globalAlpha=.15;ctx.fillStyle=marker;
        ctx.beginPath();ctx.arc(group.x,group.y,radius+5,0,2*Math.PI);ctx.fill();ctx.restore();
      }
      ctx.beginPath();ctx.arc(group.x,group.y,radius,0,2*Math.PI);
      ctx.fillStyle=marker;ctx.fill();
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
    const textureCredit=document.getElementById('earth-texture-credit');
    if(flatMap){if(textureCredit)textureCredit.hidden=true;drawFlatMap(width,height);return;}
    const cx=width/2, cy=height/2-4, r=Math.min(width*0.435,height*0.455)*zoom;
    const halo=ctx.createRadialGradient(cx,cy,r*.8,cx,cy,r*1.4);
    halo.addColorStop(0,'rgba(73,169,225,.32)');halo.addColorStop(.5,'rgba(37,98,155,.12)');halo.addColorStop(1,'rgba(31,72,130,0)');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(cx,cy,r*1.4,0,Math.PI*2);ctx.fill();
    const ocean=ctx.createRadialGradient(cx-r*.36,cy-r*.4,r*.04,cx,cy,r*1.15);
    ocean.addColorStop(0,'#10293d');ocean.addColorStop(.65,'#091b2d');ocean.addColorStop(1,'#030a13');
    ctx.fillStyle=ocean;ctx.strokeStyle='#6799b6';ctx.lineWidth=1.15;
    ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r-.4,0,Math.PI*2);ctx.clip();
    const textured=zoom===1&&Boolean(window.ClearIntelGlobeSurface?.draw(ctx,cx,cy,r,rot,tilt));
    if(textureCredit)textureCredit.hidden=!textured;
    ctx.strokeStyle='rgba(137,186,222,.13)';ctx.lineWidth=.65;
    for(const line of meridians)strokeTrack(line,cx,cy,r);
    for(const line of parallels)strokeTrack(line,cx,cy,r);
    const map=zoom>1&&detailedMap?detailedMap:worldMap;
    if(map){
      drawWorldMap(map,cx,cy,r);
    }else{
      for(const [lon,lat] of points){
        if(insideCoastline(lon,lat))continue;
        const p=project(lon,lat,cx,cy,r);
        if(p.front>0.015){
          ctx.fillStyle=p.front>.35?'rgba(124,183,235,.72)':'rgba(85,138,191,.48)';
          ctx.fillRect(p.x-1.1,p.y-1.1,2.2,2.2);
        }
      }
    }
    if(!map||previousWorld&&!detailedMap)drawCoastline(cx,cy,r);
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
    if(zoom===1){
      // A subtle rim follows the globe; no decorative orbital path implying a track.
      ctx.save();ctx.shadowColor='#65cfff';ctx.shadowBlur=13;
      ctx.strokeStyle='rgba(111,210,255,.65)';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(cx,cy,r+.5,0,2*Math.PI);ctx.stroke();ctx.restore();
      ctx.strokeStyle='rgba(114,198,235,.18)';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(cx,cy,r+4,0,2*Math.PI);ctx.stroke();
    }
    pins=reportLayers[layer.value]?drawReportPins(cx,cy,r):[];
    ctx.fillStyle='#9ebbd6';ctx.font='9px system-ui';
    ctx.fillText(zoom>1?'REGIONAL VIEW':'WORLD VIEW',12,18);
  }
  function shouldRotate(){
    return playing&&!flatMap&&dragPointer===null&&!document.hidden&&mapInView&&canvas.clientWidth>0&&canvas.clientHeight>0;
  }
  function syncRotation(){
    if(!shouldRotate()){
      if(rotationFrame!==null)cancelAnimationFrame(rotationFrame);
      rotationFrame=null;lastTick=0;return;
    }
    if(rotationFrame===null)rotationFrame=requestAnimationFrame(frame);
  }
  function frame(now){
    rotationFrame=null;
    if(!shouldRotate()){lastTick=0;return;}
    if(!lastTick)lastTick=now;
    const delta=Math.min(now-lastTick,80);lastTick=now;
    rot=(rot+delta*.0033/zoom)%360;
    if(now-lastDraw>35){draw();lastDraw=now;}
    syncRotation();
  }
  function showDashboardView(view){
    dashboard.dataset.mobileView=view;
    mapTab.setAttribute('aria-pressed',String(view==='map'));
    feedTab.setAttribute('aria-pressed',String(view==='feed'));
    if(view==='map'){fit();draw();}
    syncRotation();
  }
  if(viewControls){
    mapTab.addEventListener('click',()=>{showDashboardView('map');canvas.scrollIntoView({block:'center'});});
    feedTab.addEventListener('click',()=>{showDashboardView('feed');feedHeading.scrollIntoView({block:'center'});});
    showMap.addEventListener('click',()=>{showDashboardView('map');mapTab.focus();});
    viewControls.hidden=false;
    showDashboardView('map');
  }
  const panels = dashboard.querySelector('.dashboard-workspace');
  let swipeStart = null;
  panels.addEventListener('pointerdown', event => {
    swipeStart = null;
    if (!mobileDashboard.matches || event.pointerType !== 'touch' || !event.isPrimary) return;
    if (!event.target.closest('#dashboard-map, #dashboard-feed')) return;
    if (event.target.closest('canvas, a, button, input, select, textarea, label, [role="group"]')) return;
    swipeStart = {id: event.pointerId, x: event.clientX, y: event.clientY};
  });
  panels.addEventListener('pointercancel', () => { swipeStart = null; });
  panels.addEventListener('pointerup', event => {
    const start = swipeStart;
    swipeStart = null;
    if (!start || event.pointerId !== start.id || !mobileDashboard.matches) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const next = dx < 0 ? 'feed' : 'map';
    if (dashboard.dataset.mobileView === next) return;
    (next === 'feed' ? feedTab : mapTab).click();
  });
  canvas.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0||dragPointer!==null)return;
    dragPointer=e.pointerId;dragDistance=0;px=e.clientX;py=e.clientY;
    canvas.setPointerCapture(e.pointerId);
    syncRotation();
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==dragPointer)return;
    const dx=e.clientX-px, dy=e.clientY-py;
    dragDistance+=Math.hypot(dx,dy);
    // Both projections subtract the view longitude from every point.
    const scale=flatMap?flatScale(canvas.clientWidth):null;
    rot=(rot-dx*(flatMap?1/scale:.48/zoom))%360;
    tilt=clamp(tilt+dy*(flatMap?1/scale:.25/zoom),-90,90);
    px=e.clientX;py=e.clientY;
    if(flatMap)resetMap.disabled=false;
    draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(e.pointerId!==dragPointer)return;
    dragPointer=null;syncRotation();
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
  function cancelDrag(e){if(e.pointerId===dragPointer){dragPointer=null;syncRotation();}}
  canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('lostpointercapture',cancelDrag);
  function setRotation(active){
    playing=active;
    motion.textContent=playing?'Pause rotation':'Resume rotation';
    motion.setAttribute('aria-pressed',String(!playing));
    syncRotation();
  }
  setRotation(playing);
  motion.addEventListener('click',()=>setRotation(!playing));
  function updateMapCredit(){
    if(!mapCredit)return;
    const status=zoom===1||detailedMap?'':detailFailed?' · Overview detail':' · Loading detail';
    mapCredit.textContent='Map data: Natural Earth'+status;
  }
  async function loadDetailedMap(){
    if(detailedMap||detailLoading)return;
    detailLoading=true;detailFailed=false;updateMapCredit();
    try{
      const response=await fetch('/assets/world-map-detail.txt');
      if(!response.ok)throw Error('Map detail unavailable');
      const packed=(await response.text()).trim();
      const bytes=Uint8Array.from(atob(packed),char=>char.charCodeAt(0));
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      detailedMap=prepareWorldMap(await new Response(stream).json());
      ukView.disabled=false;
      draw();
    }catch(_){detailFailed=true;}
    finally{detailLoading=false;updateMapCredit();}
  }
  function setZoom(value){
    zoom=value;
    if(zoomIn)zoomIn.disabled=zoom===UK_ZOOM;
    if(zoomOut)zoomOut.disabled=zoom===1;
    ukView.textContent=previousWorld?'World view':'Zoom to UK';
    resetMap.disabled=zoom===1&&rot===0&&tilt===12;
    updateMapCredit();
    if(zoom>1)loadDetailedMap();
  }
  ukView.addEventListener('click',()=>{
    if(previousWorld){
      const world=previousWorld;
      previousWorld=null;
      ({rot,tilt}=world);
      setRotation(world.playing);
      setZoom(1);
    }else{
      previousWorld={rot,tilt,playing};
      rot=-4.5;tilt=54.7;
      setZoom(UK_ZOOM);
      setRotation(false);
      loadUKCoastline();
    }
    draw();
  });
  function stepZoom(step){
    const next=zoomLevels[zoomLevels.indexOf(zoom)+step];
    if(!next)return;
    if(next===1)previousWorld=null;
    setZoom(next);
    setRotation(false);
    draw();
  }
  function resetFlatMap(){
    previousWorld=null;
    rot=0;tilt=12;
    setZoom(1);
    draw();
  }
  resetMap.addEventListener('click',resetFlatMap);

  function updateProjection(){
    flatMap=archiveActive&&preferFlat;
    syncRotation();
    projectionControls.hidden=!archiveActive;
    flatButton.setAttribute('aria-pressed',String(flatMap));
    globeButton.setAttribute('aria-pressed',String(!flatMap));
    motion.hidden=flatMap;
    resetMap.hidden=!flatMap;
    ukView.hidden=flatMap;
    canvas.setAttribute('aria-label',flatMap
      ? 'Interactive map of past public reports. Select a marker or use the feed.'
      : 'Interactive globe. You can also select events in the feed.');
    mapInstructions.textContent=flatMap?'Drag to pan · Select a marker':'Drag to rotate · Select a pin or count';
    draw();
  }
  flatButton.addEventListener('click',()=>{preferFlat=true;updateProjection();});
  globeButton.addEventListener('click',()=>{preferFlat=false;updateProjection();});

  zoomIn?.addEventListener('click',()=>stepZoom(1));
  zoomOut?.addEventListener('click',()=>stepZoom(-1));
  function leaveUKView(){
    if(!previousWorld)return;
    previousWorld=null;
    setZoom(1);
  }
  locate.addEventListener('click',()=>{
    if(!currentISS)return;
    leaveUKView();
    rot=currentISS.longitude;tilt=clamp(currentISS.latitude*.35,-35,35);
    if(viewControls&&mobileDashboard.matches){showDashboardView('map');mapTab.focus();}
    else{draw();}
  });
  async function refreshISS() {
    if(issLoading||Date.now()<issRetryAt)return;
    issLoading=true;
    const started=Date.now();
    try {
      const response=await ClearIntelMapRefresh.fetch('/api/iss');
      if(!response.ok){issRetryAt=ClearIntelMapRefresh.retryAt(response);throw Error('ISS feed unavailable');}
      const obj=response.data;
      const date=new Date(obj.timestamp*1000);
      if(!Number.isFinite(obj.latitude)||!Number.isFinite(obj.longitude)||Number.isNaN(date.getTime()))throw Error('Invalid ISS data');
      currentISS=obj;locate.disabled=false;issRetryAt=started+25000;
      issStatus.classList.add('live');issStatus.textContent='ISS position received · Source: Where the ISS at? · UTC observation';
      latText.textContent=obj.latitude.toFixed(2)+'°';lonText.textContent=obj.longitude.toFixed(2)+'°';
      timeText.textContent=date.toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' UTC';
      draw();
    } catch(_) {
      issRetryAt=Math.max(issRetryAt,Date.now()+30000);
      currentISS=null;locate.disabled=true;
      issStatus.classList.remove('live');issStatus.textContent='Live ISS tracking unavailable · Earth animation is illustrative.';
      latText.textContent='—';lonText.textContent='—';timeText.textContent='—';
    } finally {issLoading=false;}
  }

  function selectReport(event){
    const active = reportLayers[layer.value];
    selectedReport=event.id;
    selectedCityMention=active.mode==='countries'&&event.cityMention?event:null;
    if(active.mode==='countries' && (countryBrief?.id!==event.id || countryBrief?.failed)){
      if(countryBrief?.id!==event.id)countryBrief = {id:event.id};
      refreshCountryBrief();
    }
    if(!insideCoastline(event.longitude,event.latitude,coastline?.bounds||[-13,47,15,63]))leaveUKView();
    rot=event.longitude;tilt=event.latitude;
    if(flatMap)resetMap.disabled=false;
    else setRotation(false);
    renderReports();
    draw();
  }

  function renderReports(){
    const active=reportLayers[layer.value];
    if(!active)return;
    const focused=document.activeElement?.dataset.reportId;
    const now=Date.now();
    if(active.mode==='countries'){
      const allCountries=active.feed?.events||[];
      visibleReports=[...allCountries];
      // City pins are sourced from explicit mentions in recent headlines.
      // They appear only after selecting a country and fetching its brief.
      const base=allCountries.find(event=>event.id===selectedReport);
      if(base && countryBrief?.id===base.id && countryBrief?.data?.city_mentions){
        for(const mention of countryBrief.data.city_mentions){
          if(!Number.isFinite(mention.longitude)||!Number.isFinite(mention.latitude))continue;
          visibleReports.push({...base,longitude:mention.longitude,latitude:mention.latitude,
            cityMention:true,city:mention.city,place:mention.city+', '+base.place,
            headline:mention.headline,url:mention.url,source:mention.source});
        }
      }
    } else if(active.mode) visibleReports=active.feed?.events||[];
    else renderLiveTimeline(active, now);
    if(active.mode==='countries'){
      countrySelect.value=selectedReport||'';
      countrySelect.disabled=!active.feed;
    }
    const cluster=clusterIds?visibleReports.filter(event=>clusterIds.has(event.id)):[];
    if(!cluster.length)clusterIds=null;
    reportGroup.hidden=!clusterIds;
    if(clusterIds){
      const noun=active.mode==='countries'?'location':'report';
      reportGroupTitle.textContent=`${cluster.length} ${noun}${cluster.length===1?'':'s'} in this group`;
    }
    reportList.replaceChildren();
    for(const event of clusterIds?cluster:active.mode==='countries'?[]:visibleReports){
      const row=document.createElement('li');
      const button=document.createElement('button');
      button.type='button';button.dataset.reportId=event.id;
      if(layer.value==='incidents')button.dataset.severity=event.severity;
      const label=document.createElement('span');
      label.textContent=event.cityMention?event.city+' · headline mention':active.title(event);
      button.append(label);
      if(active.mode!=='countries'){
        const time=document.createElement('time');
        time.className='report-time';
        if(active.mode==='archive'){
          time.dateTime=event.reported_on;
          time.textContent=`${event.place} · Reported ${utcDate.format(new Date(event.reported_on))}`;
        }else{
          time.dateTime=new Date(event[active.timeField]).toISOString();
          time.textContent=`${utcTime.format(event[active.timeField])} UTC`;
        }
        button.append(time);
      }
      button.setAttribute('aria-pressed',String(event.id===selectedReport));
      button.addEventListener('click',()=>selectReport(event));
      row.append(button);reportList.append(row);
      if(focused===event.id)button.focus({preventScroll:true});
    }
    const selected=visibleReports.find(event=>event.id===selectedReport);
    reportDetail.hidden=!selected;
    if(showMap)showMap.hidden=!selected;
    if(selected && active.mode==='countries') renderCountryBrief();
    else if(selected && active.mode==='archive'){
      const title=document.createElement('strong');title.textContent=selected.title;
      const date=document.createElement('span');
      date.textContent=`Reported ${utcDate.format(new Date(selected.reported_on))}`;
      const context=document.createElement('span');
      context.textContent=`${selected.type} · ${selected.place}`;
      reportDetail.replaceChildren(title,context,date,reportLink(selected.url, `Read the ${selected.source} report`));
    }else if(selected){
      const title=document.createElement('strong');title.textContent=active.title(selected);
      const date=document.createElement('span');
      const status=active.status(selected);
      date.textContent=`${active.timeLabel} ${utcTime.format(selected[active.timeField])} UTC${status?' · '+status:''}`;
      const link=reportLink(selected.url, `View ${active.source(selected)}`);
      const existingLink=reportDetail.querySelector('a');
      if(existingLink?.href===link.href){
        reportDetail.querySelector('strong').textContent=title.textContent;
        reportDetail.querySelector('span').textContent=date.textContent;
      }else{reportDetail.replaceChildren(title,date,link);}
    }
    if(!active.feed){
      reportStatus.textContent=reportsPaused&&!active.mode?'Updates paused':active.failed?`${active.name} feed unavailable.`:`Checking ${active.name} reports…`;
      reportStatus.classList.toggle('stale',Boolean(active.failed));
      return;
    }
    if(active.mode){
      reportStatus.textContent=active.mode==='countries'
        ? 'Select a country on the globe or from the list. Headlines refresh every 5 minutes. Blue city pins mark places named in reports, not verified incident locations.'
        : `${visibleReports.length} selected public reports about completed events.`;
      reportStatus.classList.remove('stale');
      return;
    }
    const updated=active.feed[active.feedTime];
    const stale=active.failed||active.feed.stale||now-updated>300000;
    const count=visibleReports.length;
    const summary=count?`${count} ${active.name} ${count===1?'report':'reports'}${active.minimum}`:`No ${active.name} reports in this window${active.minimum}`;
    const status=(reportsPaused?'Updates paused · ':'')+(stale?'Showing older data · ':'');
    reportStatus.textContent=`${status}${summary}${timelineStart!==null?' · Timeline filtered':''} · ${active.feedLabel} ${utcTime.format(updated)} UTC`;
    reportStatus.classList.toggle('stale',stale);
  }

  function renderLiveTimeline(active, now){
    const cutoff=now-Number(reportWindow.value)*86400000;
    const allReports=(active.feed?.events||[]).filter(event=>Number.isFinite(event[active.timeField]) && event[active.timeField]>=cutoff && event[active.timeField]<=now);
    const isIncident=active===reportLayers.incidents;
    const counts={green:0,amber:0,red:0};
    if(isIncident){
      for(const event of allReports)if(Object.hasOwn(counts,event.severity))counts[event.severity]++;
      for(const level of Object.keys(counts))document.getElementById('incident-count-'+level).textContent=active.feed?String(counts[level]):'—';
      document.getElementById('incident-coverage').textContent=active.failed||active.feed?.stale?'Feed unavailable or older snapshot.':active.feed?'Natural-hazard alerts from GDACS. Not a global conflict or verified incident count.':'Checking GDACS alerts…';
    }
    const filteredReports=isIncident&&incidentFilter.value!=='all'?allReports.filter(event=>event.severity===incidentFilter.value):allReports;
    const step=Number(reportWindow.value)===1?7200000:86400000;
    const key=timestamp=>Math.floor(timestamp/step)*step;
    if(timelineStart!==null && (!allReports.some(event=>key(event[active.timeField])===timelineStart) || timelineStart>now))timelineStart=null;
    visibleReports=timelineStart===null?filteredReports:filteredReports.filter(event=>key(event[active.timeField])===timelineStart);
    window.ClearIntelTimeline?.render({
      events:filteredReports, timeField:active.timeField, windowDays:reportWindow.value,
      selectedStart:timelineStart, label:active.name, ready:Boolean(active.feed),
      onSelect:start=>{
        timelineStart=start;
        clusterIds=null;
        selectedReport=null;
        renderReports();draw();
      }
    });
  }

  function reportLink(url, text){
    const link=document.createElement('a');
    link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=text;
    return link;
  }

  function renderCountryBrief(){
    const country = reportLayers.countries.feed.events.find(event=>event.id===selectedReport);
    const entry=countryBrief;
    renderCountryCard(reportDetail,country,entry);
    if(selectedCityMention?.city && selectedCityMention?.url){
      const note=document.createElement('div');note.className='country-city-note';
      note.textContent='Map pin: '+selectedCityMention.city+' is mentioned in a headline. This is not a verified incident location.';
      reportDetail.append(note,reportLink(selectedCityMention.url,'Read headline mentioning '+selectedCityMention.city));
    }
  }

  async function refreshCountryBrief(){
    const entry=countryBrief;
    if(!entry || entry.loading || entry.id!==selectedReport || Date.now()<(entry.retryAt||0))return;
    entry.loading=true;
    const controller=new AbortController();
    const requestTimeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/api/country-news/'+encodeURIComponent(entry.id),{cache:'no-store',signal:controller.signal});
      if(response.status===429){
        const retry=Number(response.headers.get('Retry-After'));
        entry.retryAt=Date.now()+Math.max(30,Number.isFinite(retry)?retry:0)*1000;
        entry.failed=true;
        entry.message='Country headlines are rate limited. '+retryMessage(response);
        return;
      }
      if(!response.ok)throw Error('Country news unavailable');
      Object.assign(entry,countryRefreshResult(entry.data,await response.json()));
      if(!entry.failed)entry.change=window.ClearIntelCountryChanges?.(entry.id,entry.data);
      entry.retryAt=entry.failed?Date.now()+countryRefreshMs:0;
    }catch(_){entry.failed=true;entry.message='Refresh unavailable';entry.retryAt=Date.now()+30000;}
    finally{
      clearTimeout(requestTimeout);
      entry.loading=false;
      if(layer.value==='countries' && countryBrief===entry && selectedReport===entry.id){renderReports();draw();}
    }
  }

  async function refreshReports(key=layer.value){
    const active=reportLayers[key];
    if(!active||active.loading||Date.now()<(active.retryAt||0)||(!active.mode&&reportsPaused)||(active.mode&&active.feed))return;
    active.loading=true;
    const started=Date.now();
    try{
      if(active.mode==='archive'&&!militaryArchive){
        militaryArchive=loadReportFeed(active.endpoint).catch(error=>{militaryArchive=null;throw error;});
      }
      const latest=await (active.mode==='archive'?militaryArchive:loadReportFeed(active.endpoint));
      if(!Array.isArray(latest.events)||(!active.mode&&!Number.isFinite(latest[active.feedTime])))throw Error('Invalid report data');
      if(active.mode==='countries'){
        for(const event of latest.events)countrySelect.add(new Option(event.place,event.id));
      }
      if(active.mode || !reportsPaused){
        active.feed=active.mode==='archive'
          ? {events:latest.events.filter(event=>event.category===active.category)}
          : latest;
        active.failed=false;
        active.retryAt=started+(key==='incidents'?295000:key==='wildfires'?115000:55000);
      }
    }catch(error){if(active.mode||!reportsPaused){active.failed=true;active.retryAt=Math.max(Date.now()+30000,error.retryAt||0);}}
    finally{
      active.loading=false;
      // Reuse already retrieved USGS observations. The activity chart never
      // starts another request or invents counts during provider failures.
      if(active===reportLayers.earthquakes){
        const snapshot=active.feed?{
          events:active.feed.events, generated_at_ms:active.feed.generated_at_ms,
          stale:Boolean(active.feed.stale), unavailable:Boolean(active.failed),
        }:{unavailable:true};
        window.dispatchEvent(new CustomEvent('clearintel:earthquake-snapshot',{detail:snapshot}));
      }
      if(active===reportLayers.wildfires){
        const snapshot=active.feed?{
          events:active.feed.events, checked_at_ms:active.feed.checked_at_ms,
          stale:Boolean(active.feed.stale), unavailable:Boolean(active.failed),
        }:{unavailable:true};
        window.dispatchEvent(new CustomEvent('clearintel:wildfire-snapshot',{detail:snapshot}));
      }
      if(reportLayers[layer.value]===active){renderReports();draw();}
    }
  }

  async function loadReportFeed(endpoint){
    const response=await ClearIntelMapRefresh.fetch(endpoint);
    if(!response.ok){const error=new Error('Report feed unavailable');error.retryAt=ClearIntelMapRefresh.retryAt(response);throw error;}
    return response.data;
  }

  countrySelect.addEventListener('change',()=>{
    const event=reportLayers.countries.feed?.events.find(event=>event.id===countrySelect.value);
    clusterIds=null;
    if(event){
      selectReport(event);
    }else{
      selectedReport=null;selectedCityMention=null;countryBrief=null;renderReports();draw();
    }
  });
  reportShowAll.addEventListener('click',()=>{
    clusterIds=null;
    renderReports();draw();
    (reportList.querySelector('button')||(layer.value==='countries'?countrySelect:reportWindow)).focus({preventScroll:true});
  });
  incidentFilter.addEventListener('change',()=>{clusterIds=null;timelineStart=null;selectedReport=null;renderReports();draw();});
  reportWindow.addEventListener('change',()=>{
    reportLayers[layer.value].window=reportWindow.value;
    clusterIds=null;timelineStart=null;selectedReport=null;renderReports();draw();
  });
  reportPause.addEventListener('click',()=>{
    reportsPaused=!reportsPaused;
    reportPause.textContent=reportsPaused?'Resume updates':'Pause updates';
    reportPause.setAttribute('aria-pressed',String(reportsPaused));
    renderReports();
    draw();
    if(!reportsPaused){refreshReports();refreshPulseObservations();}
  });
  function changeLayer(){
    document.getElementById('ukmto-bulletins').hidden=layer.value!=='maritime';
    const active=reportLayers[layer.value];
    dashboard.dataset.layer=layer.value;
    const wasArchive=archiveActive;
    archiveActive=active?.mode==='archive';
    militaryLegend.hidden=!archiveActive;
    if(archiveActive)militaryKind.textContent=active.kind;
    clusterIds=null;selectedReport=null;selectedCityMention=null;timelineStart=null;visibleReports=[];countryBrief=null;
    reportPanel.hidden=!active;issPanel.hidden=Boolean(active);
    feedHeading.textContent=active?.mode?active.name:'Live feed';
    countryControls.hidden=active?.mode!=='countries';
    incidentControls.hidden=layer.value!=='incidents';
    reportControls.hidden=Boolean(active?.mode);
    reportTimeline.hidden=Boolean(active?.mode);
    reportShowAll.textContent=active?.mode==='countries'?'Clear group':'Show all reports';
    if(!wasArchive&&archiveActive&&preferFlat){
      previousWorld=null;
      rot=0;tilt=12;
      setZoom(1);
    }
    if(archiveActive&&mobileDashboard.matches)showDashboardView('map');
    updateProjection();
    if(active){
      if(!active.mode)reportWindow.value=active.window;
      reportList.setAttribute('aria-label',active.mode==='countries'?'Countries and territories':`${active.name} reports`);
      renderReports();refreshReports();
    }else{refreshISS();}
    draw();
  }
  layer.addEventListener('change',changeLayer);
  window.ClearIntelGlobeSurface?.load(()=>draw());
  fetch('/assets/world-map.json').then(response=>{
    if(!response.ok)throw Error('World map unavailable');
    return response.json();
  }).then(data=>{
    worldMap=prepareWorldMap(data);draw();
  }).catch(()=>fetch('/assets/earth-land.json').then(response=>{
    if(!response.ok)throw Error('Map fallback unavailable');
    return response.json();
  }).then(data=>{if(Array.isArray(data)){points=data;draw();}loadUKCoastline();}).catch(()=>{}));
  // The UK-specific fallback is not required for the initial world overview.
  // Keep the control usable with the overview while regional data is retrieved.
  ukView.disabled=false;
  function loadUKCoastline(){
    if(coastline)return Promise.resolve();
    if(coastlineLoading)return coastlineLoading;
    coastlineLoading=ClearIntelMapRefresh.fetch('/assets/uk-coastline.json').then(response=>{
      if(!response.ok)throw Error('Coastline unavailable');
      const data=response.data;
      if(!Array.isArray(data.bounds)||data.bounds.length!==4||!Array.isArray(data.tracks))throw Error('Invalid coastline data');
      coastline={bounds:data.bounds,tracks:data.tracks.map(coords=>{
        const first=coords[0],last=coords.at(-1);
        return {coords,closed:coords.length>=4&&first[0]===last[0]&&first[1]===last[1]};
      })};
      draw();
    }).catch(()=>{}).finally(()=>{coastlineLoading=null;});
    return coastlineLoading;
  }
  if('ResizeObserver' in window)new ResizeObserver(()=>{fit();draw();}).observe(canvas);
  else window.addEventListener('resize',()=>{fit();draw();});
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      mapInView=entries.some(entry=>entry.isIntersecting);
      if(mapInView)draw();
      syncRotation();
    });
    observer.observe(canvas);
  }
  function refreshPulseObservations(){
    if(document.hidden||reportsPaused)return;
    refreshReports('earthquakes');
    refreshReports('wildfires');
  }
  fit();draw();
  changeLayer();
  refreshPulseObservations();
  syncRotation();
  document.addEventListener('visibilitychange',()=>{
    syncRotation();
    if(document.hidden)return;
    refreshPulseObservations();
    if(layer.value==='iss')refreshISS();
    else if(!reportsPaused||reportLayers[layer.value]?.mode)refreshReports();
  });
  setInterval(()=>{if(!document.hidden&&layer.value==='iss')refreshISS();},30000);
  setInterval(()=>{
    if(!document.hidden&&layer.value==='countries')refreshCountryBrief();
  },countryRefreshMs);
  setInterval(()=>{
    refreshPulseObservations();
    if(document.hidden||!reportLayers[layer.value])return;
    if(reportLayers[layer.value].mode){
      if(!reportLayers[layer.value].feed)refreshReports();
      return;
    }
    if(reportsPaused){renderReports();draw();}else refreshReports();
  },60000);
})();
