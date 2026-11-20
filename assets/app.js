'use strict';
const $ = id => document.getElementById(id);
const el = (name, cls, text) => { const node = document.createElement(name); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; };

// Click, hover and keyboard-friendly contextual help. All text is textContent, not HTML.
function closeHelp(except) {
  document.querySelectorAll('.help-button').forEach(button => {
    if(button===except)return;
    button.dataset.pinned='';
    button.setAttribute('aria-expanded','false');
    const pop = button.parentElement.querySelector('.help-popover');
    if(pop)pop.remove();
  });
}
document.querySelectorAll('.help-button').forEach(button => {
  const show = () => {
    if(button.getAttribute('aria-expanded')==='true')return;
    closeHelp(button);button.setAttribute('aria-expanded','true');
    const pop=el('div','help-popover',button.dataset.help);
    pop.setAttribute('role','tooltip');button.parentElement.appendChild(pop);
  };
  button.addEventListener('mouseenter',show);
  button.addEventListener('click',e=>{
    e.stopPropagation();
    const pinned=button.dataset.pinned==='1';
    closeHelp();
    if(!pinned){show();button.dataset.pinned='1';}
  });
  button.parentElement.addEventListener('mouseleave',()=>{
    if(button.dataset.pinned!=='1')closeHelp();
  });
});
document.addEventListener('click',e=>{if(!e.target.closest('.help-wrapper'))closeHelp();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHelp();});

// Mobile navigation.
$('menu-toggle').addEventListener('click',()=>{
  const expanded=$('menu-toggle').getAttribute('aria-expanded')==='true';
  $('menu-toggle').setAttribute('aria-expanded',String(!expanded));
  $('mobile-nav').hidden=expanded;
});
document.querySelectorAll('#mobile-nav a').forEach(a=>a.addEventListener('click',()=>{
  $('mobile-nav').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');
}));

const details={
  '3':['GRADE 03 / STRONG MATCH','Exact identifier or identical file','A public register number exactly matches the identifier searched, or two files have the same cryptographic hash. The specific match is strong, but context still matters.'],
  '2':['GRADE 02 / PUBLISHED LINK','Published connection','The source openly declares a link between a website and a profile, or an image search reports a full-image match. Ownership and intent are not established by the link alone.'],
  '1':['GRADE 01 / RESEARCH LEAD','Contextual similarity','A similar title, handle or name appears in a public result. It may refer to someone or something else and needs independent review before reporting.']
};
document.querySelectorAll('.grade').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.grade').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  const [label,title,description]=details[button.dataset.grade];
  const target=$('grade-detail');target.replaceChildren();
  target.append(el('span','grade-label',label),el('h3','',title),el('p','',description),el('div','grade-footer','EXAMPLE ONLY  •  ANALYST REVIEW REQUIRED'));
}));

// Enquiries are locally generated, nothing submitted or persisted by this site.
document.querySelectorAll('.choose-service').forEach(button=>button.addEventListener('click',()=>{
  $('enquiry-service').value=button.dataset.service;
  $('contact').scrollIntoView({behavior:'smooth',block:'start'});
  $('enquiry-brief').focus({preventScroll:true});
}));
$('enquiry-form').addEventListener('submit',e=>{
  e.preventDefault();
  const subject='ClearIntel enquiry: '+$('enquiry-service').value;
  const body='Research area: '+$('enquiry-service').value+'\n\nProject question:\n'+($('enquiry-brief').value.trim() || '(Please describe your research question)')+'\n\nIntended purpose: \n\nPreferred timeframe: ';
  window.location.href='mailto:contactclearintel@protonmail.me?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
});
$('year').textContent=new Date().getFullYear();

function fillStatus(title,description,kind='info'){
  const area=$('news-results');area.replaceChildren();
  const state=el('div','state-note '+kind);state.append(el('strong','',title),el('p','',description));area.append(state);
}
function renderResults(payload,incidentOnly){
  const area=$('news-results');area.replaceChildren();
  const header=el('div','results-header');
  const left=el('div','');left.append(el('span','result-kicker','PUBLIC NEWS FEED · UTC'),el('h3','',`${payload.results.length} recent matching headline${payload.results.length===1?'':'s'}`));
  const window=el('span','result-window', $('news-window').value==='24h'?'Last 24 hours':'Last 7 days');
  header.append(left,window);area.append(header);
  const notice=el('div','result-warning',payload.notice);area.append(notice);
  if(payload.provider_errors?.length){ area.append(el('p','provider-note','Some providers were unavailable: '+payload.provider_errors.join('; ')+'. Results may be incomplete.')); }
  if(!payload.results.length){area.append(el('div','empty-results','Try a broader term or 7-day window. No headline match does not establish that nothing happened.'));}
  const list=el('div','result-list');
  for(const article of payload.results){
    const card=el('article','result-card');
    const eyebrow=el('div','result-meta',article.source+' · '+(article.time_basis||'Feed time')+' · '+new Date(article.feed_time_utc).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC');
    const link=el('a','result-title',article.title);link.href=article.url;link.target='_blank';link.rel='noopener noreferrer nofollow';
    const incidentTime=incidentOnly&&article.incident_time_utc==null?' · Incident time unknown':'';
    card.append(eyebrow,link,el('div','result-provider',article.provider+incidentTime));
    list.append(card);
  }
  area.append(list);
  const sources=payload.sources_checked?.length?payload.sources_checked.join(' and '):'no sources';
  area.append(el('div','results-foot','Sources queried: '+sources+'. Feed timestamps may be publication or first-seen dates; they do not establish the incident date.'));
}
$('news-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const query=$('news-query').value.trim();if(query.length<3)return;
  const incidentOnly=$('incident-only').checked;
  const submit=$('news-submit');submit.disabled=true;
  fillStatus('Checking recent news feeds…','Looking for published headlines that actually match the time window and subject.');
  $('news-results').scrollIntoView({behavior:'smooth',block:'nearest'});
  let timeout;
  try{
    const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),25000);
    const response=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,window:$('news-window').value,incident_only:incidentOnly}),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{payload={};}
    if(!response.ok)throw new Error(typeof payload.detail==='string'?payload.detail:'News search could not be completed.');
    renderResults(payload,incidentOnly);
  }catch(err){fillStatus('Live search unavailable',err.name==='AbortError'?'The sources did not respond within the time limit. Try again.':err.message,'error');}
  finally{clearTimeout(timeout);submit.disabled=false;}
});
