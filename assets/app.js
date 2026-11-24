'use strict';
const $ = id => document.getElementById(id);

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
    if (window.innerWidth <= 760) {
      // Inline mobile help pushes controls down rather than covering the search
      // input, button or filtering options.
      const anchor = button.closest('.field-head, .filter-row');
      if (anchor) anchor.insertAdjacentElement('afterend', panel);
      panel.style.position = 'static';
      panel.style.width = '100%';
      panel.style.maxWidth = '100%';
      panel.style.left = '';
      panel.style.top = '';
      panel.style.margin = '6px 0 12px';
    } else {
      // On desktops clamp the fixed popup within the visible viewport.
      const target = button.getBoundingClientRect();
      const width = Math.min(280, Math.max(160, window.innerWidth - 24));
      const left = Math.max(12, Math.min(window.innerWidth - width - 12,
        target.left + target.width / 2 - width / 2));
      panel.style.position = 'fixed';
      panel.style.maxWidth = '';
      panel.style.width = width + 'px';
      panel.style.left = left + 'px';
      panel.style.margin = '';
      panel.style.top = Math.max(12, Math.min(window.innerHeight - panel.offsetHeight - 12,
        target.bottom + 10)) + 'px';
    }
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
  if (panel.parentElement !== button.parentElement) button.parentElement.appendChild(panel);
  panel.style.position = '';
  panel.style.maxWidth = '';
  panel.style.margin = '';
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
document.addEventListener('scroll', () => { if (window.innerWidth > 760) closeHelp(); }, true);

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
  const state=el('div','state-note '+kind);
  if(kind==='loading'){
    const progress=el('span','research-spinner');progress.setAttribute('aria-hidden','true');state.append(progress);
  }
  state.append(el('strong','',title),el('p','',description));area.append(state);
}
function reportExport(payload,search){
  const controls=el('section','report-export');
  controls.setAttribute('aria-label','Export search report');
  const actions=el('div','report-export-actions');
  const count=el('span','report-export-count');
  const toggle=el('button','globe-control','Deselect all');toggle.type='button';
  const download=el('button','button button-primary','Download PDF');download.type='button';
  const manifest=el('button','globe-control','Download evidence JSON');manifest.type='button';
  const observedAt=new Date().toISOString();
  actions.append(count,toggle,download,manifest);
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
    manifest.disabled=download.disabled;
  }
  toggle.addEventListener('click',()=>{
    const check=selected().length!==choices.length;
    choices.forEach(choice=>{choice.checked=check;});
    refreshSelection();
  });
  function reportData(){return {query:search.query,incidentOnly:search.incidentOnly,exportedAt:new Date().toISOString(),observedAt,windowStart:payload.window_start,windowEnd:payload.window_end,findings:selected(),total:payload.results.length,sources:payload.sources_checked||[],providerErrors:payload.provider_errors||[],notice:payload.notice,notes:notes.value};}
  manifest.addEventListener('click',()=>{try{window.ClearIntelReport.downloadManifest(reportData());status.textContent='Evidence file download started.';}catch(_){status.textContent='Could not export evidence.';}});
  download.addEventListener('click',async()=>{
    const findings=selected();
    if(busy||(choices.length&&!findings.length))return;
    busy=true;refreshSelection();status.textContent='Preparing PDF…';
    try{
      await window.ClearIntelReport.download(reportData());
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

let countryList;
function loadCountries(){
  countryList??=fetch('/assets/countries.json').then(r=>r.json()).then(data=>data.events)
    .catch(error=>{countryList=null;throw error;});
  return countryList;
}
let countrySearchVersion=0;
async function showSearchCountry(query){
  const version=++countrySearchVersion;
  const panel=$('search-country');
  const label=$('country-headline-context');
  panel.hidden=true;
  label.hidden=true;
  try{
    const places=await loadCountries();
    const aliases={uk:'GB',usa:'US','united states of america':'US',britain:'GB','españa':'ES'};
    const term=query.toLowerCase();
    const country=places.find(item=>item.id===(aliases[term]||query.toUpperCase())||item.place.toLowerCase()===term);
    if(!country||version!==countrySearchVersion)return;
    panel.hidden=false;
    label.hidden=false;
    label.textContent='SEPARATE COUNTRY BRIEF · '+country.place+
      ' — source-linked country headline coverage, checked separately from your filtered search. '+
      'This brief can show results when the filtered search is unavailable or rate limited.';
    renderCountryCard(panel,country,null);
    const controller=new AbortController();
    const countryTimeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/api/country-news/'+encodeURIComponent(country.id),{signal:controller.signal});
      if(!response.ok){
        const message=response.status===429?'Country headlines are rate limited. '+retryMessage(response):'Country headlines are temporarily unavailable.';
        if(version===countrySearchVersion)renderCountryCard(panel,country,{failed:true,message});
        return;
      }
      const data=await response.json();
      if(version===countrySearchVersion)renderCountryCard(panel,country,{
        data,change:window.ClearIntelCountryChanges(country.id,data)});
    }catch{
      if(version===countrySearchVersion)renderCountryCard(panel,country,{failed:true});
    }finally{clearTimeout(countryTimeout);}
  }catch{ /* General news search still runs when the country index is unavailable. */ }
}

const searchFeedLabels = new Map([['google', 'Google News'], ['bing', 'Bing News'],
    ['gdelt', 'GDELT'], ['country_section', 'Country news section']]);

function feedName(id) {
  return searchFeedLabels.get(id) || id;
}

function searchCoverage(payload) {
  const checked = Array.isArray(payload.sources_checked) ? payload.sources_checked : [];
  const problems = Array.isArray(payload.provider_errors) ? payload.provider_errors : [];
  const details = el('details', 'search-coverage');
  const count = checked.length + problems.length;
  const health = !count ? 'not-checked' : !checked.length ? 'unavailable' : problems.length ? 'partial' : 'responded';
  details.dataset.health = health;
  const summary = health === 'unavailable' ? 'Feeds unavailable' :
    health === 'not-checked' ? 'No feeds checked' :
    health === 'partial' ? 'Partial feed coverage' : 'Feed coverage';
  details.append(el('summary', '', summary + (count ? ' · ' + checked.length + ' of ' + count +
    (count === 1 ? ' feed responded' : ' feeds responded') : '')));
  const list = el('ul', '');
  for (const id of checked) list.append(el('li', '', feedName(id) + ' — responded'));
  for (const problem of problems) {
    const [id, ...reason] = String(problem).split(': ');
    list.append(el('li', '', feedName(id) + ' — unavailable' + (reason.length ? ' (' + reason.join(': ') + ')' : '')));
  }
  if (count) details.append(list);
  const caveat = health === 'unavailable' ? 'All queried feeds failed: no result can be treated as evidence that no news happened.' :
    health === 'not-checked' ? 'No feed status is available for this search.' :
    health === 'partial' ? 'Some feeds failed. The headlines below may omit major reports.' :
    'Responded means the source check finished, not that a matching headline or independently verified event exists.';
  details.append(el('p', '', caveat));
  return details;
}


/* Wording comparison only: no claim that reports describe the same event,
   originate independently, or verify each other. No provider calls. */
function reportWordingSignals(rows){
  const unique=new Map();
  for(const article of rows.slice(0,60)){
    if(!article || typeof article.title!=='string')continue;
    let url;
    try{url=new URL(article.url);if(url.protocol!=='https:'||url.username||url.password)continue;url.hash='';}catch(_){continue;}
    const normalized=article.title.slice(0,300).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu,' ').replace(/\s+/g,' ').trim();
    if(normalized.length<30||normalized.split(' ').length<5||unique.has(url.href))continue;
    unique.set(url.href,{article,href:url.href,normalized,tokens:new Set(normalized.split(' ')),numbers:normalized.match(/\b\d+\b/g)?.sort().join(',')||''});
  }
  const items=[...unique.values()],exact=new Map(),similar=[];
  for(const item of items){
    if(!exact.has(item.normalized))exact.set(item.normalized,[]);
    exact.get(item.normalized).push(item);
  }
  for(let i=0;i<items.length && similar.length<8;i++)for(let j=i+1;j<items.length && similar.length<8;j++){
    const a=items[i],b=items[j];
    if(a.normalized===b.normalized||a.numbers!==b.numbers||a.tokens.size<8||b.tokens.size<8)continue;
    const intersection=[...a.tokens].filter(word=>b.tokens.has(word)).length;
    const union=new Set([...a.tokens,...b.tokens]).size;
    if(intersection/union>=.8)similar.push([a,b]);
  }
  return {exact:[...exact.values()].filter(group=>group.length>1).slice(0,8),similar,considered:items.length};
}
function researchCorrelation(rows){
  const result=reportWordingSignals(rows);
  const details=el('details','research-correlation');
  details.append(el('summary','', 'Compare reporting wording · '+result.exact.length+' matching groups · '+result.similar.length+' similar pairs'));
  details.append(el('p','','Wording matches are research leads, not confirmed duplicate stories, shared ownership, independent corroboration or proof of an event. Different numbers are excluded from similar-wording comparisons. Open the original articles to assess context.'));
  const add=(name,groups)=>{
    if(!groups.length)return;
    details.append(el('h4','',name));
    for(const group of groups){
      const section=el('div','correlation-group');
      const publishers=new Set(group.map(item=>String(item.article.source||'Unknown').trim().toLowerCase()));
      section.append(el('p','',group.length+' distinct links · '+publishers.size+' listed publishers'));
      const list=el('ul','');
      for(const item of group){
        const li=el('li','');
        const link=el('a','',item.article.title.slice(0,300));link.href=item.href;link.target='_blank';link.rel='noopener noreferrer nofollow';
        li.append(link,el('span','',String(item.article.source||'Unknown').slice(0,100)));list.append(li);
      }
      section.append(list);details.append(section);
    }
  };
  add('Matching headline wording',result.exact);add('Similar headline wording',result.similar);
  if(!result.exact.length&&!result.similar.length)details.append(el('p','','No wording signals found among eligible returned headlines. This does not establish independent sourcing.'));
  details.append(el('p','', 'Compared '+result.considered+' eligible distinct links from the first 60 results; showing up to eight groups or pairs of each type.'));
  return details;
}

function renderResults(payload,search){
  const area=$('news-results');area.replaceChildren();
  const header=el('div','results-header');
  const left=el('div','');left.append(el('span','result-kicker','PUBLIC NEWS FEED · UTC'),el('h3','',`${payload.results.length} ${search.incidentOnly?'matching incident':'matching news'} headline${payload.results.length===1?'':'s'}`));
  const timeWindow=el('span','result-window', search.window==='24h'?'Last 24 hours':'Last 7 days');
  header.append(left,timeWindow);area.append(header);
  const notice=el('div','result-warning',payload.notice);area.append(notice);
  area.append(searchCoverage(payload));
  if(payload.results.length>1)area.append(researchCorrelation(payload.results));
  const windowText='Requested UTC window: '+(payload.window_start||'unknown')+' to '+(payload.window_end||'unknown')+'.';
  area.append(el('p','analyst-only analyst-metadata',windowText));
  const exportUi=window.ClearIntelReport?reportExport(payload,search):null;
  if(exportUi)area.append(exportUi.controls);
  if(!payload.results.length){
    const checked = Array.isArray(payload.sources_checked) ? payload.sources_checked : [];
    const errors = Array.isArray(payload.provider_errors) ? payload.provider_errors : [];
    const guidance = !checked.length && errors.length ?
      'Every queried news feed failed. Try again later; this is not a successful search with zero matching stories.' :
      !checked.length ? 'No news feeds were checked. This search cannot establish whether reports exist.' :
      'Try a broader term or 7-day window. No headline match does not establish that nothing happened.';
    area.append(el('div','empty-results',guidance));
  }
  const list=el('div','result-list');
  const entries=[];
  for(const article of payload.results){
    const card=el('article','result-card');
    const eyebrow=el('div','result-meta',article.source+' · '+(article.time_basis||'Feed time')+' · '+new Date(article.feed_time_utc).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC');
    const link=el('a','result-title',article.title);link.href=article.url;link.target='_blank';link.rel='noopener noreferrer nofollow';
    const incidentTime=search.incidentOnly&&article.incident_time_utc==null?' · Incident time unknown':'';
    card.append(eyebrow,link,el('div','result-provider',article.provider+incidentTime));
    const citationRow=el('div','citation-row');
    const copy=el('button','globe-control citation-copy','Copy source citation');
    copy.type='button';
    copy.setAttribute('aria-label','Copy citation for '+article.title);
    const copyStatus=el('span','citation-status');
    copyStatus.setAttribute('role','status');
    copy.addEventListener('click',async()=>{
      const date=new Date(article.feed_time_utc);
      const when=Number.isFinite(date.getTime())?date.toISOString():'Unknown';
      const citation=[
        article.title,
        'Publisher: '+(article.source||'Unknown'),
        'Feed timestamp: '+when,
        'Source: '+(article.url||'Unavailable'),
        'Public reporting lead; not independently verified.'
      ].join('\n');
      if(!navigator.clipboard?.writeText){copyStatus.textContent='Clipboard unavailable in this browser.';return;}
      copy.disabled=true;
      try{
        await navigator.clipboard.writeText(citation);
        copyStatus.textContent='Citation copied.';
      }catch(_){
        copyStatus.textContent='Copy unavailable. Open the source to copy its link.';
      }finally{copy.disabled=false;}
    });
    citationRow.append(copy,copyStatus);
    card.append(citationRow);
    const date=new Date(article.feed_time_utc);
    card.append(el('span','analyst-only analyst-metadata',
      'Exact feed timestamp: '+(Number.isFinite(date.getTime())?date.toISOString():'unknown')+' · Headline is a research lead'));
    if(exportUi)card.append(exportUi.choiceFor(article));
    entries.push({card,article});
    list.append(card);
  }
  if(entries.length){
    const controls=el('div','result-view-controls');
    const sourceField=el('label','result-view-field','Publisher');
    const publisher=el('select','');
    publisher.id='result-publisher';sourceField.htmlFor=publisher.id;
    publisher.add(new Option('All publishers',''));
    for(const name of [...new Set(entries.map(entry=>entry.article.source).filter(Boolean))].sort((a,b)=>a.localeCompare(b))){
      publisher.add(new Option(name,name));
    }
    sourceField.append(publisher);
    const sortField=el('label','result-view-field','Order');
    const sort=el('select','');sort.id='result-order';sortField.htmlFor=sort.id;
    sort.add(new Option('Original order','original'));
    sort.add(new Option('Newest feed time','newest'));
    sort.add(new Option('Oldest feed time','oldest'));
    sortField.append(sort);
    const count=el('p','result-view-count');count.setAttribute('role','status');
    const reset=el('button','globe-control','Reset view');reset.type='button';
    const guidance=el('p','result-view-guidance','View controls use results already retrieved. PDF includes checked findings, even when filtered out of view.');
    function updateView(){
      let ordered=[...entries];
      if(sort.value!=='original')ordered.sort((a,b)=>{
        const first=Date.parse(a.article.feed_time_utc),second=Date.parse(b.article.feed_time_utc);
        if(!Number.isFinite(first)||!Number.isFinite(second))return Number.isFinite(first)?-1:Number.isFinite(second)?1:0;
        return sort.value==='newest'?second-first:first-second;
      });
      let shown=0;
      for(const entry of ordered){
        const visible=!publisher.value||entry.article.source===publisher.value;
        entry.card.hidden=!visible;
        if(visible)shown++;
        list.append(entry.card);
      }
      count.textContent='Showing '+shown+' of '+entries.length+' headlines';
      reset.disabled=!publisher.value&&sort.value==='original';
    }
    publisher.addEventListener('change',updateView);sort.addEventListener('change',updateView);
    reset.addEventListener('click',()=>{publisher.value='';sort.value='original';updateView();publisher.focus();});
    controls.append(sourceField,sortField,reset,count,guidance);
    area.append(controls);updateView();
  }
  area.append(list);
  if(exportUi)exportUi.refreshSelection();
  area.append(el('div','results-foot','Feed timestamps may be publication or first-seen dates; they do not establish the incident date.'));
}
const searchSubmit = $('news-submit');
let searchRetryTimer;
function pauseFilteredSearch(response) {
  // The API supplies a whole-second delay of at most one hour.
  const delay = Number(response.headers.get('Retry-After'));
  if (!Number.isInteger(delay) || delay < 1 || delay > 3600) return;
  searchRetryTimer = setTimeout(() => {
    searchRetryTimer = undefined;
    searchSubmit.disabled = false;
    searchSubmit.textContent='Search recent reports →';
    fillStatus('Ready to search again', 'Choose Search recent reports to retry with your current filters.');
  }, delay * 1000);
}

$('news-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if (searchSubmit.disabled) return;
  const query=$('news-query').value.trim();
  if(query.length<2){
    fillStatus('Enter at least two characters','Try a country abbreviation such as UK or US.','error');
    return;
  }
  showSearchCountry(query);
  const incidentOnly=$('incident-only').checked;
  const timeWindow=$('news-window').value;
  searchSubmit.disabled=true;
  searchSubmit.textContent='Searching…';
  $('news-form').setAttribute('aria-busy','true');
  document.dispatchEvent(new Event('clearintel:search-start'));
  fillStatus('Checking recent news feeds…','Looking for published headlines that match the selected time window and subject.','loading');
  $('news-results').scrollIntoView({behavior:'smooth',block:'nearest'});
  let timeout;
  try{
    const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),25000);
    const response=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,window:timeWindow,incident_only:incidentOnly}),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{payload={};}
    if (response.status === 400) {
      fillStatus('Check your search', payload?.detail || 'Enter a location or topic.', 'error');
      return;
    }
    if(response.status===429){
      pauseFilteredSearch(response);
      let title = 'Filtered search is rate limited';
      if (payload?.detail === 'Hourly search limit reached. Try again later.') title = 'Hourly filtered search limit reached';
      if (payload?.detail === 'News search is busy. Try again shortly.') title = 'Filtered search is busy across the site';
      fillStatus(title,
        'This filtered search did not return new results. '+retryMessage(response)+
        ' Any country briefing above is an independent feed and does not mean this search succeeded.','error');
      return;
    }
    if(!response.ok)throw new Error(typeof payload.detail==='string'?payload.detail:'News search could not be completed.');
    const search={query,window:timeWindow,incidentOnly};
    renderResults(payload,search);
    document.dispatchEvent(new CustomEvent('clearintel:news-ready',{detail:{payload,search}}));
  }catch(err){
    fillStatus('Filtered search unavailable',
      (err.name==='AbortError'?'The sources did not respond within the time limit. Try again.':err.message)+
      ' Any country briefing above is separate; it is not a result from this failed search.','error');
  }
  finally{
    clearTimeout(timeout);searchSubmit.disabled = searchRetryTimer !== undefined;
    searchSubmit.textContent=searchRetryTimer!==undefined?'Search temporarily paused':'Search recent reports →';
    $('news-form').setAttribute('aria-busy','false');
  }
});
