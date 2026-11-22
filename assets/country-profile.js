'use strict';
(async () => {
  const panel = document.getElementById('country-brief');
  const country = {id: panel.dataset.code, place: panel.dataset.place};
  renderCountryCard(panel, country, null);
  try {
    const response = await fetch('/api/country-news/' + encodeURIComponent(country.id));
    if (response.status === 429) {
      renderCountryCard(panel, country, {failed: true, message: 'Country headlines are rate limited. ' + retryMessage(response)});
      return;
    }
    if (!response.ok) throw new Error();
    renderCountryCard(panel, country, {data: await response.json()});
  } catch {
    renderCountryCard(panel, country, {failed: true});
  }
})();
