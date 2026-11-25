"""Conservative, publication-date-filtered public news research.

Publication timestamps are NOT evidence that an incident happened on that date.
Provider titles are unverified leads, never a confirmed event database.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
import socket
import re
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from feed_retry import retry_delay

MAX_RESPONSE_BYTES = 2_000_000
HEADERS = {"User-Agent": "ClearIntel-PublicResearch/1.0 (+contact: contactclearintel@protonmail.me)"}
INCIDENT = re.compile(r"\b(?:bomb(?:s|ed|ing)?|explosions?|blast(?:s)?|air[ -]?strikes?|missile(?:s)?|rocket(?:s)?|struck|strike(?:s)?|attacks?|drone strikes?|shelling|raid(?:s)?)\b", re.I)
SPECULATIVE = re.compile(r"\b(?:threatens?|warns?|vows?|could|might|may|potential|possible|plans? to|considering|weighing|fears?|prepares? to|threat of)\b", re.I)
COMMENTARY = re.compile(
    r"\b(?:discuss(?:es|ed|ing)?|debate[sd]?|debating|talks? (?:about|on)|"
    r"comment(?:s|ed|ing)? on|calls? for|rules? out|interview(?:s|ed)? (?:about|on))\b",
    re.I,
)
AFTERMATH = re.compile(r"\b(?:after|following)\b", re.I)
STOPWORDS = {"today","now","latest","news","breaking","live","reports","report","reporting","bombing","bombings","bomb","bombed","attack","attacks","attacked","airstrike","airstrikes","strike","strikes","explosion","explosions","missile","missiles","happened","in","on","at","of","the","a","an","and","or","about","any","is","there","were","has","been","did"}


SHORT_LOCATIONS = {
    'uk': ('UK', 'United Kingdom', 'Britain', 'British'),
    'gb': ('Great Britain', 'United Kingdom', 'Britain', 'UK'),
    'us': ('US', 'United States', 'USA', 'U.S.'),
}


RATE_LIMIT_COOLDOWN_SECONDS = 60
_rate_limit_lock = Lock()
_rate_limited_until: dict[str, float] = {}


class ProviderCooldownError(Exception):
    pass


def _get(url: str) -> bytes:
    host = urlsplit(url).netloc
    with _rate_limit_lock:
        if monotonic() < _rate_limited_until.get(host, 0):
            raise ProviderCooldownError()
        _rate_limited_until.pop(host, None)

    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=7) as response:
            return response.read(MAX_RESPONSE_BYTES + 1)[:MAX_RESPONSE_BYTES]
    except HTTPError as error:
        if error.code == 429:
            retry_at = monotonic() + max(RATE_LIMIT_COOLDOWN_SECONDS, retry_delay(error))
            with _rate_limit_lock:
                _rate_limited_until[host] = max(retry_at, _rate_limited_until.get(host, 0))
        raise


def _date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        if re.fullmatch(r"\d{8}T\d{6}Z", value):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        value = value.replace("Z", "+00:00")
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        try:
            return parsedate_to_datetime(value).astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            return None


def _safe_link(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password


def fetch_gdelt(query: str, days: int, incident_only: bool = True, *, topic: str = "") -> list[dict]:
    # Country aliases come from a fixed list. Raw user input does not become query syntax.
    topic = topic or _provider_topic(query, joiner=' AND ', quote=True) or '"world"'
    incident = ' (bombing OR bombed OR airstrike OR explosion OR missile OR struck OR attack)' if incident_only else ''
    params = {"query": topic + incident, "mode": "artlist", "format": "json",
              "maxrecords": "75", "timespan": f"{days}d", "sort": "datedesc"}
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params)
    payload = json.loads(_get(url))
    return [{"title": a.get("title", ""), "url": a.get("url", ""),
             "source": a.get("domain", "GDELT source"), "published": a.get("seendate", ""),
             "provider": "GDELT", "time_basis": "First seen by GDELT"} for a in payload.get("articles", [])]


def fetch_google(query: str, days: int, incident_only: bool = True, *, topic: str = "") -> list[dict]:
    topic = topic or _provider_topic(query) or query
    q = f'{topic} (bombing OR bombed OR airstrike OR explosion OR missiles OR attack) when:{days}d' if incident_only else f'{topic} when:{days}d'
    url = "https://news.google.com/rss/search?" + urlencode({"q": q, "hl": "en-GB", "gl": "GB", "ceid": "GB:en"})
    return _parse_google_rss(_get(url))


def _parse_google_rss(content, country_code=None):
    root = ET.fromstring(content)
    channel = root.find('channel')
    if root.tag != 'rss' or channel is None:
        raise ValueError('Invalid Google News RSS')
    if country_code:
        params = parse_qs(urlsplit(channel.findtext('link', '')).query)
        edition = params.get('ceid', [''])[0].split(':')[0]
        if edition != country_code and params.get('gl') != [country_code]:
            raise ValueError('Feed returned the wrong country edition')
    records = []
    for item in root.findall(".//channel/item"):
        source = item.find("source")
        records.append({"title": item.findtext("title", ""), "url": item.findtext("link", ""),
                        "published": item.findtext("pubDate", ""),
                        "source": source.text if source is not None and source.text else "Publisher via Google News",
                        "provider": "Google News", "time_basis": "Publication time via Google News",
                        "publisher_url": source.get("url", "") if source is not None else ""})
    return records



def fetch_bing(query: str, days: int, incident_only: bool = True) -> list[dict]:
    """Search-indexed news RSS, an independent fallback when other providers fail."""
    topic = _provider_topic(query) or query
    suffix = ' (bombing OR bombed OR airstrike OR explosion OR missile OR attack)' if incident_only else ''
    url = 'https://www.bing.com/news/search?' + urlencode({'q': topic + suffix, 'format': 'rss'})
    root = ET.fromstring(_get(url))
    records = []
    for item in root.findall('.//channel/item'):
        records.append({'title': item.findtext('title',''), 'url': item.findtext('link',''),
                        'published': item.findtext('pubDate',''),
                        'source': item.findtext('source','') or 'Publisher via Bing News',
                        'provider': 'Bing News', 'time_basis': 'Publication time via Bing News'})
    return records


def _provider_error(error: Exception) -> str:
    """Safe diagnostic category: never expose full upstream messages or URLs."""
    if isinstance(error, ProviderCooldownError):
        return 'temporarily paused after HTTP 429'
    if isinstance(error, HTTPError):
        return 'HTTP ' + str(error.code)
    if isinstance(error, (TimeoutError, socket.timeout)):
        return 'timeout'
    if isinstance(error, URLError):
        reason = error.reason
        if isinstance(reason, (TimeoutError, socket.timeout)):
            return 'timeout'
        if isinstance(reason, socket.gaierror):
            return 'DNS error'
        return 'connection error'
    if isinstance(error, (ValueError, json.JSONDecodeError, ET.ParseError)):
        return 'invalid provider response'
    return type(error).__name__


def _subject(query: str) -> list[str]:
    # Limit to user-supplied plain words. Quoted operators/URLs cannot control provider queries.
    words = re.findall(r"[\w'-]+", query.lower(), flags=re.UNICODE)
    return [w for w in words if w not in STOPWORDS and len(w) > 1][:5]


def _provider_topic(query, joiner=' ', quote=False):
    parts = []
    for term in _subject(query)[:3 if quote else 5]:
        aliases = SHORT_LOCATIONS.get(term)
        if aliases:
            parts.append('(' + ' OR '.join(f'"{alias}"' for alias in aliases) + ')')
        else:
            parts.append(f'"{term}"' if quote else term)
    return joiner.join(parts)


def _reports_incident(title: str) -> bool:
    main, *aftermath = AFTERMATH.split(title, maxsplit=1)
    return any(
        INCIDENT.search(clause) and not SPECULATIVE.search(clause) and not COMMENTARY.search(clause)
        for clause in (main, *aftermath)
    )


def _relevance(title: str, subject: list[str], incident_only: bool) -> int:
    matches = 0
    for term in subject:
        aliases = SHORT_LOCATIONS.get(term, (term,))
        if any(re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', title,
                         0 if alias in ('US', 'UK', 'USA', 'U.S.') else re.I)
               for alias in aliases):
            matches += 1
    if subject and not matches:
        return -1
    is_incident = bool(INCIDENT.search(title))
    if incident_only and not _reports_incident(title):
        return -1
    return (4 if is_incident else 0) + matches


def _collect(query, days, incident_only, fetchers, *, workers=3, **options):
    combined, checked, errors = [], [], []
    # Each live source uses a bounded timeout; calls run concurrently to avoid 3x waiting.
    with ThreadPoolExecutor(max_workers=min(workers,len(fetchers))) as pool:
        pending = {pool.submit(provider, query, days, incident_only, **options):
                   getattr(provider, '__name__', 'source').replace('fetch_', '') for provider in fetchers}
        for future in as_completed(pending):
            label = pending[future]
            try:
                found = future.result()
                checked.append(label)
                combined.extend(found)
            except Exception as error:
                category = _provider_error(error)
                logging.warning('ClearIntel news provider %s failed: %s',label,category)
                errors.append(label + ': ' + category)
    return combined, checked, errors


def _headline_without_source(title, source):
    headline, separator, suffix = title.rpartition(" - ")
    if separator and headline and source and suffix.casefold() == source.casefold():
        return headline
    return title


def _copy_priority(article):
    """Prefer a stated publication time, then a direct publisher link."""
    host = urlsplit(article["url"]).hostname
    indexed_link = host in {"news.google.com", "www.bing.com", "bing.com"}
    return (article["time_basis"].startswith("Publication time"), not indexed_link,
            article["feed_time_utc"], article["url"], article["title"], article["source"],
            article["provider"])


def search_news(query: str, days: int = 1, incident_only: bool = True,
                now: datetime | None = None, fetchers=None, *, country_code=None) -> dict:
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    subject = _subject(query)
    if not subject:
        return {"results": [], "sources_checked": [], "provider_errors": [], "notice": "Enter a location or subject, not just 'bombing today'.", "window_start": start.isoformat(), "window_end": now.isoformat()}
    fetchers = fetchers if fetchers is not None else (fetch_gdelt, fetch_google, fetch_bing)
    combined, checked, errors = _collect(query, days, incident_only, fetchers)
    best_by_headline = {}
    for article in combined:
        url = str(article.get("url", "")).strip()
        source = str(article.get("source", "Publisher")).strip() or "Publisher"
        title = _headline_without_source(str(article.get("title", "")).strip(), source)
        pub = _date(str(article.get("published", "")))
        if not title or not _safe_link(url) or pub is None or not (start <= pub <= now + timedelta(minutes=5)):
            continue
        scoped = country_code is not None and article.get('country_code') == country_code
        score = _relevance(title, [] if scoped else subject, incident_only)
        if score < 0:
            continue
        key = tuple(re.findall(r"\w+", title.casefold()))
        if not key:
            continue
        entry = {"title": title[:320], "url": url, "source": source[:90],
                 "feed_time_utc": pub.isoformat(), "incident_time_utc": None,
                 "time_basis": str(article.get("time_basis", "Provider timestamp"))[:45],
                 "provider": str(article.get("provider", ""))[:30], "relevance": score}
        previous = best_by_headline.get(key)
        if previous is None or _copy_priority(entry) > _copy_priority(previous):
            best_by_headline[key] = entry
    ranked = sorted(best_by_headline.values(),
                    key=lambda item: (item["relevance"], item["feed_time_utc"], item["title"], item["url"]),
                    reverse=True)
    if not checked and errors:
        notice = ("News search unavailable: all queried feeds failed to respond. "
                  "No results were established, and this does not mean that nothing happened.")
    elif not checked:
        notice = "No news feeds were checked. This result cannot establish that no reports exist."
    elif not ranked and not incident_only:
        notice = "No headlines matched this search within the selected time window."
    elif not ranked:
        notice = ("No matching recent incident headlines were found in the available feeds. "
                  "This does not prove that no incident occurred.")
    else:
        notice = ("These are recently listed news headlines matching your search, NOT independently confirmed incidents. "
                  "Feed dates can be publication or first-seen times, and are NOT confirmed incident dates.")
    return {"results": ranked[:35], "sources_checked": checked, "provider_errors": errors,
            "window_start": start.isoformat(), "window_end": now.isoformat(), "notice": notice}
