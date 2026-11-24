"""Allowlisted official publication feeds; shared short cache, no user supplied URLs."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Lock
from math import isfinite
from hashlib import sha256
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
PULSE_CATEGORIES = tuple(SOURCES)
# Optional, user-initiated sanctions publications; not an extra Pulse poll.
SOURCES['sanctions'] = ('UK OFSI', 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation.atom', 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation', {'www.gov.uk'})
TTL = 300
MAX_BYTES = 1024 * 1024
_cache = {}
_retry = {}
_locks = {key: Lock() for key in SOURCES}
_pulse_lock = Lock()

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
            row = {"title": title[:240], "url": link, "published_at_utc": stamp}
            if url.hostname in {"www.gdacs.org", "gdacs.org"}:
                # Only structured natural-hazard alerts receive severity or map points.
                # No inference from headlines, troop positions, or conflict reports.
                level = _text(node, "alertlevel").casefold()
                event_type = _text(node, "eventtype").upper()
                try:
                    lat, lon = map(float, _text(node, "point").split())
                except (ValueError, TypeError):
                    lat = lon = None
                if (level in {"green", "orange", "red"} and event_type in {"EQ", "TC", "FL", "VO", "WF", "DR", "TS"}
                        and lat is not None and lon is not None and isfinite(lat) and isfinite(lon)
                        and -90 <= lat <= 90 and -180 <= lon <= 180):
                    row.update({"severity": "amber" if level == "orange" else level,
                                "hazard_type": event_type, "latitude": lat, "longitude": lon,
                                "country": _text(node, "country")[:120]})
            rows[link] = row
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
    status = ("checking" if _locks[category].locked() and not snapshot else "unavailable") if not snapshot else "stale" if monotonic() - snapshot[0] >= TTL else "available"
    return {"source": name, "source_url": website, "checked_at_utc": snapshot[1] if snapshot else None,
            "status": status,
            "reports": snapshot[2] if snapshot else [], "coverage": "Latest available source publications, not incident verification or exhaustive coverage."}

@router.get("/api/intelligence-pulse", include_in_schema=False)
def pulse():
    """One bounded public summary; concurrent visitors reuse per-source caches."""
    if not _pulse_lock.acquire(blocking=False):
        return {"status": "checking", "feeds": {}}
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(feed, PULSE_CATEGORIES))
        return {"status": "checked", "feeds": dict(zip(PULSE_CATEGORIES, results))}
    finally:
        _pulse_lock.release()

@router.get("/api/incident-alerts", include_in_schema=False)
def incident_alerts():
    """Source-rated natural-hazard alerts; shared GDACS cache, no conflict geolocation."""
    data = feed("humanitarian")
    events = []
    for report in data["reports"]:
        if report.get("severity") not in {"green", "amber", "red"}:
            continue
        events.append({
            **report, "id": sha256(report["url"].encode()).hexdigest()[:24],
            "reported_at_ms": int(datetime.fromisoformat(report["published_at_utc"]).timestamp() * 1000),
            "source": "GDACS",
        })
    return {"events": events, "checked_at_ms": int(datetime.fromisoformat(data["checked_at_utc"]).timestamp()*1000) if data["checked_at_utc"] else None,
            "stale": data["status"] != "available",
            "status": data["status"],
            "coverage": "GDACS natural-hazard alerts only. Severity is the provider's humanitarian-impact alert level. Publication time is not event time."}
