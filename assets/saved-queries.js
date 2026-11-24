'use strict';
(() => {
  const $=id=>document.getElementById(id), KEY='clearintel.saved-queries.v1', MAX=20;
  const list=$('saved-query-list'), status=$('saved-query-status'), clear=$('saved-query-clear');
  if(!list)return;
  let items=[];
  function clean(value){
    if(!value||typeof value.query!=='string'||!['24h','7d'].includes(value.window))return null;
    const query=value.query.trim();
    if(query.length<2||query.length>140||/[\u0000-\u001f]/.test(query))return null;
    return {query,window:value.window,incidentOnly:value.incidentOnly===true};
  }
  function persist(next){
    try{localStorage.setItem(KEY,JSON.stringify(next));items=next;render();return true;}
    catch{status.textContent='Browser storage unavailable. No changes saved.';return false;}
  }
  function render(){
    list.replaceChildren();clear.disabled=!items.length;
    for(const [index,item] of items.entries()){
      const li=document.createElement('li'), text=document.createElement('span'), load=document.createElement('button'), remove=document.createElement('button');
      text.textContent=item.query+' · '+(item.window==='24h'?'24 hours':'7 days')+(item.incidentOnly?' · Incident headlines':' · All headlines');
      load.type=remove.type='button';load.className=remove.className='globe-control';
      load.textContent='Load settings';remove.textContent='Remove';
      load.setAttribute('aria-label','Load search settings for '+item.query);remove.setAttribute('aria-label','Remove saved search '+item.query);
      load.addEventListener('click',()=>{$('news-query').value=item.query;$('news-window').value=item.window;$('incident-only').checked=item.incidentOnly;status.textContent='Settings loaded. Choose Search recent reports to run the search.';$('news-query').focus();});
      remove.addEventListener('click',()=>{if(persist(items.filter((_,i)=>i!==index)))status.textContent='Saved search removed.';});
      li.append(text,load,remove);list.append(li);
    }
  }
  try{
    const raw=localStorage.getItem(KEY);
    if(raw&&raw.length<=20000){const parsed=JSON.parse(raw);if(Array.isArray(parsed))items=parsed.slice(0,MAX).map(clean).filter(Boolean);}
  }catch{status.textContent='Saved search storage could not be read.';}
  $('saved-query-save').addEventListener('click',()=>{
    const item=clean({query:$('news-query').value,window:$('news-window').value,incidentOnly:$('incident-only').checked});
    if(!item){status.textContent='Enter a valid topic with at least two characters.';return;}
    const same=x=>x.query.toLowerCase()===item.query.toLowerCase()&&x.window===item.window&&x.incidentOnly===item.incidentOnly;
    if(items.some(same)){status.textContent='These search settings are already saved.';return;}
    if(items.length>=MAX){status.textContent='20 searches saved. Remove one before saving another.';return;}
    if(persist([item,...items]))status.textContent='Search settings saved in this browser only.';
  });
  clear.addEventListener('click',()=>{
    if(!confirm('Clear all saved search settings from this browser?'))return;
    try{localStorage.removeItem(KEY);items=[];render();status.textContent='Saved search settings cleared.';}
    catch{status.textContent='Browser storage could not be cleared.';}
  });
  render();
})();
