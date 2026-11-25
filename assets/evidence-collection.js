'use strict';
(()=>{
  const $=id=>document.getElementById(id), KEY='clearintel.evidence-collection.v1', MAX=50;
  const list=$('collection-list'),status=$('collection-status'),clear=$('collection-clear'),download=$('collection-export');
  if(!list)return;
  let records=[];
  const filter=$('collection-filter'),order=$('collection-order'),count=$('collection-count');
  function clean(row){
    if(!row||typeof row.title!=='string'||typeof row.url!=='string'||row.url.length>2000)return null;
    let u;try{u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password)return null;u.hash='';}catch{return null;}
    const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
    return {title:row.title.slice(0,300),url:u.href,source:String(row.source||'Unknown').slice(0,120),feed_time_utc:stamp(row.feed_time_utc),saved_at_utc:stamp(row.saved_at_utc)||new Date().toISOString()};
  }
  function render(){
    list.replaceChildren();clear.disabled=download.disabled=!records.length;
    const term=filter.value.trim().toLowerCase();
    const view=records.map((row,index)=>({row,index})).filter(({row})=>(row.title+' '+row.source).toLowerCase().includes(term));
    if(order.value!=='saved')view.sort((a,b)=>{const x=Date.parse(a.row.feed_time_utc),y=Date.parse(b.row.feed_time_utc);if(!Number.isFinite(x)||!Number.isFinite(y))return Number.isFinite(x)?-1:Number.isFinite(y)?1:0;return order.value==='newest'?y-x:x-y;});
    count.textContent='Showing '+view.length+' of '+records.length+' saved links. Feed timestamps do not establish event times.';
    for(const {index,row} of view){
      const li=document.createElement('li'),info=document.createElement('span'),link=document.createElement('a'),meta=document.createElement('small'),remove=document.createElement('button');
      link.href=row.url;link.target='_blank';link.rel='noopener noreferrer nofollow';link.textContent=row.title;
      meta.textContent=row.source+' · Feed timestamp: '+(row.feed_time_utc||'Unknown');
      info.append(link,document.createElement('br'),meta);
      remove.type='button';remove.className='globe-control';remove.textContent='Remove';remove.setAttribute('aria-label','Remove saved report '+row.title);
      remove.addEventListener('click',()=>{if(save(records.filter((_,i)=>i!==index)))status.textContent='Report removed.';});
      li.append(info,remove);list.append(li);
    }
  }
  function save(next){try{localStorage.setItem(KEY,JSON.stringify(next));records=next;render();return true;}catch{status.textContent='Browser storage unavailable; no change saved.';return false;}}
  try{const raw=localStorage.getItem(KEY);if(raw&&raw.length<200000){const parsed=JSON.parse(raw);if(Array.isArray(parsed))records=parsed.slice(0,MAX).map(clean).filter(Boolean);}}catch{}
  window.ClearIntelCollection={add(row){
    const item=clean({...row,saved_at_utc:new Date().toISOString()});
    if(!item){status.textContent='This report does not have a valid HTTPS source.';return false;}
    if(records.some(x=>x.url===item.url)){status.textContent='Already in your collection.';return true;}
    if(records.length>=MAX){status.textContent='Collection full. Remove an existing link first.';return false;}
    if(save([item,...records])){status.textContent='Saved locally · '+records.length+' of 50 links.';return true;}return false;
  }};
  clear.addEventListener('click',()=>{if(confirm('Clear all saved source links from this browser?')){try{localStorage.removeItem(KEY);records=[];render();status.textContent='Collection cleared.';}catch{status.textContent='Unable to clear browser storage.';}}});
  download.addEventListener('click',()=>{
    const data={schema:'clearintel.evidence-collection.v1',exported_at_utc:new Date().toISOString(),limitations:'Saved public reporting links; not independent verification.',records};
    const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='ClearIntel-collection.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
  });
  filter.addEventListener('input',render);order.addEventListener('change',render);
  render();
})();
