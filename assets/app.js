'use strict';
const $ = id => document.getElementById(id);
const el = (name, cls, text) => { const node = document.createElement(name); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; };

// Compare successive successful country feed checks in this browser session.
// Badges describe feed changes, not independently verified real-world events.
const countrySnapshots = new Map();
window.ClearIntelCountryChanges = (code, data) => {
  const current = (data.stories || []).map(group => {
    const report = group.reports?.[0];
    return {url: report?.url || '', title: report?.title || '',
      sources: (group.reports || []).map(item => item.url).sort().join('|')};
  }).filter(item => item.url);
  const previous = countrySnapshots.get(code);
  countrySnapshots.set(code, current);
  if (!previous) return {statuses: current.map(() => ''), newCount: 0, updatedCount: 0, initial: true};
  const byUrl = new Map(previous.map(item => [item.url, item]));
  const statuses = current.map(item => {
    const old = byUrl.get(item.url);
    if (!old) return 'new';
    return old.title !== item.title || old.sources !== item.sources ? 'updated' : '';
  });
  return {statuses, newCount: statuses.filter(value => value === 'new').length,
    updatedCount: statuses.filter(value => value === 'updated').length, initial: false};
};

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
    // Fixed-position popovers must be measured against the visible viewport.
    // This avoids clipping the help text off the left edge on small phones.
    const target = button.getBoundingClientRect();
    const width = Math.min(280, Math.max(160, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12,
      target.left + target.width / 2 - width / 2));
    panel.style.width = width + 'px';
    panel.style.left = left + 'px';
    panel.style.top = Math.max(12, Math.min(window.innerHeight - panel.offsetHeight - 12,
      target.bottom + 10)) + 'px';
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
window.addEventListener('resize', closeHelp);
document.addEventListener('scroll', closeHelp, true);

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

function renderCountryCard(container,country,entry){
  function reportLink(url, text){
    const link=document.createElement('a');
    link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=text;
    return link;
  }

    const utcTime=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
    const utcDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium'});
    const title=document.createElement('strong');
    title.textContent='Top stories · '+country.place;
    const status=document.createElement('span');
    status.setAttribute('role','status');
    const data=entry?.data;
    const stories=data?.stories||(data?.story?.length?[{basis:data.basis,reports:data.story}]:[]);
    const labels={
      national:'National edition', developing:'Multiple outlets', publisher:'Publisher’s selection',
      editorial:'International digest', national_digest:'National digest',
      weekly:'From the past week', recent:'Recent coverage',
    };
    if(!entry?.data){
      status.textContent=entry?.failed?'The news sources are temporarily unavailable.':'Checking national headlines…';
    }else if(!stories.length){
      status.textContent='No leading headline available from the sources checked.';
    }else{
      const count=data.publisher_count;
      const coverage=Number.isInteger(count)?` · ${count} ${count===1?'publisher':'publishers'} found`:'';
      status.textContent=`Checked ${utcTime.format(new Date(data.checked_at_utc))} UTC${coverage}`;
    }
    if(entry?.data?.provider_errors.length)status.textContent+=' · Partial source coverage';
    if(entry?.data && entry.failed)status.textContent+=' · Refresh unavailable';
    if(entry?.change && (entry.change.newCount || entry.change.updatedCount)){
      const parts=[];
      if(entry.change.newCount)parts.push(entry.change.newCount+' new in feed');
      if(entry.change.updatedCount)parts.push(entry.change.updatedCount+' changed');
      status.textContent+=' · Since previous check: '+parts.join(', ');
    }
    const links=document.createElement('div');
    links.className='country-sources';
    const list=document.createElement('ol');
    list.className='country-top-stories';
    for(const [index,group] of stories.entries()){
      const [article,...related]=group.reports;
      const row=document.createElement('li');
      const content=document.createElement('div');
      row.append(content);
      list.append(row);
      const change=entry?.change?.statuses?.[index];
      if(change)content.append(el('span','country-change-badge',change==='new'?'New in feed':'Updated in feed'));
      const link=reportLink(article.url, article.title);
      const source=document.createElement('span');
      const timestamp=new Date(article.feed_time_utc);
      if(article.editorial){
        source.textContent=`${article.source||'Publisher'} · Event date · ${utcDate.format(timestamp)}`;
        content.append(link,source);
        for(const citation of article.citations.slice(1)){
          content.append(reportLink(citation.url,citation.name||'Publisher report'));
        }
        const attribution=document.createElement('span');
        attribution.append(
          document.createTextNode('Adapted and shortened from '),
          reportLink(article.attribution_url, article.attribution_title||'Wikipedia Current events'),
          document.createTextNode(' · '),
          reportLink('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0'),
        );
        content.append(attribution);
      }else{
        source.textContent=`${article.source||'Publisher'} · ${article.time_basis} · ${utcTime.format(timestamp)} UTC`;
        content.append(link,source);
      }
      source.textContent+=' · '+(labels[group.basis]||'Recent coverage');
      for(const report of related){
        if(!report.editorial)content.append(reportLink(report.url,'Also covered by '+report.source));
      }
    }
    if(stories.length)links.append(list);
    if(data?.city_mentions?.length){
      const mentionCount=data.city_mentions.length;
      links.append(el('span','country-city-note',mentionCount+' city '+(mentionCount===1?'mention':'mentions')+
        ' located from headlines. Map pins show mentioned places, not verified incident positions.'));
    }
    if(entry?.data?.edition_url){
      links.append(reportLink(entry.data.edition_url,'Open national headlines on Google News'));
    }else if(!stories.length && (entry?.data||entry?.failed)){
      const external=new URL('https://news.google.com/search');
      external.searchParams.set('q',country.place+' when:1d');
      external.searchParams.set('hl','en-GB');
      links.append(reportLink(external.href,'Browse recent headlines on Google News'));
    }
    container.replaceChildren(title,status,links);
}

let countryList;
let countrySearchVersion=0;
async function showSearchCountry(query){
  const version=++countrySearchVersion;
  const panel=$('search-country');
  panel.hidden=true;
  try{
    countryList??=fetch('/assets/countries.json').then(r=>r.json()).then(data=>data.events)
      .catch(error=>{countryList=null;throw error;});
    const places=await countryList;
    const aliases={uk:'GB',usa:'US','united states of america':'US',britain:'GB','españa':'ES'};
    const term=query.toLowerCase();
    const country=places.find(item=>item.id===(aliases[term]||query.toUpperCase())||item.place.toLowerCase()===term);
    if(!country||version!==countrySearchVersion)return;
    panel.hidden=false;
    renderCountryCard(panel,country,null);
    try{
      const response=await fetch('/api/country-news/'+encodeURIComponent(country.id));
      if(!response.ok)throw Error();
      const data=await response.json();
      if(version===countrySearchVersion)renderCountryCard(panel,country,{
        data,change:window.ClearIntelCountryChanges(country.id,data)});
    }catch{
      if(version===countrySearchVersion)renderCountryCard(panel,country,{failed:true});
    }
  }catch{ /* General news search still runs when the country index is unavailable. */ }
}

function renderResults(payload,search){
  const area=$('news-results');area.replaceChildren();
  const header=el('div','results-header');
  const left=el('div','');left.append(el('span','result-kicker','PUBLIC NEWS FEED · UTC'),el('h3','',`${payload.results.length} ${search.incidentOnly?'matching incident':'matching news'} headline${payload.results.length===1?'':'s'}`));
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
  showSearchCountry(query);
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
