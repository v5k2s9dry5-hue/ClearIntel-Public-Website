"""Country headlines from the same public feeds as the research desk."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from functools import lru_cache
import json
import re
from time import monotonic
from urllib.parse import urlencode, urlsplit
from xml.etree import ElementTree as ET

from news import _collect, _date, _get, _safe_link, fetch_gdelt, fetch_google

COUNTRY_POINTS = Path(__file__).with_name('assets') / 'countries.json'
COUNTRIES = {
    point['id']: point['place']
    for point in json.loads(COUNTRY_POINTS.read_text(encoding='utf-8'))['events']
}
ALIASES = {
    'AE': ('UAE', 'Emirati'),
    'CD': ('DRC', 'Democratic Republic of the Congo'),
    'CI': ("Ivory Coast", "Côte d'Ivoire"),
    'CZ': ('Czech Republic', 'Czech'),
    'DE': ('German',),
    'FR': ('French',),
    'GB': ('UK', 'Britain', 'British', 'England', 'Scotland', 'Wales', 'Northern Ireland'),
    'GE': ('Tbilisi',),
    'IE': ('Irish',),
    'IN': ('Indian',),
    'JP': ('Japanese',),
    'KR': ('South Korean',),
    'MM': ('Burma', 'Burmese'),
    'PS': ('Palestinian', 'Gaza', 'West Bank'),
    'TR': ('Turkey', 'Turkish'),
    'UA': ('Ukrainian',),
    'US': ('US', 'USA', 'U.S.', 'United States of America'),
}
AMBIGUOUS = {
    'GE': re.compile(r'\b(?:Tbilisi|Georgia(?:n)? (?:government|parliament|prime minister))\b', re.I),
    'TR': re.compile(r'\b(?:Türkiye|Turkish|Ankara|Istanbul|Turkey\W+(?:says|announces|president))\b', re.I),
}


@lru_cache(maxsize=4)
def _official_feed(is_uk, _cache_interval):
    if is_uk:
        params = {
            'filter_content_store_document_type': 'press_release',
            'order': '-public_timestamp', 'count': 15,
        }
        payload = json.loads(_get('https://www.gov.uk/api/search.json?' + urlencode(params)))
        return [{
            'title': item.get('title', ''),
            'url': 'https://www.gov.uk' + item['link'],
            'published': item.get('public_timestamp', ''),
            'source': 'GOV.UK', 'time_basis': 'GOV.UK update time', 'official': True,
            'country_code': 'GB',
        } for item in payload['results']
                 if str(item.get('link', '')).startswith('/government/news/')]
    url = 'https://www.ungeneva.org/news-media/press-items-list/rss.xml'
    root = ET.fromstring(_get(url))
    return [{
        'title': item.findtext('title', ''), 'url': item.findtext('link', ''),
        'published': item.findtext('pubDate', ''),
        'source': 'United Nations Office at Geneva', 'time_basis': 'Publication time', 'official': True,
    } for item in root.findall('./channel/item')]


def fetch_official(query, _days, _incident_only, **_options):
    return _official_feed(query == COUNTRIES['GB'], int(monotonic() // 300))


def _match_country(title, code, names):
    if code in AMBIGUOUS:
        return bool(AMBIGUOUS[code].search(title))
    return any(
        re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', title,
                  0 if name.isupper() else re.I)
        for name in names
    )


def _headlines(articles, code, names, now):
    headlines = []
    for article in articles:
        title = str(article.get('title', '')).strip()
        source = str(article.get('source', '')).strip()
        url = str(article.get('url', '')).strip()
        stamp = _date(str(article.get('published', '')))
        if not (title and stamp and now - timedelta(days=7) <= stamp <= now and _safe_link(url)):
            continue
        if article.get('country_code') != code and not _match_country(title, code, names):
            continue
        # RSS results often append the publisher to the headline.
        if source and title.casefold().endswith(' - ' + source.casefold()):
            title = title[:-(len(source) + 3)]
        publisher_url = str(article.get('publisher_url', '')) or url
        domain = urlsplit(publisher_url).hostname if _safe_link(publisher_url) else None
        publisher = re.sub(r'^(?:www\.|m\.)', '', domain or source.casefold())
        headlines.append({
            'title': title[:320], 'source': source[:90], 'url': url, 'publisher': publisher,
            'official': article.get('official', False),
            'feed_time_utc': stamp.isoformat(),
            'time_basis': str(article.get('time_basis', 'Feed timestamp'))[:50],
        })
    return sorted(headlines, key=lambda item: item['feed_time_utc'], reverse=True)


def _leading_story(headlines):
    groups = []
    for headline in headlines:
        words = set(re.findall(r'\w+', headline['title'].casefold()))
        group = next((group for group in groups
                      if words == group['words'] or
                      (len(words & group['words']) >= 5 and
                       len(words & group['words']) / len(words | group['words']) >= .75)), None)
        if group is None:
            group = {'words': words, 'reports': {}}
            groups.append(group)
        group['reports'].setdefault(headline['publisher'], headline)
    if not groups:
        return []
    leading = max(groups, key=lambda group: len(group['reports']))
    return [{key: value for key, value in report.items() if key not in ('publisher', 'official')}
            for report in list(leading['reports'].values())[:3]]


def search_country_news(code, now=None, fetchers=(fetch_gdelt, fetch_google, fetch_official)):
    now = now or datetime.now(timezone.utc)
    name = COUNTRIES[code]
    names = (name, *ALIASES.get(code, ()))
    topic = ' OR '.join(f'"{term}"' for term in names)
    articles, checked, errors = _collect(name, 7, False, fetchers, topic=f'({topic})')
    headlines = _headlines(articles, code, names, now)
    cutoff = (now - timedelta(hours=24)).isoformat()
    press = [headline for headline in headlines if not headline['official']]
    recent = [headline for headline in press if headline['feed_time_utc'] >= cutoff]
    official = [headline for headline in headlines if headline['official']]
    return {
        'country': name, 'story': _leading_story(recent or press or official[:1]),
        'official_update': not press and bool(official),
        'window_hours': 24 if recent else 168, 'checked_at_utc': now.isoformat(),
        'sources_checked': checked, 'provider_errors': errors,
    }
