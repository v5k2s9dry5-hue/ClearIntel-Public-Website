'use strict';
const $ = id => document.getElementById(id);
const el = (name, cls, text) => { const node = document.createElement(name); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; };

// Contextual help opens on click or keyboard activation, with hover on desktop.
const hoverHelp = window.matchMedia('(min-width: 761px) and (hover: hover)');
let openHelp = null;

document.querySelectorAll('.help-button').forEach((button, index) => {
  const wrapper = button.parentElement;
  const panel = el('div', 'help-popover', button.dataset.help);
  panel.id = 'help-panel-' + (index + 1);
  panel.hidden = true;
  button.setAttribute('aria-controls', panel.id);
  wrapper.appendChild(panel);

  const show = pinned => {
    closeHelp();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-describedby', panel.id);
    openHelp = { button, panel, pinned };
  };

  button.addEventListener('pointerenter', event => {
    if (hoverHelp.matches && event.pointerType === 'mouse' && !openHelp?.pinned) show(false);
  });
  wrapper.addEventListener('pointerleave', () => {
    if (openHelp?.button === button && !openHelp.pinned) closeHelp();
  });
  button.addEventListener('click', () => {
    if (openHelp?.button === button && openHelp.pinned) closeHelp();
    else show(true);
  });
});

function closeHelp() {
  if (!openHelp) return;
  const { button, panel } = openHelp;
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.removeAttribute('aria-describedby');
  openHelp = null;
}

document.addEventListener('click', event => {
  if (!event.target.closest('.help-wrapper')) closeHelp();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeHelp();
});

// A fresh homepage visit starts at the top. Section links and history navigation
// keep their own scroll positions.
window.addEventListener('pageshow', event => {
  const navigation = performance.getEntriesByType('navigation')[0];
  if(event.persisted || navigation?.type === 'back_forward' || window.location.hash) return;
  window.requestAnimationFrame(() => {
    if(!window.location.hash) window.scrollTo({top:0, left:0, behavior:'instant'});
  });
});

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
function reportExport(payload,search){
  const controls=el('section','report-export');
  controls.setAttribute('aria-label','Export search report');
  const actions=el('div','report-export-actions');
  const count=el('span','report-export-count');
  const toggle=el('button','globe-control','Deselect all');toggle.type='button';
  const download=el('button','button button-primary','Download PDF');download.type='button';
  actions.append(count,toggle,download);
  const options=el('details','report-notes');
  const notesLabel=el('label','','Notes to include');notesLabel.htmlFor='report-notes-input';
  const notes=el('textarea','');notes.id='report-notes-input';notes.rows=4;notes.maxLength=1200;
  options.append(el('summary','','Add notes'),notesLabel,notes);
  const status=el('div','report-download-status');status.setAttribute('role','status');
  controls.append(actions,options,status);

  const choices=[];
  let busy=false;
  function selected(){return choices.flatMap((choice,index)=>choice.checked?[payload.results[index]]:[]);}
  function refreshSelection(){
    const included=selected().length;
    count.textContent=choices.length?included+' of '+choices.length+' included':'No findings to select';
    toggle.hidden=!choices.length;
    toggle.textContent=included===choices.length?'Deselect all':'Select all';
    download.disabled=busy||(choices.length>0&&included===0);
  }
  toggle.addEventListener('click',()=>{
    const check=selected().length!==choices.length;
    choices.forEach(choice=>{choice.checked=check;});
    refreshSelection();
  });
  download.addEventListener('click',async()=>{
    const findings=selected();
    if(busy||(choices.length&&!findings.length))return;
    busy=true;refreshSelection();status.textContent='Preparing PDF…';
    try{
      await window.ClearIntelReport.download({
        query:search.query,incidentOnly:search.incidentOnly,exportedAt:new Date().toISOString(),
        windowStart:payload.window_start,windowEnd:payload.window_end,findings,total:payload.results.length,
        sources:payload.sources_checked||[],providerErrors:payload.provider_errors||[],notice:payload.notice,
        notes:notes.value,
      });
      status.textContent='Download started.';
    }catch(_){status.textContent='Could not create the PDF. Try again.';}
    finally{busy=false;refreshSelection();}
  });
  function choiceFor(article){
    const label=el('label','report-include','');
    const input=el('input','');input.type='checkbox';input.checked=true;
    input.setAttribute('aria-label','Include in PDF: '+article.title);
    input.addEventListener('change',refreshSelection);
    choices.push(input);
    label.append(input,el('span','','Include in PDF'));
    return label;
  }
  return {controls,choiceFor,refreshSelection};
}

function renderResults(payload,search){
  const area=$('news-results');area.replaceChildren();
  const header=el('div','results-header');
  const left=el('div','');left.append(el('span','result-kicker','PUBLIC NEWS FEED · UTC'),el('h3','',`${payload.results.length} recent matching headline${payload.results.length===1?'':'s'}`));
  const timeWindow=el('span','result-window', search.window==='24h'?'Last 24 hours':'Last 7 days');
  header.append(left,timeWindow);area.append(header);
  const notice=el('div','result-warning',payload.notice);area.append(notice);
  if(payload.provider_errors?.length){ area.append(el('p','provider-note','Some providers were unavailable: '+payload.provider_errors.join('; ')+'. Results may be incomplete.')); }
  const exportUi=window.ClearIntelReport?reportExport(payload,search):null;
  if(exportUi)area.append(exportUi.controls);
  if(!payload.results.length){area.append(el('div','empty-results','Try a broader term or 7-day window. No headline match does not establish that nothing happened.'));}
  const list=el('div','result-list');
  for(const article of payload.results){
    const card=el('article','result-card');
    const eyebrow=el('div','result-meta',article.source+' · '+(article.time_basis||'Feed time')+' · '+new Date(article.feed_time_utc).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC');
    const link=el('a','result-title',article.title);link.href=article.url;link.target='_blank';link.rel='noopener noreferrer nofollow';
    const incidentTime=search.incidentOnly&&article.incident_time_utc==null?' · Incident time unknown':'';
    card.append(eyebrow,link,el('div','result-provider',article.provider+incidentTime));
    if(exportUi)card.append(exportUi.choiceFor(article));
    list.append(card);
  }
  area.append(list);
  if(exportUi)exportUi.refreshSelection();
  const sources=payload.sources_checked?.length?payload.sources_checked.join(' and '):'no sources';
  area.append(el('div','results-foot','Sources queried: '+sources+'. Feed timestamps may be publication or first-seen dates; they do not establish the incident date.'));
}
$('news-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const query=$('news-query').value.trim();
  if(query.length<2){
    fillStatus('Enter at least two characters','Try a country abbreviation such as UK or US.','error');
    return;
  }
  const incidentOnly=$('incident-only').checked;
  const timeWindow=$('news-window').value;
  const submit=$('news-submit');submit.disabled=true;
  fillStatus('Checking recent news feeds…','Looking for published headlines that actually match the time window and subject.');
  $('news-results').scrollIntoView({behavior:'smooth',block:'nearest'});
  let timeout;
  try{
    const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),25000);
    const response=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,window:timeWindow,incident_only:incidentOnly}),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{payload={};}
    if(!response.ok)throw new Error(typeof payload.detail==='string'?payload.detail:'News search could not be completed.');
    renderResults(payload,{query,window:timeWindow,incidentOnly});
  }catch(err){fillStatus('Live search unavailable',err.name==='AbortError'?'The sources did not respond within the time limit. Try again.':err.message,'error');}
  finally{clearTimeout(timeout);submit.disabled=false;}
});
