(() => {
  'use strict';
  // A lightweight shared explainer system. No external packages, tracking or
  // storage. Hover/focus hints never capture taps on the underlying controls.
  const definitions = [
    ['#sidebar-toggle','Show or hide desktop navigation. It changes workspace width but not your map or results.'],
    ['#analyst-mode-toggle','Switch between simple mode and a detailed view with extra source details, timestamps and evidence metadata. Analyst mode does not independently verify reports.'],
    ['#globe-layer','Choose what the global map displays. Earthquakes, wildfires, ISS and country news use public-source updates; military and naval layers are historical archives.'],
    ['.command-overview-card[data-command-layer="earthquakes"]','Open earthquake observations, with other earth and orbital feeds selectable under Layer.'],
    ['.command-overview-card[data-command-layer="countries"]','Show national headline reporting by country. City markers represent mentions in headlines, not confirmed incident locations.'],
    ['.command-overview-card[data-command-layer="aviation"]','Open selected historical aviation reports. These are past, source-linked events, not live flight tracking.'],
    ['#dashboard-source-guide summary','Expand details on providers, source coverage and how often ClearIntel checks for updates.'],
    ['#map-layer-kind','This label describes the active data layer. “Live feed” means refreshed source data, not verified incidents.'],
    ['#map-expand','Make the map larger to explore markers, boundaries and locations.'],
    ['#earth-reset-map','Return from a regional focus to the world map.'],
    ['#earth-motion','Pause or resume automatic map rotation; it does not pause news or event updates.'],
    ['#earth-uk-view','Focus the map on the United Kingdom. You can return to the world view.'],
    ['#earth-zoom-in','Zoom closer to the map.'],
    ['#earth-zoom-out','Zoom farther out from the map.'],
    ['#quake-window','Change the amount of public-source reporting shown. Publication and observation time are not always incident time.'],
    ['#quake-pause','Pause or resume automatic source refreshes for supported map layers. Manual controls remain available.'],
    ['#country-select','Choose the country whose source-linked headlines you want to inspect. Coverage varies by provider and region.'],
    ['#report-timeline .timeline-column','Show events and reports in this time bucket; select all times to remove the filter.'],
    ['#news-query','Enter a country, location or topic. Search results are reporting leads, not confirmed events. Avoid sensitive personal information.'],
    ['#news-window','Choose whether the filtered search checks the last 24 hours or last seven days.'],
    ['#incident-only','Restrict results to incident-related headlines. This is a fallible text filter and may miss relevant reporting.'],
    ['#news-submit','Search public news providers. This is separate from any country headline briefing shown above results.'],
    ['#replay-save','Save this search result snapshot on this device only. Nothing is automatically stored.'],
    ['#replay-select','Choose a previously saved observation from this browser.'],
    ['#replay-compare-button','Compare this observation with an earlier saved search using the same filters. Differences are not proof of new or deleted incidents.'],
    ['#replay-clear','Delete all manually saved Replay snapshots from this browser.'],
    ['#dashboard-map-tab','Show the map panel on a small screen.'],
    ['#dashboard-feed-tab','Show the current source feed on a small screen.'],
    ['#dashboard-search-tab','Open the quick dashboard search, which helps navigate to layers, countries and news searches.']
  ];
  const tooltip = document.createElement('div');
  tooltip.id = 'ci-context-tooltip';
  tooltip.className = 'ci-context-tooltip';
  tooltip.setAttribute('role','tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let activeTarget = null;
  const maxTooltipWidth = 300;

  for(const [selector,content] of definitions) {
    for(const target of document.querySelectorAll(selector)) {
      target.dataset.ciExplain = content;
    }
  }
  const dynamicDefinitions = [
    ['.timeline-column', 'Filter the globe and source feed to this UTC time period; timestamps depend on each provider.'],
    ['#quake-list button', 'Select this report to read linked public-source details. Markers do not independently verify an incident.'],
    ['.result-card .citation-copy', 'Copy this headline, publisher, feed time, original URL and source caution as a citation.']
  ];

  function explainFor(target) {
    const explicit = target.closest('[data-ci-explain]');
    if(explicit) return explicit;
    for(const [selector,content] of dynamicDefinitions) {
      const candidate = target.closest(selector);
      if(candidate){candidate.dataset.ciExplain = content;return candidate;}
    }
    return null;
  }
  function hideTooltip() {
    tooltip.hidden = true;
    if(activeTarget) activeTarget.removeAttribute('aria-describedby');
    activeTarget = null;
  }
  function placeTooltip(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(maxTooltipWidth,window.innerWidth-24);
    tooltip.style.width = width+'px';
    tooltip.style.maxWidth = 'calc(100vw - 24px)';
    const left = Math.max(12,Math.min(rect.left+(rect.width-width)/2,window.innerWidth-width-12));
    tooltip.style.left=left+'px';
    const height=tooltip.getBoundingClientRect().height;
    const below = rect.bottom+9;
    const above = rect.top-height-9;
    tooltip.style.top=(below+height<=window.innerHeight-10?below:above>=10?above:Math.max(10,window.innerHeight-height-10))+'px';
  }
  function showTooltip(anchor) {
    if(!anchor || anchor.hidden || !anchor.dataset.ciExplain) return;
    if(activeTarget && activeTarget!==anchor) activeTarget.removeAttribute('aria-describedby');
    activeTarget=anchor;
    tooltip.textContent=anchor.dataset.ciExplain;
    tooltip.hidden=false;
    anchor.setAttribute('aria-describedby',tooltip.id);
    placeTooltip(anchor);
  }
  // Mouse hover and keyboard focus; touch does not block normal controls.
  document.addEventListener('pointerover',event=>{
    if(event.pointerType==='mouse' || event.pointerType==='pen') {
      const target=explainFor(event.target);
      if(target && target!==activeTarget) showTooltip(target);
    }
  });
  document.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse' && event.pointerType!=='pen') return;
    const target=explainFor(event.target);
    if(target && (tooltip.hidden || activeTarget!==target)) showTooltip(target);
  },{passive:true});
  document.addEventListener('pointerout',event=>{
    if(!activeTarget || !activeTarget.contains(event.target)) return;
    if(event.relatedTarget && activeTarget.contains(event.relatedTarget)) return;
    hideTooltip();
  });
  document.addEventListener('focusin',event=>{
    const target=explainFor(event.target);
    if(target)showTooltip(target);
    else hideTooltip();
  });
  document.addEventListener('focusout',event=>{
    if(activeTarget && activeTarget.contains(event.target))hideTooltip();
  });
  document.addEventListener('scroll',()=>{
    if(!activeTarget || tooltip.hidden)return;
    const bounds=activeTarget.getBoundingClientRect();
    if(bounds.bottom<=0 || bounds.top>=window.innerHeight) hideTooltip();
    else placeTooltip(activeTarget);
  },true);
  window.addEventListener('resize',hideTooltip);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTooltip();});
  // Explicit tap/click info buttons reveal text in normal document flow.
  const triggers=[...document.querySelectorAll('.ci-help-dot[data-ci-note]')];
  function closeNotes(except) {
    for(const trigger of triggers){
      if(trigger===except)continue;
      const note=document.getElementById(trigger.dataset.ciNote);
      if(note)note.hidden=true;
      trigger.setAttribute('aria-expanded','false');
    }
  }
  for(const trigger of triggers){
    const note=document.getElementById(trigger.dataset.ciNote);
    if(!note)continue;
    trigger.dataset.ciExplain=note.textContent.trim();
    trigger.addEventListener('click',()=>{
      const open=note.hidden;
      closeNotes(trigger);
      note.hidden=!open;
      trigger.setAttribute('aria-expanded',String(open));
      if(open && window.matchMedia('(max-width:760px)').matches) {
        note.scrollIntoView({block:'nearest',behavior:'instant'});
      }
    });
  }
  const guide=document.getElementById('ci-start-guide');
  const openGuideForAnchor=()=>{
    if(guide && location.hash==='#ci-start-guide')guide.open=true;
  };
  openGuideForAnchor();
  window.addEventListener('hashchange',openGuideForAnchor);
  document.querySelectorAll('a[href="#ci-start-guide"]').forEach(a=>a.addEventListener('click',()=>{
    if(guide)guide.open=true;
  }));
})();