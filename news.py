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
from urllib.error import HTTPError, URLError
import socket
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

MAX_RESPONSE_BYTES = 2_000_000
HEADERS = {"User-Agent": "ClearIntel-PublicResearch/1.0 (+contact: contactclearintel@protonmail.me)"}
INCIDENT = re.compile(r"\b(?:bomb(?:s|ed|ing)?|explosions?|blast(?:s)?|air[ -]?strikes?|missile(?:s)?|rocket(?:s)?|struck|strike(?:s)?|attacks?|drone strikes?|shelling|raid(?:s)?)\b", re.I)
SPECULATIVE = re.compile(r"\b(?:threatens?|warns?|vows?|could|might|may|potential|possible|plans? to|considering|weighing|fears?|prepares? to|threat of)\b", re.I)
STOPWORDS = {"today","now","latest","news","breaking","live","reports","report","reporting","bombing","bombings","bomb","bombed","attack","attacks","attacked","airstrike","airstrikes","strike","strikes","explosion","explosions","missile","missiles","happened","in","on","at","of","the","a","an","and","or","about","any","is","there","were","has","been","did"}


def _get(url: str) -> bytes:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=7) as response:
        return response.read(MAX_RESPONSE_BYTES + 1)[:MAX_RESPONSE_BYTES]


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
    parsed = urlsplit(url)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password


def fetch_gdelt(query: str, days: int, incident_only: bool = True) -> list[dict]:
    terms = _subject(query)
    # GDELT's query language supports Boolean clauses, but the user input does not become raw query syntax.
    if terms:
        topic = " AND ".join('"'+t+'"' for t in terms[:3])
    else:
        topic = '"world"'
    incident = ' (bombing OR bombed OR airstrike OR explosion OR missile OR struck OR attack)' if incident_only else ''
    params = {"query": topic + incident, "mode": "artlist", "format": "json",
              "maxrecords": "75", "timespan": f"{days}d", "sort": "datedesc"}
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params)
    payload = json.loads(_get(url))
    return [{"title": a.get("title", ""), "url": a.get("url", ""),
             "source": a.get("domain", "GDELT source"), "published": a.get("seendate", ""),
             "provider": "GDELT", "time_basis": "First seen by GDELT"} for a in payload.get("articles", [])]


def fetch_google(query: str, days: int, incident_only: bool = True) -> list[dict]:
    terms = _subject(query)
    topic = " ".join(terms) or query
    q = f'{topic} (bombing OR bombed OR airstrike OR explosion OR missiles OR attack) when:{days}d' if incident_only else f'{topic} when:{days}d'
    url = "https://news.google.com/rss/search?" + urlencode({"q": q, "hl": "en-GB", "gl": "GB", "ceid": "GB:en"})
    root = ET.fromstring(_get(url))
    records = []
    for item in root.findall(".//channel/item"):
        source = item.find("source")
        records.append({"title": item.findtext("title", ""), "url": item.findtext("link", ""),
                        "published": item.findtext("pubDate", ""),
                        "source": source.text if source is not None and source.text else "Publisher via Google News",
                        "provider": "Google News", "time_basis": "Google News feed date"})
    return records



def fetch_bing(query: str, days: int, incident_only: bool = True) -> list[dict]:
    """Search-indexed news RSS, an independent fallback when other providers fail."""
    terms = _subject(query)
    topic = ' '.join(terms) or query
    suffix = ' (bombing OR bombed OR airstrike OR explosion OR missile OR attack)' if incident_only else ''
    url = 'https://www.bing.com/news/search?' + urlencode({'q': topic + suffix, 'format': 'rss'})
    root = ET.fromstring(_get(url))
    records = []
    for item in root.findall('.//channel/item'):
        records.append({'title': item.findtext('title',''), 'url': item.findtext('link',''),
                        'published': item.findtext('pubDate',''),
                        'source': item.findtext('source','') or 'Publisher via Bing News',
                        'provider': 'Bing News', 'time_basis': 'Bing News feed date'})
    return records


def _provider_error(error: Exception) -> str:
    """Safe diagnostic category: never expose full upstream messages or URLs."""
    if isinstance(error, HTTPError):
        return 'HTTP ' + str(error.code)
    if isinstance(error, (TimeoutError, socket.timeout)):
        return 'timeout'
    if isinstance(error, URLError):
        return 'connection or DNS error'
    if isinstance(error, (ValueError, json.JSONDecodeError, ET.ParseError)):
        return 'invalid provider response'
    return type(error).__name__


def _subject(query: str) -> list[str]:
    # Limit to user-supplied plain words. Quoted operators/URLs cannot control provider queries.
    words = re.findall(r"[\w'-]+", query.lower(), flags=re.UNICODE)
    return [w for w in words if w not in STOPWORDS and len(w) > 1][:5]


def _relevance(title: str, subject: list[str], incident_only: bool) -> int:
    lowered = title.casefold()
    if subject and not any(re.search(r"(?<!\w)"+re.escape(t)+r"(?!\w)", lowered) for t in subject):
        return -1
    is_incident = bool(INCIDENT.search(title))
    if incident_only and (not is_incident or SPECULATIVE.search(title)):
        return -1
    return (4 if is_incident else 0) + sum(1 for t in subject if t in lowered)


def search_news(query: str, days: int = 1, incident_only: bool = True,
                now: datetime | None = None, fetchers=None) -> dict:
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    subject = _subject(query)
    if not subject:
        return {"results": [], "sources_checked": [], "provider_errors": [], "notice": "Enter a location or subject, not just 'bombing today'.", "window_start": start.isoformat(), "window_end": now.isoformat()}
    fetchers = fetchers if fetchers is not None else (fetch_gdelt, fetch_google, fetch_bing)
    combined, checked, errors = [], [], []
    # Each live source uses a bounded timeout; calls run concurrently to avoid 3x waiting.
    with ThreadPoolExecutor(max_workers=min(3,len(fetchers))) as pool:
        pending = {pool.submit(provider, query, days, incident_only):
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
    ranked = []
    seen = set()
    for article in combined:
        title, url = str(article.get("title", "")).strip(), str(article.get("url", "")).strip()
        pub = _date(str(article.get("published", "")))
        if not title or not _safe_link(url) or pub is None or not (start <= pub <= now + timedelta(minutes=5)):
            continue
        score = _relevance(title, subject, incident_only)
        if score < 0:
            continue
        key = re.sub(r"\W+", "", title.casefold().split(' - ')[0])
        if key in seen:
            continue
        seen.add(key)
        ranked.append({"title": title[:320], "url": url, "source": str(article.get("source", "Publisher"))[:90],
                       "feed_time_utc": pub.isoformat(), "time_basis": str(article.get("time_basis", "Provider timestamp"))[:45], "provider": str(article.get("provider", ""))[:30],
                       "relevance": score})
    ranked.sort(key=lambda r: (r["relevance"], r["feed_time_utc"]), reverse=True)
    if not ranked:
        notice = ("No matching recent incident headlines were found in the available feeds. "
                  "This does not prove that no incident occurred.")
    else:
        notice = ("These are recently listed news headlines matching your search, NOT independently confirmed incidents. "
                  "Feed dates can be publication or first-seen times, and are NOT confirmed incident dates.")
    return {"results": ranked[:35], "sources_checked": checked, "provider_errors": errors,
            "window_start": start.isoformat(), "window_end": now.isoformat(), "notice": notice}
