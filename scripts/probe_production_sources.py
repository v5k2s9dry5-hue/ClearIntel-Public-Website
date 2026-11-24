"""Bounded production feed and static texture checks; no secrets or report contents."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

BASE = "https://clearintel-public.onrender.com"
CATEGORIES = ("geopolitical", "cyber", "economic", "humanitarian", "travel")
MAX = 1024 * 1024

def probe(category):
    path = "/api/intelligence-feed/" + category
    try:
        with urlopen(Request(BASE + path, headers={"User-Agent": "ClearIntel-ProductionProbe/1.0"}), timeout=25) as response:
            if response.geturl() != BASE + path or response.status != 200:
                return category, "unexpected response", 0
            data = response.read(MAX + 1)
        if len(data) > MAX:
            return category, "oversized response", 0
        payload = json.loads(data)
        rows = payload.get("reports")
        status = payload.get("status")
        if status not in ("available", "stale", "unavailable") or not isinstance(rows, list):
            return category, "invalid schema", 0
        if status in ("available", "stale"):
            datetime.fromisoformat(payload["checked_at_utc"])
        return category, status, len(rows)
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        return category, type(exc).__name__, 0

def texture(path="/globe-texture.jpg"):
    try:
        with urlopen(Request(BASE + path, headers={"User-Agent": "ClearIntel-ProductionProbe/1.0"}), timeout=25) as response:
            signature = response.read(2)
            valid = response.headers.get_content_type() == "image/jpeg" and signature == b"\xff\xd8"
            return "JPEG received" if valid else "unexpected image response"
    except HTTPError as exc:
        return "HTTP " + str(exc.code)
    except OSError as exc:
        return type(exc).__name__

def summary():
    """Check the actual aggregated dashboard API rather than only individual feeds."""
    try:
        with urlopen(Request(BASE + "/api/intelligence-pulse", headers={"User-Agent": "ClearIntel-ProductionProbe/1.0"}), timeout=35) as response:
            data = response.read(MAX + 1)
        if len(data) > MAX:
            return "oversized response"
        payload = json.loads(data)
        if payload.get("status") == "checking":
            return "another source check in progress"
        feeds = payload.get("feeds", {})
        if set(feeds) != set(CATEGORIES):
            return "incomplete schema"
        return ", ".join(f"{key}={feeds[key].get('status', 'unknown')}" for key in CATEGORIES)
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        return type(exc).__name__

def observation(path, time_field):
    try:
        with urlopen(Request(BASE + path, headers={"User-Agent": "ClearIntel-ProductionProbe/1.0"}), timeout=25) as response:
            data = response.read(MAX + 1)
        if len(data) > MAX:
            return "oversized response"
        payload = json.loads(data)
        rows = payload.get("events")
        stamp = payload.get(time_field)
        if not isinstance(rows, list) or not isinstance(stamp, (int, float)):
            return "invalid schema"
        age = datetime.now(timezone.utc).timestamp() - stamp / 1000
        state = "older snapshot" if payload.get("stale") or age > 300 else "current"
        return f"{state}; {len(rows)} returned observations"
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        return type(exc).__name__

if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=2) as pool:
        for category, status, count in pool.map(probe, CATEGORIES):
            print(f"{category}: {status}; {count} returned records", flush=True)
    print("Aggregate Pulse: " + summary(), flush=True)
    print("GDACS incident alerts: " + observation("/api/incident-alerts", "checked_at_ms"), flush=True)
    print("USGS observations: " + observation("/api/earthquakes", "generated_at_ms"), flush=True)
    print("NASA wildfire observations: " + observation("/api/wildfires", "checked_at_ms"), flush=True)
    print("NASA texture: " + texture(), flush=True)
    print("Archive photograph: " + texture("/archive-card.jpg"), flush=True)
    print("Availability is a point-in-time observation, not a CI pass/fail condition.")
