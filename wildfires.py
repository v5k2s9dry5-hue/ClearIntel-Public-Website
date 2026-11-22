"""Recent wildfire observations from NASA's Earth Observatory Natural Event Tracker."""

from asyncio import Lock
from math import ceil
from feed_retry import retry_delay
from datetime import datetime
import json
import re
from time import monotonic, time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

FEED_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=all&days=7'
MAX_FEED_BYTES = 1_000_000
WEEK_MS = 7 * 86_400_000
router = APIRouter()
_refresh_lock = Lock()
_snapshot = None
_retry_at = 0.0
_unavailable = False


def _observation(geometry, cutoff, now):
    if not isinstance(geometry, dict) or geometry.get('type') != 'Point':
        return None
    coords = geometry.get('coordinates')
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    lon, lat = coords[:2]
    if not (type(lon) in (int, float) and type(lat) in (int, float)
            and -180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    try:
        date = datetime.fromisoformat(geometry.get('date', ''))
        if date.tzinfo is None:
            return None
        observed = int(date.timestamp() * 1000)
    except (ValueError, TypeError, OverflowError):
        return None
    return (observed, lon, lat) if cutoff <= observed <= now else None


def _report_link(sources, event_id):
    if isinstance(sources, list):
        for source in sources:
            if not isinstance(source, dict) or not isinstance(source.get('url'), str):
                continue
            url = source['url']
            if len(url) > 2048 or re.search(r'[\x00-\x20\x7f\\]', url):
                continue
            try:
                parsed = urlsplit(url)
                if parsed.scheme == 'https' and parsed.hostname and parsed.username is None:
                    name = source.get('id')
                    return url, name.strip()[:60] if isinstance(name, str) and name.strip() else 'original source'
            except ValueError:
                continue
    return f'https://eonet.gsfc.nasa.gov/api/v3/events/{event_id}', 'NASA EONET'


def _parse_feed(payload, now):
    if not isinstance(payload, dict) or not isinstance(payload.get('events'), list):
        raise ValueError('Invalid EONET feed')
    events = {}
    for event in payload['events']:
        if not isinstance(event, dict):
            continue
        event_id, title, geometry = event.get('id'), event.get('title'), event.get('geometry')
        categories = event.get('categories')
        if not isinstance(event_id, str) or not re.fullmatch(r'EONET_\d{1,16}', event_id):
            continue
        if not isinstance(title, str) or not title.strip() or not isinstance(geometry, list):
            continue
        if not isinstance(categories, list) or not any(
            isinstance(category, dict) and category.get('id') == 'wildfires' for category in categories
        ):
            continue
        observations = (_observation(point, now - WEEK_MS, now) for point in geometry)
        latest = max((point for point in observations if point is not None), default=None, key=lambda point: point[0])
        if latest is None or (event_id in events and events[event_id]['observed_at_ms'] >= latest[0]):
            continue
        observed, lon, lat = latest
        url, source = _report_link(event.get('sources'), event_id)
        events[event_id] = {
            'id': event_id, 'title': title.strip()[:180], 'latitude': lat, 'longitude': lon,
            'observed_at_ms': observed, 'closed': bool(event.get('closed')), 'url': url, 'source': source,
        }
    return {'checked_at_ms': now, 'events': sorted(
        events.values(), key=lambda event: event['observed_at_ms'], reverse=True,
    )[:250]}


def _fetch_feed():
    request = Request(FEED_URL, headers={'User-Agent': 'ClearIntel-PublicResearch/1.3'})
    with urlopen(request, timeout=7) as response:
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise ValueError('Feed exceeds size limit')
    return _parse_feed(json.loads(body), int(time() * 1000))


@router.get('/api/wildfires', include_in_schema=False)
async def wildfire_feed():
    global _snapshot, _retry_at, _unavailable
    if monotonic() >= _retry_at and not _refresh_lock.locked():
        async with _refresh_lock:
            try:
                _snapshot = await run_in_threadpool(_fetch_feed)
            except (OSError, ValueError) as error:
                _unavailable = True
                _retry_at = monotonic() + retry_delay(error)
            else:
                _unavailable = False
                _retry_at = monotonic() + 120
    if _snapshot is None:
        raise HTTPException(503, 'NASA EONET wildfire feed is unavailable.', headers={'Retry-After': str(max(1, ceil(_retry_at - monotonic()))) if _retry_at else '2'})
    now = int(time() * 1000)
    events = [event for event in _snapshot['events'] if event['observed_at_ms'] >= now - WEEK_MS]
    return {**_snapshot, 'events': events,
            'stale': _unavailable or now - _snapshot['checked_at_ms'] > 300_000}
