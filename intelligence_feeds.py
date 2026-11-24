"""Allowlisted official publication feeds; shared short cache, no user supplied URLs."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from xml.etree import ElementTree as ET
from fastapi import APIRouter, HTTPException

router = APIRouter()
SOURCES = {
    "humanitarian": ("GDACS disaster alerts", "https://www.gdacs.org/xml/rss.xml", "https://www.gdacs.org/alerts/", {"www.gdacs.org", "gdacs.org"}),
    "geopolitical": ("FCDO", "https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom", "https://www.gov.uk/government/organisations/foreign-commonwealth-development-office", {"www.gov.uk"}),
    "cyber": ("UK NCSC", "https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml", "https://www.ncsc.gov.uk/information/rss-feeds", {"www.ncsc.gov.uk", "ncsc.gov.uk"}),
    "economic": ("European Central Bank", "https://www.ecb.europa.eu/rss/press.html", "https://www.ecb.europa.eu/home/html/rss.en.html", {"www.ecb.europa.eu"}),
    "travel": ("FCDO travel advice", "https://www.gov.uk/foreign-travel-advice.atom", "https://www.gov.uk/foreign-travel-advice", {"www.gov.uk"}),
}
TTL = 300
MAX_BYTES = 1024 * 1024
_cache = {}
_retry = {}
_locks = {key: Lock() for key in SOURCES}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _text(node, *names):
    for child in node:
        if child.tag.rsplit("}", 1)[-1] in names and child.text:
            return " ".join(child.text.split())
    return ""

def _date(value):
    try:
        try:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            return None
        return date.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None

def parse_feed(data, hosts):
    if len(data) > MAX_BYTES or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper() or b"\x00" in data:
        raise ValueError("Unsafe XML")
    root = ET.fromstring(data)
    if root.tag.rsplit("}", 1)[-1] not in {"rss", "feed", "RDF"}:
        raise ValueError("Not a feed")
    rows = {}
    item_count = 0
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] not in {"entry", "item"}:
            continue
        item_count += 1
        title = _text(node, "title")
        stamp = next((date for field in ("published", "pubDate", "updated", "date") if (date := _date(_text(node, field))) is not None), None)
        link = _text(node, "link")
        for child in node:
            if child.tag.rsplit("}", 1)[-1] == "link" and child.get("rel", "alternate") == "alternate" and child.get("href"):
                link = child.get("href")
                break
        try:
            url = urlsplit(link)
            # GDACS RSS has historically published HTTP report links. Upgrade only
            # the known provider host, never arbitrary links or credentials.
            if (url.scheme == "http" and url.hostname in {"www.gdacs.org", "gdacs.org"}
                    and url.hostname in hosts and not url.username and not url.password
                    and url.port in (None, 80)):
                link = urlunsplit(("https", url.hostname, url.path, url.query, url.fragment))
                url = urlsplit(link)
            valid = url.scheme == "https" and url.hostname in hosts and not url.username and not url.password and url.port in (None, 443)
        except ValueError:
            valid = False
        if title and stamp and valid and len(link) <= 2048 and not any(ord(c) < 33 or c == "\\" for c in link):
            rows[link] = {"title": title[:240], "url": link, "published_at_utc": stamp}
    if item_count and not rows:
        raise ValueError("Feed contains items but no valid dated source links")
    return sorted(rows.values(), key=lambda x: x["published_at_utc"], reverse=True)[:30]

def _download(url):
    request = Request(url, headers={"User-Agent": "ClearIntel Atlas public feed reader", "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml"})
    with build_opener(NoRedirect()).open(request, timeout=8) as response:
        data = response.read(MAX_BYTES + 1)
    return data

@router.get("/api/intelligence-feed/{category}", include_in_schema=False)
def feed(category: str):
    if category not in SOURCES:
        raise HTTPException(404, "Unknown feed")
    name, url, website, hosts = SOURCES[category]
    now = monotonic()
    snapshot = _cache.get(category)
    if (not snapshot or now - snapshot[0] >= TTL) and now >= _retry.get(category, 0) and _locks[category].acquire(blocking=False):
        try:
            snapshot = _cache.get(category)
            if (not snapshot or monotonic() - snapshot[0] >= TTL) and monotonic() >= _retry.get(category, 0):
                try:
                    rows = parse_feed(_download(url), hosts)
                    snapshot = (monotonic(), datetime.now(timezone.utc).isoformat(), rows)
                    _cache[category] = snapshot
                    _retry.pop(category, None)
                except (OSError, ValueError, ET.ParseError):
                    _retry[category] = monotonic() + TTL
        finally:
            _locks[category].release()
    snapshot = _cache.get(category)
    return {"source": name, "source_url": website, "checked_at_utc": snapshot[1] if snapshot else None,
            "status": "unavailable" if not snapshot else "stale" if monotonic() - snapshot[0] >= TTL else "available",
            "reports": snapshot[2] if snapshot else [], "coverage": "Latest available source publications, not incident verification or exhaustive coverage."}
