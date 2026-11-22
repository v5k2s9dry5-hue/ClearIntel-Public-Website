'use strict';
const el = (name, cls, text) => { const node = document.createElement(name); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; };

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
    const wasOpen=Boolean(container.querySelector('.country-coverage-details')?.open);
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
    }else if(!stories.length){
      status.textContent='No leading headline available from the sources checked.';
    }else{
      const count=data.publisher_count;
      const coverage=Number.isInteger(count)?` · ${count} ${count===1?'publisher':'publishers'} found`:'';
      status.textContent=(validTime?`Checked ${utcTime.format(checkedAt)} UTC`:'Check time unavailable')+coverage;
    }
    if(data && !stories.length && validTime)status.textContent+=' · Checked '+utcTime.format(checkedAt)+' UTC';
    if(errors.length)status.textContent+=' · '+(checked.length?'Partial source coverage':'Sources unavailable');
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
    if(data){
      const details=el('details','country-coverage-details');
      details.open=wasOpen;
      details.append(el('summary','','Source coverage details'));
      details.append(el('p','',checked.length+' source checks completed; '+errors.length+' unavailable. A completed check may return no relevant headlines.'));
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
}

function retryMessage(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  return seconds > 0 ? `Try again in ${seconds} seconds.` : 'Try again shortly.';
}
