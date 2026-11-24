'use strict';
(() => {
  const panel = document.getElementById('country-brief');
  const country = {id: panel.dataset.code, place: panel.dataset.place};
  const interval = 5 * 60 * 1000;
  let lastData = null;
  let due = 0;
  let pending = false;
  let timer;
  const exportPanel=document.getElementById('country-briefing-export');
  const evidence=document.getElementById('country-briefing-evidence');
  const summary=document.getElementById('country-briefing-summary');
  const download=document.getElementById('country-briefing-download');
  const manifest=document.getElementById('country-briefing-manifest');
  const exportStatus=document.getElementById('country-briefing-status');
  let selected=new Set(), findings=[], snapshot=null, stale=false, exporting=false;
  function drawBriefing(entry){
    const data=entry?.data;
    if(!data)return;
    snapshot=data;stale=Boolean(entry.failed);
    const before=new Set(findings.map(a=>a.url));
    const links=new Map();
    for(const group of data.stories||[])for(const article of group.reports||[]){
      // Editorial digests have separate attribution requirements; omit them from this export.
      if(!article||article.editorial||typeof article.title!=='string')continue;
      try{const u=new URL(article.url);if(u.protocol!=='https:'||u.username||u.password)continue;u.hash='';if(!links.has(u.href)&&links.size<30)links.set(u.href,{...article,url:u.href});}catch(_){}
    }
    findings=[...links.values()];
    selected=new Set(findings.filter(a=>selected.has(a.url)||!before.has(a.url)).map(a=>a.url));
    const update=()=>{download.disabled=exporting||!selected.size;manifest.disabled=download.disabled;summary.textContent=selected.size+' of '+findings.length+' eligible original reports selected · '+(data.sources_checked||[]).length+' completed source checks'+(stale?' · Older snapshot':'')+'.';};
    const focused=document.activeElement?.dataset.evidenceUrl;
    evidence.replaceChildren();
    for(const article of findings){
      const label=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');
      box.type='checkbox';box.checked=selected.has(article.url);box.dataset.evidenceUrl=article.url;
      text.textContent=article.title.slice(0,300)+' · '+String(article.source||'Unknown').slice(0,100);
      box.addEventListener('change',()=>{if(box.checked)selected.add(article.url);else selected.delete(article.url);update();});
      label.append(box,text);evidence.append(label);if(focused===article.url)box.focus({preventScroll:true});
    }
    exportPanel.hidden=false;update();
  }
  function reportData(){return {kind:'country',query:country.place,windowStart:null,windowEnd:null,checkedAt:snapshot.checked_at_utc,exportedAt:new Date().toISOString(),incidentOnly:false,total:findings.length,findings:findings.filter(a=>selected.has(a.url)),sources:snapshot.sources_checked||[],providerErrors:snapshot.provider_errors||[],notice:(stale?'Latest refresh failed; this is an older snapshot. ':'')+'Selected original country-news reports, not verified events or independent corroboration. Editorial digests are excluded. Coverage is limited to queried sources.',notes:document.getElementById('country-briefing-notes').value.slice(0,2000)};}
  manifest.addEventListener('click',()=>{if(!snapshot||!selected.size)return;try{window.ClearIntelReport.downloadManifest(reportData());exportStatus.textContent='Evidence file download started.';}catch(_){exportStatus.textContent='Evidence export unavailable.';}});
  download.addEventListener('click',async()=>{
    if(!snapshot||!selected.size||exporting)return;
    exporting=true;download.disabled=true;manifest.disabled=true;exportStatus.textContent='Preparing PDF…';
    const report=reportData();
    try{await window.ClearIntelReport.download(report);exportStatus.textContent='PDF prepared.';}catch(_){exportStatus.textContent='PDF export unavailable. Try again.';}finally{exporting=false;download.disabled=!selected.size;manifest.disabled=download.disabled;}
  });
  function render(entry){renderCountryCard(panel,country,entry);drawBriefing(entry);}
  renderCountryCard(panel, country, null);

  function schedule() {
    clearTimeout(timer);
    if (!document.hidden && !pending) timer = setTimeout(refresh, Math.max(0, due - Date.now()));
  }

  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    let delay = interval;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/country-news/' + encodeURIComponent(country.id), {signal: controller.signal});
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After'));
        if (Number.isFinite(retry) && retry > 0) delay = Math.max(interval, retry * 1000);
        render({data: lastData, failed: true, message: 'Country headlines are rate limited. ' + retryMessage(response)});
      } else {
        if (!response.ok) throw new Error();
        const result = countryRefreshResult(lastData, await response.json());
        lastData = result.data;
        render(result);
      }
    } catch {
      render({data: lastData, failed: true});
    } finally {
      clearTimeout(timeout);
      pending = false;
      due = Date.now() + delay;
      schedule();
    }
  }

  document.addEventListener('visibilitychange', schedule);
  schedule();
})();
