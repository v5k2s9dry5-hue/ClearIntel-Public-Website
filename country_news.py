"""Rank recent national and international coverage for the country globe."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import re
from time import monotonic
from urllib.parse import urlencode, urlsplit

from current_events import editorial_events, uk_timeline
from news import _collect, _date, _get, _parse_google_rss, _safe_link, fetch_gdelt, fetch_google

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


# Google News language and edition codes are paired. Unsupported locations use
# a named search and the global current-events digest.
EDITIONS = {
    'AR': ('es-419', 'es-419'), 'AU': ('en-AU', 'en'), 'AT': ('de', 'de'),
    'BE': ('fr', 'fr'), 'BR': ('pt-BR', 'pt-419'), 'CA': ('en-CA', 'en'),
    'CH': ('de', 'de'), 'CL': ('es-419', 'es-419'), 'CO': ('es-419', 'es-419'),
    'DE': ('de', 'de'), 'ES': ('es', 'es'), 'FR': ('fr', 'fr'),
    'GB': ('en-GB', 'en'), 'GR': ('el', 'el'), 'HK': ('zh-TW', 'zh-Hant'),
    'ID': ('id', 'id'), 'IE': ('en-IE', 'en'), 'IN': ('en-IN', 'en'),
    'IT': ('it', 'it'), 'JP': ('ja', 'ja'), 'KR': ('ko', 'ko'),
    'MX': ('es-419', 'es-419'), 'MY': ('en-MY', 'en'), 'NL': ('nl', 'nl'),
    'NZ': ('en-NZ', 'en'), 'PH': ('en-PH', 'en'), 'PL': ('pl', 'pl'),
    'PT': ('pt-PT', 'pt-150'), 'SG': ('en-SG', 'en'), 'TH': ('th', 'th'),
    'TR': ('tr', 'tr'), 'TW': ('zh-TW', 'zh-Hant'), 'UA': ('uk', 'uk'),
    'US': ('en-US', 'en'), 'ZA': ('en-ZA', 'en'),
}
EDITORIAL_PLACE_NAMES = {
    'GB': ('London',), 'FR': ('Paris',), 'DE': ('Berlin',), 'US': ('Washington, D.C.',),
    'IN': ('New Delhi',), 'JP': ('Tokyo',), 'UA': ('Kyiv',), 'KR': ('Seoul',),
    'TR': ('Turkey', 'Ankara', 'Istanbul'),
}
REPORT_HOURS = 36
EDITION_PATH = 'https://news.google.com/headlines/section/topic/NATION'


def _edition_params(code):
    language, edition = EDITIONS[code]
    return urlencode({'hl': language, 'gl': code, 'ceid': f'{code}:{edition}'})


def _fetch_edition(code):
    url = EDITION_PATH.replace('/headlines/', '/rss/headlines/') + '?' + _edition_params(code)
    return [dict(article, edition_rank=rank, country_code=code)
            for rank, article in enumerate(_parse_google_rss(_get(url), country_code=code), start=1)]


def _fetch_country_reports(code, name, names, now):
    topic = ' OR '.join(f'"{term}"' for term in names)

    def fetch_national_edition(*_args):
        return _fetch_edition(code)

    def fetch_current_events(*_args):
        return editorial_events(int(monotonic() // 300))

    def fetch_uk_digest(*_args):
        interval = int(monotonic() // 300)
        oldest = now.date() - timedelta(days=1)
        return [article for year in dict.fromkeys((now.year, oldest.year))
                for article in uk_timeline(year, interval)]

    def fetch_reports(provider):
        def fetch(query, days, incident_only):
            return provider(query, days, incident_only, topic=f'({topic})')
        fetch.__name__ = provider.__name__
        return fetch

    regional = fetch_national_edition if code in EDITIONS else fetch_reports(fetch_google)
    editorial = fetch_uk_digest if code == 'GB' else fetch_current_events
    return _collect(name, 2, False, (regional, fetch_reports(fetch_gdelt), editorial))


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
        if not (title and stamp and _safe_link(url)):
            continue
        if article.get('editorial'):
            if not 0 <= (now.date() - stamp.date()).days <= 1:
                continue
        elif not now - timedelta(hours=REPORT_HOURS) <= stamp <= now + timedelta(minutes=5):
            continue
        if article.get('editorial') and article.get('country_code') != code:
            locations = {place.casefold() for place in (*names, *EDITORIAL_PLACE_NAMES.get(code, ()))}
            if not locations.intersection(topic.casefold() for topic in article.get('topics', [])):
                continue
        elif article.get('country_code') != code and not _match_country(title, code, names):
            continue
        # RSS results often append the publisher to the headline.
        if source and title.casefold().endswith(' - ' + source.casefold()):
            title = title[:-(len(source) + 3)]
        if article.get('official') or source.casefold() in ('gov.uk', 'the white house', 'ukaid'):
            continue
        publisher_url = str(article.get('publisher_url', '')) or url
        domain = urlsplit(publisher_url).hostname if _safe_link(publisher_url) else None
        publisher = re.sub(r'^(?:www\.|m\.)', '', domain or source.casefold())
        if publisher.endswith(('.gov.uk', '.gov', '.gouv.fr')) or publisher in ('gov.uk','parliament.uk'):
            continue
        if len(title) > 320:
            title = title[:319].rsplit(' ', 1)[0] + '…'
        headlines.append({
            'title': title, 'source': source[:90], 'url': url, 'publisher': publisher,
            'edition_rank': article.get('edition_rank'),
            'editorial': article.get('editorial', False),
            'national_digest': article.get('national_digest', False),
            'attribution_title': article.get('attribution_title', 'Wikipedia Current events'),
            'citations': article.get('citations', []),
            'attribution_url': article.get('attribution_url', ''),
            'feed_time_utc': stamp.isoformat(),
            'time_basis': str(article.get('time_basis', 'Feed timestamp'))[:50],
        })
    return sorted(headlines, key=lambda item: item['feed_time_utc'], reverse=True)


def _story_groups(headlines):
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
    return [list(group['reports'].values()) for group in groups]


def _leading_story(headlines):
    editions = [headline for headline in headlines if headline['edition_rank'] is not None]
    if editions:
        first = min(editions, key=lambda headline: headline['edition_rank'])
        related = next((group for group in _story_groups(headlines) if first in group), [first])
        return 'national', [first] + [item for item in related if item is not first][:2]

    corroborated = _story_groups([item for item in headlines if not item['editorial']])
    strongest = max(corroborated, key=len, default=[])
    if len(strongest) >= 2:
        return 'developing', strongest[:3]

    editorial = [item for item in headlines if item['editorial']]
    if editorial:
        selected = max(editorial, key=lambda item: (
            item['national_digest'], item['feed_time_utc'], len(item['citations']),
        ))
        return ('national_digest' if selected['national_digest'] else 'editorial'), [selected]
    # A single unranked result does not establish a leading national story.
    return 'unavailable', []


def search_country_news(code, now=None, fetchers=None):
    now = now or datetime.now(timezone.utc)
    name = COUNTRIES[code]
    names = (name, *ALIASES.get(code, ()))
    if fetchers is None:
        articles, checked, errors = _fetch_country_reports(code, name, names, now)
    else:
        topic = ' OR '.join(f'"{term}"' for term in names)
        articles, checked, errors = _collect(name, 2, False, fetchers, topic=f'({topic})')
    headlines = _headlines(articles, code, names, now)
    basis, story = _leading_story(headlines)
    for article in story:
        article.pop('publisher')
        article.pop('edition_rank')
    return {
        'country': name, 'story': story, 'basis': basis,
        'edition_url': EDITION_PATH + '?' + _edition_params(code) if code in EDITIONS else '',
        'checked_at_utc': now.isoformat(), 'sources_checked': checked, 'provider_errors': errors,
    }
