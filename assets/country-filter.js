'use strict';
(() => {
  const input = document.getElementById('country-filter');
  const groups = [...document.querySelectorAll('main section')];
  const jumps = [...document.querySelectorAll('.letters a')];
  const aliases = {GB: 'UK Britain Great Britain', US: 'USA United States of America', ES: 'España'};
  const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const entries = [...document.querySelectorAll('.directory li')].map(item => ({
    item, terms: fold([item.textContent, item.dataset.code, aliases[item.dataset.code] || ''].join(' '))
  }));
  function filter() {
    const query = fold(input.value);
    let count = 0;
    for (const {item, terms} of entries) {
      item.hidden = !terms.includes(query);
      if (!item.hidden) count++;
    }
    for (const [index, group] of groups.entries()) {
      group.hidden = !group.querySelector('li:not([hidden])');
      jumps[index].hidden = group.hidden;
    }
    document.getElementById('filter-count').textContent = query ? (count ? count + (count === 1 ? ' match' : ' matches') : 'No matching country or territory') : '';
  }
  document.getElementById('directory-filter').hidden = false;
  input.addEventListener('input', filter);
  filter();
})();
