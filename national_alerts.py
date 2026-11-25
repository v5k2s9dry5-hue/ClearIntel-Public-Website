"""On-demand official civil weather and flood warnings, not a safety-critical service."""
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from urllib.request import Request, build_opener
from urllib.parse import quote
import json
from fastapi import APIRouter, HTTPException
from intelligence_feeds import NoRedirect

router = APIRouter()
SOURCES = {
    "england": ("Environment Agency", "https://environment.data.gov.uk/flood-monitoring/id/floods?min-severity=3", "https://check-for-flooding.service.gov.uk/", "England flood warnings"),
    "us": ("US National Weather Service", "https://api.weather.gov/alerts/active", "https://www.weather.gov/", "US weather alerts"),
}
TTL = 300
MAX_BYTES = 8 * 1024 * 1024
MAX_ROWS = 100
_cache = {}
_retry = {}
_locks = {key: Lock() for key in SOURCES}


def stamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except (AttributeError, ValueError, TypeError, OverflowError):
        return None


def text(value, limit=500):
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse_alerts(code, payload, now=None):
    now = now or datetime.now(timezone.utc)
    raw = payload.get("items" if code == "england" else "features")
    if not isinstance(raw, list):
        raise ValueError("Invalid warning feed")
    rows = {}
    recognized = 0
    for item in raw:
        if not isinstance(item, dict):
            continue
        if code == "england":
            level = item.get("severityLevel")
            if type(level) is not int or level not in (1, 2, 3, 4):
                continue
            recognized += 1
            if level == 4:
                continue
            ident = text(item.get("floodAreaID"), 100)
            area = text(item.get("description"))
            severity = {1: "Severe Flood Warning", 2: "Flood Warning", 3: "Flood Alert"}[level]
            issued = stamp(item.get("timeRaised"))
            if not ident or not area or not issued:
                continue
            rows[ident] = {"title": severity, "severity": severity, "area": area,
                           "time_utc": issued, "time_basis": "Last reviewed",
                           "expires_utc": None,
                           "url": "https://environment.data.gov.uk/flood-monitoring/id/floods/" + quote(ident, safe="")}
        else:
            p = item.get("properties")
            if not isinstance(p, dict) or p.get("status") not in ("Actual", "Exercise", "System", "Test", "Draft"):
                continue
            recognized += 1
            if p.get("status") != "Actual" or p.get("messageType") not in ("Alert", "Update"):
                continue
            issued, expires = stamp(p.get("sent")), stamp(p.get("expires"))
            if not issued or not expires or datetime.fromisoformat(expires) <= now:
                continue
            ident = text(p.get("id"), 300)
            title = text(p.get("event"))
            area = text(p.get("areaDesc"))
            if not ident or not title or not area:
                continue
            rows[ident] = {"title": title, "severity": text(p.get("severity"), 50) or "Unknown",
                           "area": area, "time_utc": issued, "time_basis": "Issued",
                           "expires_utc": expires,
                           "url": "https://api.weather.gov/alerts/" + quote(ident, safe="")}
    if raw and not recognized:
        raise ValueError("Unrecognized warning feed")
    # Never represent a partially parsed feed as a comprehensive active count.
    return sorted(rows.values(), key=lambda row: row["time_utc"], reverse=True)


def download(url):
    req = Request(url, headers={"User-Agent": "ClearIntel Atlas (contactclearintel@protonmail.me)",
                                "Accept": "application/geo+json, application/json"})
    with build_opener(NoRedirect()).open(req, timeout=8) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Warning feed exceeds response limit")
    return json.loads(data)


@router.get("/api/national-alerts/{code}", include_in_schema=False)
def alerts(code: str):
    if code not in SOURCES:
        raise HTTPException(404, "Unknown warning source")
    name, url, website, scope = SOURCES[code]
    now = monotonic()
    snapshot = _cache.get(code)
    if (not snapshot or now - snapshot[0] >= TTL) and now >= _retry.get(code, 0) and _locks[code].acquire(blocking=False):
        try:
            snapshot = _cache.get(code)
            if (not snapshot or monotonic() - snapshot[0] >= TTL) and monotonic() >= _retry.get(code, 0):
                try:
                    rows = parse_alerts(code, download(url))
                    _cache[code] = (monotonic(), datetime.now(timezone.utc).isoformat(), rows)
                    _retry.pop(code, None)
                except (OSError, ValueError, TypeError, AttributeError):
                    _retry[code] = monotonic() + TTL
        finally:
            _locks[code].release()
    snapshot = _cache.get(code)
    status = ("checking" if _locks[code].locked() else "unavailable") if not snapshot else "stale" if monotonic() - snapshot[0] >= TTL else "available"
    rows = snapshot[2] if snapshot else []
    return {"source": name, "source_url": website, "scope": scope, "status": status,
            "checked_at_utc": snapshot[1] if snapshot else None,
            "returned_count": len(rows), "alerts": rows[:MAX_ROWS],
            "coverage": "Selected parsed public warnings only; not comprehensive or a substitute for official safety instructions."}
