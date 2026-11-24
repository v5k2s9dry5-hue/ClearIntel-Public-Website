'use strict';
(() => {
  const form = $('dashboard-search');
  const input = $('dashboard-query');
  const matches = $('dashboard-matches');
  const status = $('dashboard-search-status');
  const layers = $('globe-layer');
  const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const aliases = {uk:'GB', britain:'GB', usa:'US', espana:'ES'};
  let version = 0;

  function clear() {
    version++;
    matches.replaceChildren();
    matches.hidden = true;
    status.textContent = '';
  }
  function link(label, url) {
    const item = el('a', '', label);
    item.href = url;
    return item;
  }
  function action(label, handler) {
    const button = el('button', 'globe-control', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }
  function dismissMatches(event) {
    if (event.key !== 'Escape' || matches.hidden) return;
    event.preventDefault();
    clear();
    input.focus();
  }
  form.addEventListener('keydown', dismissMatches);
  matches.addEventListener('keydown', dismissMatches);
  form.hidden = false;
  input.addEventListener('input', clear);
  const searchTab=$('dashboard-search-tab');
  const markSearch=()=>{searchTab.setAttribute('aria-pressed','true');$('dashboard-map-tab').setAttribute('aria-pressed','false');$('dashboard-feed-tab').setAttribute('aria-pressed','false');};
  for(const id of ['dashboard-map-tab','dashboard-feed-tab'])$(id).addEventListener('click',()=>searchTab.setAttribute('aria-pressed','false'));
  input.addEventListener('focus',markSearch);
  searchTab.addEventListener('click', () => {
    markSearch();
    input.scrollIntoView({block:'center'});
    input.focus({preventScroll:true});
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clear();
    const request = version;
    const query = input.value.trim();
    const term = fold(query);
    if (term.length < 2) { input.focus(); return; }

    const choices = [];
    for (const option of layers.options) {
      const archive = ['aviation','maritime'].includes(option.value);
      const keywords = option.text + ' ' + option.value + (option.value === 'maritime' ? ' UKMTO shipping bulletins' : '');
      if (!fold(keywords).includes(term)) continue;
      choices.push(action(option.text + (archive ? ' · Historical map layer' : ' · Map layer'), () => {
        layers.value = option.value;
        layers.dispatchEvent(new Event('change'));
        const openBulletins = term === 'ukmto';
        if (matchMedia('(max-width: 860px)').matches) {
          $(openBulletins ? 'dashboard-feed-tab' : 'dashboard-map-tab').click();
        }
        const target = openBulletins ? $('ukmto-bulletins').querySelector('a') : $('dashboard-map-heading');
        target.focus();
        target.scrollIntoView({block:'center'});
      }));
    }
    for (const anchor of $('dashboard-sidebar').querySelectorAll('a')) {
      if (fold(anchor.textContent).includes(term)) choices.push(link(anchor.textContent, anchor.href));
    }
    const news = action('Search recent headlines for “' + query + '”', () => {
      const field = $('news-query');
      field.scrollIntoView({block:'center'});
      field.focus({preventScroll:true});
      if ($('news-submit').disabled) return;
      field.value = query;
      $('news-form').requestSubmit();
    });
    function display(rows, message) {
      matches.replaceChildren(...rows, news);
      matches.hidden = false;
      status.textContent = message;
    }
    display(choices, 'Looking for matching countries.');
    try {
      const countries = await loadCountries();
      if (request !== version) return;
      const exact = country => country.id === (aliases[term] || term.toUpperCase()) || fold(country.place) === term;
      const found = countries.filter(c => exact(c) || fold(c.place).includes(term))
        .sort((a,b) => Number(exact(b)) - Number(exact(a)) || a.place.localeCompare(b.place));
      const links = found.slice(0,8).map(c => link(c.place + ' · Country profile', '/countries/' + c.id.toLowerCase()));
      if (found.length > links.length) links.push(link('Browse all countries', '/countries'));
      // Preserve focus if a keyboard user already reached a local action.
      matches.prepend(...links);
      status.textContent = (choices.length + links.length) + ' dashboard matches. News search available.';
    } catch {
      if (request === version) status.textContent = 'Country suggestions unavailable. News search available.';
    }
  });
})();
