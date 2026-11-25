(() => {
  'use strict';
  const KEY = 'clearintel.replay.snapshots.v1';
  const MAX_SNAPSHOTS = 20;
  const MAX_RESULTS = 20;
  const $ = id => document.getElementById(id);
  const save = $('replay-save');
  const clear = $('replay-clear');
  const status = $('replay-status');
  const history = $('replay-history');
  const select = $('replay-select');
  const detail = $('replay-detail');
  const queryFilter=$('replay-query-filter'),periodFilter=$('replay-period-filter'),filterCount=$('replay-filter-count');
  const compareButton = $('replay-compare-button');
  const compareEarlier=$('replay-compare-earlier');
  const compareHint = $('replay-compare-hint');
  const comparePanel = $('replay-compare');
  const compareResult = $('replay-compare-result');
  if (!save || !clear || !status || !history || !select || !detail ||
      !compareButton || !compareHint || !comparePanel || !compareResult) return;

  let comparison=null;
  let latest = null;
  let snapshots = [];
  let storageReadable = true;

  const short = (value, max) => String(value ?? '').slice(0, max);
  const utc = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ?
      date.toLocaleString('en-GB', {timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short'}) + ' UTC' :
      'Unknown';
  };
  const sourceLink = value => {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch (_) { /* Invalid stored URLs are never linked. */ }
    return null;
  };
  const node = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  };

  function load() {
    try {
      const value = localStorage.getItem(KEY);
      const data = value ? JSON.parse(value) : [];
      if (!Array.isArray(data)) throw new Error('Invalid snapshot format');
      snapshots = data.filter(s => s && typeof s.id === 'string' &&
        typeof s.observed_at_utc === 'string' && Array.isArray(s.articles)).slice(0, MAX_SNAPSHOTS);
    } catch (_) {
      storageReadable = false;
      snapshots = [];
      status.textContent = 'Existing browser snapshot storage is unavailable. Nothing is uploaded.';
    }
  }

  // These are differences between actual, manually saved, potentially
  // incomplete search results. Not verified changes in real-world events.
  function searchMatches(a,b) {
    const query = s => String(s.query || '').trim().toLowerCase();
    return query(a) === query(b) &&
      (a.window === '7d' ? '7d' : '24h') === (b.window === '7d' ? '7d' : '24h') &&
      Boolean(a.incident_only) === Boolean(b.incident_only);
  }
  function previousFor(snapshot) {
    const index=snapshots.indexOf(snapshot);
    return index<0 ? null : snapshots.slice(index+1).find(s=>searchMatches(s,snapshot)) || null;
  }
  function sourceKey(article) {
    const href=sourceLink(article.url);
    return href ? 'link:'+href : 'unlinked:'+short(article.source,100).toLowerCase()+':'+short(article.title,240).toLowerCase();
  }
  function uniqueArticles(snapshot) {
    const found=new Map();
    for(const article of snapshot.articles.slice(0,MAX_RESULTS)) {
      if (!article || typeof article!=='object') continue;
      const key=sourceKey(article);
      if(!found.has(key))found.set(key,article);
    }
    return found;
  }
  function calculateChanges(older,newer) {
    const before=uniqueArticles(older),after=uniqueArticles(newer);
    const added=[],removed=[],changed=[],unchanged=[];
    for(const [key,article] of after){
      if(!before.has(key)){added.push(article);continue;}
      const prior=before.get(key);
      if(short(prior.title,240)!==short(article.title,240) || short(prior.source,100)!==short(article.source,100))
        changed.push({prior,article});
      else unchanged.push(article);
    }
    for(const [key,article] of before)if(!after.has(key))removed.push(article);
    return {added,removed,changed,unchanged};
  }
  function linkedEntry(article) {
    const li=node('li');
    const href=sourceLink(article.url);
    const label=href?node('a','',short(article.title||'Untitled',240)):node('strong','',short(article.title||'Untitled',240));
    if(href){label.href=href;label.target='_blank';label.rel='noopener noreferrer nofollow';}
    li.append(label,node('span','replay-article-info','Publisher: '+short(article.source||'Unknown',100)+
      ' · Feed time: '+utc(article.feed_time_utc)));
    return li;
  }
  function drawComparison(older,newer) {
    comparison={older,newer};
    compareResult.replaceChildren();
    const changes=calculateChanges(older,newer);
    compareResult.append(
      node('p','replay-compare-period','Earlier observation: '+utc(older.observed_at_utc)+
        ' · Later observation: '+utc(newer.observed_at_utc)),
      node('p','replay-compare-summary',changes.added.length+' newly present · '+
        changes.removed.length+' no longer present · '+changes.changed.length+
        ' changed headline/publisher · '+changes.unchanged.length+' unchanged'),
      node('p','replay-warning','These are differences between two saved, potentially incomplete search results. They do not prove an article was published or deleted, an incident occurred, or reports were independently verified. Changes to URLs and repeated headline wording may look like separate stories.')
    );
    if (!older.saved_at_utc || !newer.saved_at_utc)
      compareResult.append(node('p','replay-warning','Older snapshots record the time you saved them. Their search completion time is unknown.'));
    const priorSources=Array.isArray(older.sources_checked) ? older.sources_checked : [];
    const newSources=Array.isArray(newer.sources_checked) ? newer.sources_checked : [];
    const priorErrors=Array.isArray(older.provider_errors) ? older.provider_errors : [];
    const newErrors=Array.isArray(newer.provider_errors) ? newer.provider_errors : [];
    const normalized=sources=>new Set(sources.map(s=>String(s).trim().toLowerCase()));
    const first=normalized(priorSources),second=normalized(newSources);
    const changedSources=first.size!==second.size || [...first].some(s=>!second.has(s));
    if(changedSources || priorErrors.length || newErrors.length){
      const note=node('p','replay-coverage-warning',
        'Source coverage caution: the sources checked differed or at least one provider reported an error. Missing headlines may reflect feed availability, not changes in real-world reporting.');
      compareResult.append(note);
      const evidence=node('p','replay-coverage-details',
        'Earlier sources: ' + (priorSources.length?priorSources.join(', '):'None recorded') +
        ' · Later sources: ' + (newSources.length?newSources.join(', '):'None recorded') +
        ' · Earlier provider problems: ' + priorErrors.length +
        ' · Later provider problems: ' + newErrors.length);
      compareResult.append(evidence);
    }
    if(Number(older.total_results)>older.articles.length ||
       Number(newer.total_results)>newer.articles.length)
      compareResult.append(node('p','replay-coverage-warning',
        'At least one saved snapshot includes only the first ' + MAX_RESULTS +
        ' results. Headlines outside that limit cannot be compared.'));
    for(const [name,entries,kind] of [
      ['Newly present in later snapshot',changes.added,'added'],
      ['No longer present in later snapshot',changes.removed,'removed']]){
      const group=node('section','replay-diff-group replay-diff-'+kind);
      group.append(node('h5','',name+' ('+entries.length+')'));
      if(entries.length){const list=node('ol','replay-articles');for(const article of entries)list.append(linkedEntry(article));group.append(list);}
      compareResult.append(group);
    }
    const group=node('section','replay-diff-group replay-diff-changed');
    group.append(node('h5','','Headline or publisher changed at same source URL ('+changes.changed.length+')'));
    if(changes.changed.length){
      const list=node('ol','replay-articles');
      for(const {prior,article} of changes.changed){
        const li=linkedEntry(article);
        li.append(node('span','replay-previous-title','Earlier saved headline: '+short(prior.title,240)+
          ' · publisher: '+short(prior.source,100)));
        list.append(li);
      }
      group.append(list);
    }
    compareResult.append(group);
    if(!changes.added.length&&!changes.removed.length&&!changes.changed.length)
      compareResult.append(node('p','replay-no-change','No headline or publisher differences found in these saved results.'));
  }
  function updateComparison(snapshot){
    comparison=null;
    comparePanel.hidden=true;
    compareResult.replaceChildren();
    const index=snapshots.indexOf(snapshot);
    const candidates=index<0?[]:snapshots.slice(index+1).filter(s=>searchMatches(s,snapshot));
    compareEarlier.replaceChildren(...candidates.map(s=>new Option(utc(s.observed_at_utc)+' · '+s.articles.length+' headlines',s.id)));
    compareEarlier.disabled=!candidates.length;
    const older=candidates[0];
    compareButton.disabled=!older;
    compareHint.textContent=older?
      'Choose an earlier saved observation of the same search and filters.':
      'Save this exact search again to compare; no earlier matching snapshot is available.';
  }


  // Conservative signal only: case, punctuation and spacing-insensitive exact
  // wording. No factual, event, syndication or source-independence inference.
  function normalizedHeadline(value){
    return short(value,240).normalize('NFKC').toLocaleLowerCase('en-GB')
      .replace(/[\p{P}\p{S}]+/gu,' ')
      .replace(/\s+/g,' ').trim();
  }
  function repeatedHeadlineGroups(snapshot){
    const groups=new Map();
    for(const article of uniqueArticles(snapshot).values()){
      const headline=normalizedHeadline(article.title);
      // Very short or generic titles are too ambiguous to group usefully.
      if(headline.length<30 || headline.split(' ').length<5)continue;
      if(!groups.has(headline))groups.set(headline,[]);
      groups.get(headline).push(article);
    }
    return [...groups.values()].filter(group=>group.length>=2);
  }
  function drawRepeatedWording(snapshot){
    const groups=repeatedHeadlineGroups(snapshot);
    const section=node('section','replay-wording-groups');
    section.append(node('h5','','Matching headline wording'));
    section.append(node('p','replay-wording-caution',
      'Matches only ignore case, punctuation and spacing. Identical wording across different links does not demonstrate independent reporting, shared ownership or syndication; open the original articles.'));
    if(!groups.length){
      section.append(node('p','replay-wording-empty',
        'No repeated long-form headline wording found in this saved result set. This does not establish independent sourcing.'));
      return section;
    }
    section.append(node('p','replay-wording-total',
      groups.length+' group'+(groups.length===1?'':'s')+' with matching wording among saved source links.'));
    for(const group of groups){
      const details=node('details','replay-wording-detail');
      const sourceLinks=new Set(group.map(a=>sourceLink(a.url)).filter(Boolean));
      const publishers=new Set(group.map(a=>String(a.source||'Unknown').trim().toLowerCase()));
      details.append(node('summary','',
        group.length+' saved headlines · '+sourceLinks.size+' source links · '+
        publishers.size+' listed publishers — '+short(group[0].title,120)));
      const list=node('ol','replay-articles');
      for(const article of group)list.append(linkedEntry(article));
      details.append(list);
      section.append(details);
    }
    return section;
  }

  function drawObservationTimeline(snapshot) {
    const section=node('section','replay-observation-timeline');
    section.append(node('h5','','Saved observation timeline'),
      node('p','replay-warning','Only snapshots manually saved in this browser for the same query and filters. Counts describe retained headlines, not incident frequency.'));
    const matching=snapshots.filter(s=>searchMatches(s,snapshot)&&Number.isFinite(Date.parse(s.observed_at_utc)))
      .sort((a,b)=>Date.parse(a.observed_at_utc)-Date.parse(b.observed_at_utc));
    const list=node('ol','replay-observation-list');
    for(const item of matching){
      const row=node('li');
      const button=node('button','replay-observation-button');
      button.type='button';
      button.setAttribute('aria-current',item.id===snapshot.id?'true':'false');
      const retained=Math.min(item.articles.length,MAX_RESULTS);
      const count=node('span','replay-observation-count',retained+' saved');
      const track=node('span','replay-observation-track');
      track.setAttribute('aria-hidden','true');
      for(let i=0;i<MAX_RESULTS;i++)track.append(node('span',i<retained?'replay-observation-filled':''));
      button.append(node('span','replay-observation-time',utc(item.observed_at_utc)),count,track);
      const errors=Array.isArray(item.provider_errors)?item.provider_errors.length:0;
      if(!item.saved_at_utc)button.append(node('span','replay-observation-note','Save time only'));
      if(errors)button.append(node('span','replay-observation-note',errors+' provider problem'+(errors===1?'':'s')));
      button.disabled=![...select.options].some(option=>option.value===item.id);
      if(button.disabled)button.title='Outside current saved-history filters';
      button.addEventListener('click',()=>{
        select.value=item.id;
        drawSnapshot();
        const current=detail.querySelector('.replay-observation-button[aria-current="true"]');
        if(current)current.focus();
      });
      row.append(button);list.append(row);
    }
    section.append(list);
    return section;
  }

  function drawSnapshot() {
    detail.replaceChildren();
    const snapshot = snapshots.find(s => s.id === select.value);
    updateComparison(snapshot);
    if (!snapshot) return;
    const heading = node('h4', '', 'Snapshot: ' + short(snapshot.query, 140));
    const observed = node('p', 'replay-observed', (snapshot.saved_at_utc ? 'Observed by this browser: ' : 'Saved by this browser: ') + utc(snapshot.observed_at_utc));
    const windowLabel = node('p', 'replay-window', 'Requested window: ' +
      (snapshot.window === '7d' ? '7 days' : '24 hours') + ' · ' +
      snapshot.total_results + ' headlines returned · ' + snapshot.articles.length + ' saved');
    const caution = node('p', 'replay-warning', 'This is what the selected search returned when saved. It is not a reconstructed history, complete news archive, or verified incident record.');
    detail.append(heading, observed, windowLabel, caution,drawObservationTimeline(snapshot));
    const checked = Array.isArray(snapshot.sources_checked) ? snapshot.sources_checked : [];
    const errors = Array.isArray(snapshot.provider_errors) ? snapshot.provider_errors : [];
    detail.append(node('p','replay-coverage','Sources checked when saved: ' +
      (checked.length ? checked.slice(0,20).map(s => short(s,100)).join(', ') : 'Not recorded')));
    if(errors.length)detail.append(node('p','replay-coverage-warning',
      'Provider problems when saved: ' + errors.slice(0,12).map(s => short(s,180)).join('; ')));
    if(Number(snapshot.total_results)>snapshot.articles.length)
      detail.append(node('p','replay-coverage-warning',
        'Only the first ' + snapshot.articles.length + ' of ' + snapshot.total_results +
        ' returned headlines were retained in this browser snapshot.'));
    if (!snapshot.articles.length) {
      detail.append(node('p', 'replay-empty', 'No matching headlines were returned by the checked sources in this snapshot. This does not establish that no event occurred.'));
      return;
    }
    const items = node('ol', 'replay-articles');
    for (const article of snapshot.articles.slice(0, MAX_RESULTS)) {
      const li = node('li');
      const href = sourceLink(article.url);
      const title = href ? node('a', '', short(article.title, 240)) : node('strong', '', short(article.title, 240));
      if (href) {
        title.href = href;
        title.target = '_blank';
        title.rel = 'noopener noreferrer nofollow';
      }
      li.append(title, node('span', 'replay-article-info',
        'Publisher: ' + short(article.source || 'Unknown', 100) +
        ' · ' + short(article.time_basis || 'Feed time', 40) + ': ' + utc(article.feed_time_utc)));
      if (article.incident_time_utc) li.append(node('span', 'replay-article-info', 'Reported incident time: ' + utc(article.incident_time_utc)));
      items.append(li);
    }
    detail.append(items,drawRepeatedWording(snapshot));
  }

  function render(selectedId) {
    history.hidden = snapshots.length === 0;
    clear.disabled = snapshots.length === 0 || !storageReadable;
    select.replaceChildren();
    const query=queryFilter.value.trim().toLowerCase();
    const cutoff=periodFilter.value==='all'?-Infinity:Date.now()-Number(periodFilter.value)*86400000;
    const filtered=snapshots.filter(s=>String(s.query||'').toLowerCase().includes(query)&&Date.parse(s.observed_at_utc)>=cutoff);
    filterCount.textContent=filtered.length+' of '+snapshots.length+' saved snapshots shown.';
    select.disabled=!filtered.length;
    filtered.forEach((s, index) => {
      const option = new Option(utc(s.observed_at_utc) + ' · ' + short(s.query, 60) +
        ' · ' + (Array.isArray(s.articles) ? s.articles.length : 0) + ' headlines', s.id);
      select.add(option);
    });
    if (filtered.length) {
      select.value = filtered.some(s => s.id === selectedId) ? selectedId : filtered[0].id;
      drawSnapshot();
    } else {
      detail.replaceChildren();
      updateComparison(null);
    }
  }

  function makeSnapshot() {
    const {payload, search} = latest;
    const all = Array.isArray(payload.results) ? payload.results : [];
    return {
      id: new Date().toISOString() + ':' + Math.random().toString(36).slice(2, 8),
      version: 1,
      observed_at_utc: latest.observedAt,
      saved_at_utc: new Date().toISOString(),
      query: short(search.query, 140),
      window: search.window === '7d' ? '7d' : '24h',
      incident_only: Boolean(search.incidentOnly),
      total_results: all.length,
      sources_checked: (Array.isArray(payload.sources_checked) ? payload.sources_checked : []).slice(0, 20).map(s => short(s, 100)),
      provider_errors: (Array.isArray(payload.provider_errors) ? payload.provider_errors : []).slice(0, 12).map(s => short(s, 180)),
      articles: all.slice(0, MAX_RESULTS).map(article => ({
        title: short(article.title, 240), source: short(article.source, 100),
        provider: short(article.provider, 80), url: short(sourceLink(article.url) || '', 700),
        feed_time_utc: short(article.feed_time_utc, 50),
        time_basis: short(article.time_basis || 'Feed time', 40),
        incident_time_utc: article.incident_time_utc ? short(article.incident_time_utc, 50) : null
      }))
    };
  }

  document.addEventListener('clearintel:search-start', () => {
    latest = null;
    save.disabled = true;
    status.textContent = 'Searching. No new snapshot has been saved.';
  });
  document.addEventListener('clearintel:news-ready', event => {
    latest = {...event.detail, observedAt: new Date().toISOString()};
    save.disabled = false;
    status.textContent = 'Search complete. Save a snapshot manually if you want to remember these source results.';
  });

  queryFilter.addEventListener('input',()=>render(select.value));
  periodFilter.addEventListener('change',()=>render(select.value));
  save.addEventListener('click', () => {
    if (!latest || save.disabled) return;
    const snapshot = makeSnapshot();
    const updated = [snapshot, ...snapshots].slice(0, MAX_SNAPSHOTS);
    try {
      localStorage.setItem(KEY, JSON.stringify(updated));
      storageReadable = true;
      snapshots = updated;
      save.disabled = true;
      queryFilter.value='';periodFilter.value='all';
      render(snapshot.id);
      status.textContent = 'Snapshot saved to this browser (' + snapshots.length + '/' + MAX_SNAPSHOTS + '). Run a fresh search to save another observation.';
    } catch (_) {
      status.textContent = 'Browser storage unavailable or full. Nothing was saved. No server upload.';
    }
  });
  clear.addEventListener('click', () => {
    if (!snapshots.length || !confirm('Clear all ClearIntel Replay snapshots saved in this browser?')) return;
    try {
      localStorage.removeItem(KEY);
      storageReadable = true;
      snapshots = [];
      save.disabled = !latest;
      render();
      status.textContent = 'All saved Replay snapshots cleared from this browser.';
    } catch (_) {
      status.textContent = 'Browser storage could not be cleared. Check your browser site settings.';
    }
  });
  select.addEventListener('change', drawSnapshot);
  compareEarlier.addEventListener('change',()=>{comparison=null;comparePanel.hidden=true;compareResult.replaceChildren();});
  $('replay-export-comparison').addEventListener('click',()=>{
    if(!comparison||comparePanel.hidden)return;
    const {older,newer}=comparison;
    const clean=a=>({title:short(a.title,240),publisher:short(a.source,100),provider:short(a.provider,80),source_url:sourceLink(a.url),source_time_utc:short(a.feed_time_utc,50),time_basis:short(a.time_basis,40)});
    const describe=s=>({observed_at_utc:s.observed_at_utc,saved_at_utc:s.saved_at_utc||s.observed_at_utc,timestamp_basis:s.saved_at_utc?'results_received':'legacy_save_time',total_results:s.total_results,saved_count:s.articles.length,sources_checked:s.sources_checked||[],provider_errors:s.provider_errors||[]});
    const changes=calculateChanges(older,newer);
    const manifest={schema:'clearintel.replay-comparison.v1',exported_at_utc:new Date().toISOString(),query:short(newer.query,140),window:newer.window,incident_only:Boolean(newer.incident_only),earlier:describe(older),later:describe(newer),limitations:'Differences in saved, potentially incomplete search results; not evidence of article publication or deletion, independent corroboration, or real-world event changes.',newly_present:changes.added.map(clean),no_longer_present:changes.removed.map(clean),changed:changes.changed.map(x=>({earlier:clean(x.prior),later:clean(x.article)})),unchanged:changes.unchanged.map(clean)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));
    const link=node('a');link.href=url;link.download='ClearIntel-replay-comparison-'+manifest.exported_at_utc.slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  compareButton.addEventListener('click',()=>{
    const selected=snapshots.find(s=>s.id===select.value);
    const older=selected&&snapshots.find(s=>s.id===compareEarlier.value&&snapshots.indexOf(s)>snapshots.indexOf(selected)&&searchMatches(s,selected));
    if(!older)return;
    drawComparison(older,selected);
    comparePanel.hidden=false;
  });
  load();
  render();
})();