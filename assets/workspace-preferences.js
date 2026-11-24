'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const key='clearintel.favorite-countries.v1', compactKey='clearintel.compact-dashboard.v1';
  let favorites=[];
  try{
    const raw=localStorage.getItem(key);
    if(raw&&raw.length<12000){
      const values=JSON.parse(raw);
      if(Array.isArray(values))favorites=values.filter(x=>x&&/^[A-Z]{2}$/.test(x.code)&&typeof x.name==='string'&&x.name.length<=120).slice(0,20);
    }
  }catch{}
  const toggle=$('favorite-country-toggle'), panel=$('favorite-countries'), list=$('favorite-country-list');
  function render(){
    if(toggle){
      const selected=favorites.some(x=>x.code===toggle.dataset.code);
      toggle.setAttribute('aria-pressed',String(selected));toggle.textContent=selected?'Remove favourite':'Save favourite';toggle.hidden=false;
    }
    if(panel&&list){
      list.replaceChildren();panel.hidden=!favorites.length;
      for(const item of favorites){
        const li=document.createElement('li'),link=document.createElement('a');
        link.href='/countries/'+item.code.toLowerCase();link.textContent=item.name;li.append(link);list.append(li);
      }
    }
  }
  if(toggle)toggle.addEventListener('click',()=>{
    const code=toggle.dataset.code,name=toggle.dataset.name;
    if(!/^[A-Z]{2}$/.test(code)||!name||name.length>120)return;
    const selected=favorites.some(x=>x.code===code);
    if(!selected&&favorites.length>=20){toggle.textContent='20 favourites saved — remove one first';return;}
    const next=selected?favorites.filter(x=>x.code!==code):[...favorites,{code,name}];
    try{localStorage.setItem(key,JSON.stringify(next));favorites=next;render();}
    catch{toggle.textContent='Local storage unavailable';}
  });
  render();
  const compact=$('compact-dashboard');
  if(compact){
    try{compact.checked=localStorage.getItem(compactKey)==='true';}catch{}
    document.body.classList.toggle('compact-dashboard',compact.checked);
    compact.addEventListener('change',()=>{
      document.body.classList.toggle('compact-dashboard',compact.checked);
      try{localStorage.setItem(compactKey,String(compact.checked));}catch{}
    });
  }
  const track=$('pulse-mobile-panels');
  if(track){
    const buttons=[...document.querySelectorAll('[data-pulse-slide]')];
    const active=id=>buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pulseSlide===id)));
    for(const button of buttons)button.addEventListener('click',()=>{
      const slide=$(button.dataset.pulseSlide);
      if(!slide)return;
      track.scrollTo({left:slide.offsetLeft-track.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});active(slide.id);
    });
    let scheduled=false;
    track.addEventListener('scroll',()=>{
      if(scheduled)return;scheduled=true;
      requestAnimationFrame(()=>{
        scheduled=false;
        const left=track.getBoundingClientRect().left;
        const nearest=[...track.children].sort((a,b)=>Math.abs(a.getBoundingClientRect().left-left)-Math.abs(b.getBoundingClientRect().left-left))[0];
        if(nearest)active(nearest.id);
      });
    },{passive:true});
  }
})();
