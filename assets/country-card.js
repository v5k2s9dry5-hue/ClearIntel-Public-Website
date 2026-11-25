'use strict';
const el = (name, cls, text) => { const node = document.createElement(name); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; };

// Session-only, bounded browser translations; never mutate source evidence.
const localHeadlineTranslations=new Map();
function renderCountryCard(container,country,entry){
  function reportLink(url, text){
    // Defence in depth: no clickable URL is built from an untrusted feed or
    // browser-supplied country result unless it is absolute HTTPS.
    let safe;
    try {
      const parsed=new URL(url);
      if(parsed.protocol==='https:' && parsed.hostname && !parsed.username && !parsed.password)
        safe=parsed.href;
    } catch (_) { /* Invalid source URLs remain plain text. */ }
    if(!safe)return el('span','country-unlinked-source',text);
    const link=document.createElement('a');
    link.href=safe;link.target='_blank';link.rel='noopener noreferrer';link.textContent=text;
    return link;
  }

    function translatedTitle(article){
      return article.title_en||localHeadlineTranslations.get(article.title)||'';
    }
    function headlineLink(article){
      const original=String(article.title||'Original report');
      const translated=translatedTitle(article);
      return reportLink(article.url,typeof translated==='string'&&translated.trim()?translated:original);
    }
    function translationNote(article,headline){
      if(article.editorial||reportLink(article.url,'').tagName!=='A'||String(article.translation_language||'').toLowerCase().split('-')[0]==='en')return null;
      const original=String(article.title||'');
      if(!original)return null;
      const note=el('div','country-translation-note');
      function showOriginal(local){
        const details=el('details','country-original-headline');
        details.append(el('summary','',local?'Machine-translated on this device · View original':'Machine-translated to English · View original'),el('p','',original));
        note.replaceChildren(details);
      }
      const translated=translatedTitle(article);
      if(typeof translated==='string'&&translated.trim()&&translated!==original){
        showOriginal(!article.title_en);
      }else{
        const url=new URL('https://translate.google.com/');
        url.searchParams.set('sl','auto');url.searchParams.set('tl','en');
        url.searchParams.set('text',original);url.searchParams.set('op','translate');
        const fallback=reportLink(url.href,'Translate headline to English ↗');
        if(typeof globalThis.Translator?.create==='function'&&typeof globalThis.LanguageDetector?.create==='function'){
          const button=el('button','globe-control','Translate on this device');button.type='button';
          const status=el('span','country-local-translation-status');status.setAttribute('role','status');
          let language=null;
          const monitor=m=>m.addEventListener('downloadprogress',e=>{status.textContent='Downloading language model: '+Math.round(e.loaded*100)+'%';});
          button.addEventListener('click',async()=>{
            if(button.disabled)return;
            button.disabled=true;status.textContent='Preparing local translation…';
            let detector,translator;
            try{
              if(!language){
                detector=await globalThis.LanguageDetector.create({monitor});
                const detected=(await detector.detect(original))[0];
                if(!detected||detected.confidence<.65||typeof detected.detectedLanguage!=='string'){
                  status.textContent='Language uncertain. Use the external translation option.';return;
                }
                language=detected.detectedLanguage;
              }
              if(language.toLowerCase().split('-')[0]==='en'){
                status.textContent='Headline appears to be English.';button.hidden=true;return;
              }
              const options={sourceLanguage:language,targetLanguage:'en'};
              const availability=await globalThis.Translator.availability(options);
              if(availability==='unavailable'){status.textContent='Local language pair unavailable. Use the external option.';return;}
              if(availability!=='available'&&navigator.userActivation&&!navigator.userActivation.isActive){
                button.textContent='Continue translation';status.textContent='Click again to download the language model.';return;
              }
              translator=await globalThis.Translator.create({...options,monitor});
              const result=await translator.translate(original);
              if(typeof result!=='string'||!result.trim()||result.length>2000)throw Error('Invalid translation');
              if(result.trim()===original){status.textContent='No different English wording returned. Original retained.';return;}
              localHeadlineTranslations.set(original,result.trim());
              while(localHeadlineTranslations.size>128)localHeadlineTranslations.delete(localHeadlineTranslations.keys().next().value);
              headline.textContent=result.trim();showOriginal(true);
              note.querySelector('summary')?.focus({preventScroll:true});
            }catch(_){status.textContent='Local translation unavailable. Retry or use the external option.';}
            finally{detector?.destroy?.();translator?.destroy?.();button.disabled=false;}
          });
          note.append(button,status);
        }
        note.append(fallback);
      }
      return note;
    }

    const utcTime=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
    const utcDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium'});
    const title=document.createElement('strong');
    title.textContent='Top stories · '+country.place;
    const status=document.createElement('span');
    status.setAttribute('role','status');
    const data=entry?.data;
    const previousStories=new Map([...container.querySelectorAll('.country-related-reports')]
      .filter(item=>item.dataset.country===country.id).map(item=>[item.dataset.story,item.open]));
    const focusedStory=document.activeElement?.closest('.country-related-reports');
    const focusedSummary=focusedStory?.contains(document.activeElement)&&document.activeElement.tagName==='SUMMARY'&&container.contains(focusedStory)&&focusedStory.dataset.country===country.id?focusedStory.dataset.story:null;
    let restoreSummary=null;
    const previousDetails=container.querySelector('.country-coverage-details');
    const wasOpen=previousDetails ? previousDetails.open : document.body.dataset.analysisMode==='analyst';
    const checked=Array.isArray(data?.sources_checked)?data.sources_checked:[];
    const errors=Array.isArray(data?.provider_errors)?data.provider_errors:[];
    const checkedAt=new Date(data?.checked_at_utc);
    const validTime=Number.isFinite(checkedAt.getTime());
    const stories=data?.stories||(data?.story?.length?[{basis:data.basis,reports:data.story}]:[]);
    const labels={
      national:'National edition', developing:'Multiple outlets', publisher:'Publisher’s selection',
      editorial:'International digest', national_digest:'National digest',
      weekly:'From the past week', recent:'Recent coverage',
    };
    if(!entry?.data){
      status.textContent=entry?.failed?(entry.message || 'Country headlines are temporarily unavailable.'):'Checking national headlines…';
    }else if(!stories.length && !checked.length && errors.length){
      status.textContent='Country headlines unavailable — no sources responded. This does not mean no news occurred.';
    }else if(!stories.length && !checked.length){
      status.textContent='No news sources have been checked for this country.';
    }else if(!stories.length){
      status.textContent='No leading headlines matched the sources checked.';
    }else{
      const count=data.publisher_count;
      const coverage=Number.isInteger(count)?` · ${count} ${count===1?'publisher':'publishers'} found`:'';
      status.textContent=(validTime?`Checked ${utcTime.format(checkedAt)} UTC`:'Check time unavailable')+coverage;
    }
    if(data && !stories.length && validTime)status.textContent+=' · Checked '+utcTime.format(checkedAt)+' UTC';
    if(errors.length && (checked.length || stories.length))status.textContent+=' · '+(checked.length?'Partial source coverage':'Sources unavailable');
    if(stories.length && stories.every(group=>group.basis==='weekly'))status.textContent+=' · Older coverage: past week';
    if(entry?.failed && data)status.textContent+=' · Last available snapshot';
    if(entry?.data && entry.failed)status.textContent+=' · '+(entry.message || 'Refresh unavailable');
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
      const [article,...related]=group.reports||[];
      if(!article?.url)continue;
      const row=document.createElement('li');
      const content=document.createElement('div');
      row.append(content);
      list.append(row);
      const change=entry?.change?.statuses?.[index];
      if(change)content.append(el('span','country-change-badge',change==='new'?'New in feed':'Updated in feed'));
      const link=headlineLink(article);
      const source=document.createElement('span');
      const timestamp=new Date(article.feed_time_utc);
      if(article.editorial){
        source.textContent=`${article.source||'Publisher'} · Event date · ${Number.isFinite(timestamp.getTime())?utcDate.format(timestamp):'Unknown'}`;
        content.append(link,source);
        for(const citation of (article.citations||[]).slice(1)){
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
        source.textContent=`${article.source||'Publisher'} · ${article.time_basis||'Feed time'} · ${Number.isFinite(timestamp.getTime())?utcTime.format(timestamp)+' UTC':'Unknown'}`;
        content.append(link,source);
      }
      const translation=translationNote(article,link);if(translation)content.append(translation);
      source.textContent+=' · '+(labels[group.basis]||'Recent coverage');
      const preciseTime=Number.isFinite(timestamp.getTime())?timestamp.toISOString():'unknown';
      const metadata=el('span','analyst-only analyst-metadata',
        'Exact source timestamp: '+preciseTime+' · '+group.reports.length+' '+(group.reports.length===1?'linked report':'linked reports')+' · Not independently verified');
      content.append(metadata);
      const assessment=group.evidence;
      if(assessment && assessment.verification==='not_assessed'){
        const detail=el('span','analyst-only analyst-metadata',
          'Evidence: '+assessment.distinct_links_retained+' distinct retained links · '+assessment.matching_records_excluded+' matching records excluded · Factual confidence not assessed');
        content.append(detail);
      }
      const additional=related.filter(report=>!report.editorial&&report.url);
      if(additional.length){
        const evidence=el('details','country-related-reports');
        evidence.dataset.country=country.id;
        evidence.dataset.story=article.url;
        evidence.open=previousStories.has(article.url)?previousStories.get(article.url):document.body.dataset.analysisMode==='analyst';
        const summary=el('summary','',additional.length+' additional '+(additional.length===1?'source':'sources'));
        evidence.append(summary);
        if(focusedSummary===article.url)restoreSummary=summary;
        const read=el('div','country-related-links');
        for(const report of additional){
          const published=new Date(report.feed_time_utc);
          const item=el('div','country-related-item');
          const relatedHeadline=headlineLink(report);
          item.append(relatedHeadline,
            el('span','', (report.source||'Publisher')+' · '+(report.time_basis||'Feed time')+' · '+
              (Number.isFinite(published.getTime())?utcTime.format(published)+' UTC':'Unknown')));
          const translation=translationNote(report,relatedHeadline);if(translation)item.append(translation);
          read.append(item);
        }
        evidence.append(read,el('p','', 'Related reporting does not establish independent corroboration.'));
        content.append(evidence);
      }
    }
    if(stories.length)links.append(list);
    if(data){
      const details=el('details','country-coverage-details');
      details.open=wasOpen;
      const health = entry?.failed ? 'previous-snapshot' :
        !checked.length && errors.length ? 'unavailable' :
        !checked.length ? 'not-checked' : errors.length ? 'partial' : 'responded';
      details.dataset.health=health;
      const count=checked.length+errors.length;
      const healthTitle = health==='previous-snapshot' ? 'Previous snapshot · refresh unavailable' :
        health==='unavailable' ? 'Sources unavailable' :
        health==='not-checked' ? 'No source checks' :
        health==='partial' ? 'Partial coverage' : 'Checks completed';
      details.append(el('summary','', 'Source health · '+healthTitle+(count?' · '+checked.length+' of '+count+' completed':'')));
      const timeText=validTime ? 'Snapshot checked '+utcTime.format(checkedAt)+' UTC. ' : 'Snapshot check time unavailable. ';
      const explanation=health==='previous-snapshot' ?
        'The latest refresh failed; the source counts and timestamp belong to the previous snapshot, not a successful new check.' :
        health==='unavailable' ? 'Every queried source failed; no headlines here does not mean no news occurred.' :
        health==='not-checked' ? 'No source-check status was returned for this country.' :
        health==='partial' ? 'Some sources failed, so major stories may be missing.' :
        'A completed source check may return no relevant headlines; it does not establish independent corroboration.';
      details.append(el('p','',timeText+explanation));
      const providerLabel=value=>String(value).replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
      if(checked.length){
        const completed=el('ul');
        for(const name of [...checked].sort())completed.append(el('li','',providerLabel(name)+' — check completed'));
        details.append(completed);
      }
      if(errors.length){
        const unavailable=el('ul');
        for(const item of [...errors].sort()){
          const split=String(item).indexOf(':');
          const name=split<0?item:String(item).slice(0,split);
          const reason=split<0?'unavailable':String(item).slice(split+1).trim();
          unavailable.append(el('li','',providerLabel(name)+' — '+reason));
        }
        details.append(unavailable);
      }
      details.append(el('p','','Coverage is limited to queried sources. Publication, first-seen and event dates are not interchangeable.'));
      links.append(details);
    }
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
    if(container.id !== 'country-brief'){
      const profile=document.createElement('a');
      profile.href='/countries/'+encodeURIComponent(country.id.toLowerCase());
      profile.textContent='Open country profile';
      links.append(profile);
    }
    container.replaceChildren(title,status,links);
    if(restoreSummary)restoreSummary.focus({preventScroll:true});
}

function retryMessage(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  return seconds > 0 ? `Try again in ${seconds} seconds.` : 'Try again shortly.';
}

/* A complete provider outage is not an empty successful search. */
function countryRefreshResult(previous, latest) {
  if (!latest || !Array.isArray(latest.stories) ||
      !Array.isArray(latest.sources_checked) || !Array.isArray(latest.provider_errors)) {
    throw new Error('Invalid country news response');
  }
  const unavailable = !latest.sources_checked.length && latest.provider_errors.length > 0;
  if (unavailable && previous?.stories?.length) {
    return {data: previous, failed: true, message: 'All providers unavailable on the latest check.'};
  }
  return {data: latest, failed: false, message: ''};
}
