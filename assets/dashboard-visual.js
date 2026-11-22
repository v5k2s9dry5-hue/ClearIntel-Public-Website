'use strict';
(() => {
  const layer=document.getElementById('globe-layer');
  const source=document.getElementById('map-layer-source');
  const kind=document.getElementById('map-layer-kind');
  const map=document.getElementById('dashboard-map');
  if(!layer||!source||!kind||!map)return;
  const labels={
    earthquakes:['USGS · Earthquake observations','Public feed','#5de5f4'],
    wildfires:['NASA EONET · Wildfire observations','Public feed','#ffae68'],
    iss:['Where the ISS at? · Position observations','Position feed','#88c9ff'],
    countries:['Country news · Source-linked headlines','News coverage','#a7ef8a'],
    aviation:['Published aviation reports · Completed events','Historical archive','#f3ce70'],
    maritime:['Published naval reports · Completed events','Historical archive','#b3a7ff']
  };
  function update(){
    const [name,type]=labels[layer.value]||['Public sources','Feed','#65d9ef'];
    source.textContent=name;
    kind.textContent=type;
    // Category identity, not severity or confirmation; set via data attribute (CSP safe).
    map.dataset.category=layer.value;
  }
  layer.addEventListener('change',update);
  update();
})();
