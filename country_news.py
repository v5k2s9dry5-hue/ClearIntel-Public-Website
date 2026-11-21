"""Rank recent national and international coverage for the country globe."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import logging
import unicodedata
import xml.etree.ElementTree as ET
import re
from time import monotonic
from urllib.parse import urlencode, urlsplit

from current_events import editorial_events, country_timeline
from news import _collect, _date, _get, _parse_google_rss, _safe_link, fetch_gdelt, fetch_google, fetch_bing, search_news

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
    'ES': ('Spanish', 'España', 'Madrid'),
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


NATIONAL_FEEDS = {
    'AU': ('ABC News', 'https://www.abc.net.au/news/feed/51120/rss.xml'),
    'BB': ('Barbados Today', 'https://barbadostoday.bb/feed/'),
    'BR': ('G1 Política', 'https://g1.globo.com/rss/g1/politica/'),
    'DE': ('Tagesschau', 'https://www.tagesschau.de/inland/index~rss2.xml'),
    'FR': ('Franceinfo', 'https://www.franceinfo.fr/france.rss'),
    'IN': ('The Hindu', 'https://www.thehindu.com/news/national/feeder/default.rss'),
    'KE': ('The Standard', 'https://www.standardmedia.co.ke/rss/headlines.php'),
    'IT': ('ANSA Cronaca', 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml'),
    'NZ': ('RNZ', 'https://www.rnz.co.nz/rss/national.xml'),
    'US': ('NPR', 'https://feeds.npr.org/1003/rss.xml'),
    'ES': ('El País', 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/espana/portada'),
    'GB': ('BBC News', 'https://feeds.bbci.co.uk/news/uk/rss.xml'),
}
GUARDIAN_SECTIONS = {
    'GB': 'uk-news', 'US': 'us-news', 'AU': 'australia-news',
    'AE': 'world/united-arab-emirates', 'TR': 'world/turkey', 'CZ': 'world/czech-republic',
}


# These are country-scoped publisher sections, not additional rankings of the
# national homepage. Keep regional titles available without calling local
# reporting the country's leading national story.
REGIONAL_FEEDS = {
    'GB': (
        ('BBC England', 'https://feeds.bbci.co.uk/news/england/rss.xml'),
        ('BBC Scotland', 'https://feeds.bbci.co.uk/news/scotland/rss.xml'),
        ('BBC Wales', 'https://feeds.bbci.co.uk/news/wales/rss.xml'),
        ('BBC Northern Ireland', 'https://feeds.bbci.co.uk/news/northern_ireland/rss.xml'),
    ),
    'ES': (
        ('El Mundo España', 'https://e00-elmundo.uecdn.es/elmundo/rss/espana.xml'),
    ),
}

# Approximate city-centre points, used ONLY when a headline explicitly
# names the city. These are headline mentions, not verified event locations.
HEADLINE_CITIES = {
    'GB': (
        ('London', -0.1276, 51.5072), ('Bristol', -2.5879, 51.4545),
        ('Birmingham', -1.8904, 52.4862), ('Manchester', -2.2426, 53.4808),
        ('Liverpool', -2.9785, 53.4084), ('Leeds', -1.5491, 53.8008),
        ('Sheffield', -1.4701, 53.3811), ('Newcastle', -1.6132, 54.9783),
        ('Cardiff', -3.1791, 51.4816), ('Edinburgh', -3.1883, 55.9533),
        ('Glasgow', -4.2518, 55.8642), ('Belfast', -5.9301, 54.5973),
        ('Aberdeen', -2.0943, 57.1497), ('Southampton', -1.4044, 50.9097),
        ('Nottingham', -1.1505, 52.9548),
    ),
    'ES': (
        ('Madrid', -3.7038, 40.4168), ('Barcelona', 2.1734, 41.3851),
        ('Valencia', -0.3763, 39.4699), ('Sevilla', -5.9845, 37.3891),
        ('Málaga', -4.4214, 36.7213), ('Zaragoza', -0.8891, 41.6488),
        ('Bilbao', -2.9350, 43.2630), ('Granada', -3.5986, 37.1773),
        ('Alicante', -0.4907, 38.3452), ('Murcia', -1.1307, 37.9922),
        ('Valladolid', -4.7286, 41.6523), ('Vigo', -8.7207, 42.2406),
    ),
}
CITY_ALIASES = {'Sevilla': ('Seville',), 'Málaga': ('Malaga',)}


def _city_mention(title, code):
    for city, longitude, latitude in HEADLINE_CITIES.get(code, ()):
        forms = (city, *CITY_ALIASES.get(city, ()))
        if any(re.search(r'(?<!\\w)' + re.escape(form) + r'(?!\\w)', title, re.I)
               for form in forms):
            return {'city': city, 'longitude': longitude, 'latitude': latitude}
    return None


def _publisher_reports(url, source, code, national):
    channel = ET.fromstring(_get(url)).find('channel')
    if channel is None:
        raise ValueError('Invalid publisher feed')
    if source == 'The Guardian' and urlsplit(channel.findtext('link', '')).path.rstrip('/') != urlsplit(url).path.removesuffix('/rss'):
        raise ValueError('Wrong country section')
    return [{
        'title': item.findtext('title', ''), 'url': item.findtext('link', ''),
        'published': item.findtext('pubDate', ''), 'source': source, 'country_code': code,
        'provider': source, 'publisher_rank': rank if national else None, 'time_basis': 'Publication time',
    } for rank, item in enumerate(channel.findall('item'), 1)]


def guardian_reports(code, name):
    ascii_name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    slug = re.sub('[^a-z0-9]+', '-', ascii_name).strip('-')
    section = GUARDIAN_SECTIONS.get(code, 'world/' + slug)
    return _publisher_reports(f'https://www.theguardian.com/{section}/rss', 'The Guardian', code, False)



COUNTRY_QUERIES = {name.casefold(): code for code, name in COUNTRIES.items()}
COUNTRY_QUERIES.update({code.lower(): code for code in COUNTRIES})
COUNTRY_QUERIES.update({'uk': 'GB', 'britain': 'GB', 'usa': 'US',
                        'united states of america': 'US', 'españa': 'ES'})


def search_research(query, days, incident_only):
    code = COUNTRY_QUERIES.get(query.strip().casefold())
    if not code:
        return search_news(query, days, incident_only)

    def fetch_country_section(*_args):
        if code in NATIONAL_FEEDS:
            source, url = NATIONAL_FEEDS[code]
            return _publisher_reports(url, source, code, True)
        return guardian_reports(code, COUNTRIES[code])

    return search_news(query, days, incident_only, country_code=code,
                       fetchers=(fetch_country_section, fetch_google, fetch_bing, fetch_gdelt))


def _fetch_country_reports(code, name, names, now):
    topic = ' OR '.join(f'"{term}"' for term in names)

    def fetch_national_edition(*_args):
        return _fetch_edition(code)

    def fetch_current_events(*_args):
        return editorial_events(int(monotonic() // 300))

    def fetch_country_digest(*_args):
        interval = int(monotonic() // 300)
        oldest = now.date() - timedelta(days=6)
        return [article for year in dict.fromkeys((now.year, oldest.year))
                for article in country_timeline(year, code, name, interval)]

    def fetch_reports(provider):
        def fetch(query, days, incident_only):
            return provider(query, days, incident_only, topic=f'({topic})')
        fetch.__name__ = provider.__name__
        return fetch

    regional = fetch_national_edition if code in EDITIONS else fetch_reports(fetch_google)
    def fetch_guardian(*_args):
        return guardian_reports(code, name)

    providers = [regional, fetch_guardian, fetch_country_digest, fetch_reports(fetch_gdelt),
                 fetch_current_events, fetch_bing]
    if code in NATIONAL_FEEDS:
        def fetch_domestic_desk(*_args):
            source, url = NATIONAL_FEEDS[code]
            return _publisher_reports(url, source, code, True)
        providers.insert(0, fetch_domestic_desk)
    for source, url in REGIONAL_FEEDS.get(code, ()):
        def fetch_region(*_args, source=source, url=url):
            return _publisher_reports(url, source, code, False)
        fetch_region.__name__ = 'fetch_' + re.sub(r'[^a-z0-9]+', '_', source.casefold())
        providers.append(fetch_region)
    if code == 'KE':
        def fetch_kenya_news(*_args):
            return _publisher_reports('https://www.tuko.co.ke/rss/kenya.rss', 'Tuko', code, True)
        providers.insert(1, fetch_kenya_news)
    return _collect(name, 2, False, providers)


def _match_country(title, code, names):
    if code in AMBIGUOUS:
        return bool(AMBIGUOUS[code].search(title))
    return any(
        re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', title,
                  0 if name.isupper() else re.I)
        for name in names
    )


def _headlines(articles, code, names, now, *, weekly=False):
    headlines = []
    for article in articles:
        title = str(article.get('title', '')).strip()
        source = str(article.get('source', '')).strip()
        url = str(article.get('url', '')).strip()
        stamp = _date(str(article.get('published', '')))
        if not (title and stamp and _safe_link(url)):
            continue
        if weekly and not (article.get('editorial') or article.get('country_code') == code):
            continue
        if article.get('editorial'):
            if not 0 <= (now.date() - stamp.date()).days <= (6 if weekly else 1):
                continue
        elif not now - timedelta(hours=168 if weekly else REPORT_HOURS) <= stamp <= now + timedelta(minutes=5):
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
            'publisher_rank': article.get('publisher_rank'),
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
    for item in headlines:
        words = set(re.findall(r'\w+', item['title'].casefold()))
        for first_words, reports in groups:
            overlap = len(words & first_words)
            if words == first_words or (overlap >= 5 and overlap / len(words | first_words) >= .64):
                reports.append(item)
                break
        else:
            groups.append((words, [item]))
    return [reports for _, reports in groups]


def _rank_group(group):
    def prominence(item):
        return (item['edition_rank'] or 9999, item['publisher_rank'] or 9999,
                not item['national_digest'], not item['editorial'])

    ordered = sorted(group, key=prominence)
    lead = ordered[0]
    publishers, titles, urls, reports = set(), set(), set(), []
    for item in ordered:
        title = ' '.join(re.findall(r'\w+', item['title'].casefold()))
        duplicate = item['publisher'] in publishers or title in titles or item['url'] in urls
        titles.add(title)
        urls.add(item['url'])
        publishers.add(item['publisher'])
        if not duplicate:
            reports.append(item)

    if lead['edition_rank']:
        tier, basis = 5, 'national'
    elif len(reports) >= 2:
        tier, basis = 4, 'developing'
    elif lead['publisher_rank']:
        tier, basis = 3, 'publisher'
    elif lead['editorial']:
        tier, basis = 2, 'national_digest' if lead['national_digest'] else 'editorial'
    else:
        tier, basis = 1, 'recent'
    priority = (tier, len(reports), -(lead['edition_rank'] or lead['publisher_rank'] or 9999),
                max(item['feed_time_utc'] for item in group), lead['title'])
    return priority, {'basis': basis, 'reports': reports[:3]}


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
    weekly = not headlines
    if weekly:
        headlines = _headlines(articles, code, names, now, weekly=True)
    ranked = sorted((_rank_group(group) for group in _story_groups(headlines)),
                    key=lambda pair: pair[0], reverse=True)
    stories = [group for _, group in ranked[:3]]
    publisher_count = len({item['publisher'] for item in headlines})
    # A city pin asserts only that a current, source-linked headline mentions a
    # city name. It does not infer where an event occurred or that it happened.
    city_mentions = []
    city_seen = set()
    for article in headlines:
        mention = _city_mention(article['title'], code)
        if mention and mention['city'] not in city_seen:
            city_seen.add(mention['city'])
            city_mentions.append({
                **mention, 'headline': article['title'], 'url': article['url'],
                'source': article['source'], 'feed_time_utc': article['feed_time_utc'],
                'label': 'Headline mentions city',
            })
        if len(city_mentions) >= 15:
            break
    logging.getLogger('uvicorn.error').info(
        'Country coverage code=%s stories=%d publishers=%d weekly=%s',
        code, len(stories), publisher_count, weekly and bool(stories))
    for group in stories:
        if weekly:
            group['basis'] = 'weekly'
        for article in group['reports']:
            for key in ('publisher', 'edition_rank', 'publisher_rank'):
                article.pop(key)
    lead = stories[0] if stories else {'basis': 'unavailable', 'reports': []}
    return {
        'country': name, 'stories': stories, 'publisher_count': publisher_count,
        'city_mentions': city_mentions,
        'story': lead['reports'], 'basis': lead['basis'],
        'edition_url': EDITION_PATH + '?' + _edition_params(code) if code in EDITIONS else '',
        'checked_at_utc': now.isoformat(), 'sources_checked': checked, 'provider_errors': errors,
    }
