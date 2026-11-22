"""Cached USGS earthquake observations for the public globe."""

from asyncio import Lock
from math import ceil
from feed_retry import retry_delay
import json
from math import isfinite
import re
from time import monotonic, time
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'
MAX_FEED_BYTES = 1_000_000
DAY_MS = 86_400_000
STALE_MS = 5 * 60 * 1000
router = APIRouter()
_refresh_lock = Lock()
_snapshot = None
_retry_at = 0.0
_unavailable = False


def _number(value):
    return type(value) is int or (type(value) is float and isfinite(value))


def _parse_feed(payload, now_ms):
    if not isinstance(payload, dict) or payload.get('type') != 'FeatureCollection':
        raise ValueError('Invalid feed')
    features, metadata = payload.get('features'), payload.get('metadata')
    if not isinstance(features, list) or not isinstance(metadata, dict):
        raise ValueError('Invalid feed')
    generated = metadata.get('generated')
    if type(generated) is not int or not 0 < generated <= now_ms + 60_000:
        raise ValueError('Invalid feed timestamp')

    events = {}
    for feature in features:
        if not isinstance(feature, dict):
            continue
        event_id = feature.get('id')
        props, geometry = feature.get('properties'), feature.get('geometry')
        if not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', event_id):
            continue
        if not isinstance(props, dict) or props.get('type') != 'earthquake':
            continue
        if not isinstance(geometry, dict) or geometry.get('type') != 'Point':
            continue
        coords = geometry.get('coordinates')
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        lon, lat = coords[:2]
        magnitude, occurred = props.get('mag'), props.get('time')
        if not (_number(lon) and _number(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        if not _number(magnitude) or not 4.5 <= magnitude <= 10:
            continue
        if type(occurred) is not int or not now_ms - 7 * DAY_MS <= occurred <= now_ms:
            continue
        place = props.get('place')
        events[event_id] = {
            'id': event_id,
            'place': place.strip()[:180] if isinstance(place, str) and place.strip() else 'Location unnamed by USGS',
            'latitude': lat,
            'longitude': lon,
            'magnitude': magnitude,
            'occurred_at_ms': occurred,
            'url': f'https://earthquake.usgs.gov/earthquakes/eventpage/{event_id}',
        }
    return {'generated_at_ms': generated, 'events': sorted(
        events.values(), key=lambda event: event['occurred_at_ms'], reverse=True,
    )[:250]}


def _fetch_feed():
    request = Request(FEED_URL, headers={'User-Agent': 'ClearIntel-PublicResearch/1.3'})
    with urlopen(request, timeout=7) as response:
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise ValueError('Feed exceeds size limit')
    return _parse_feed(json.loads(body), int(time() * 1000))


@router.get('/api/earthquakes', include_in_schema=False)
async def earthquake_feed():
    global _snapshot, _retry_at, _unavailable
    if monotonic() >= _retry_at and not _refresh_lock.locked():
        async with _refresh_lock:
            try:
                latest = await run_in_threadpool(_fetch_feed)
                if _snapshot and latest['generated_at_ms'] < _snapshot['generated_at_ms']:
                    raise ValueError('Feed timestamp went backwards')
                _snapshot = latest
            except (OSError, ValueError) as error:
                _unavailable = True
                _retry_at = monotonic() + retry_delay(error)
            else:
                _unavailable = False
                _retry_at = monotonic() + 60
    if _snapshot is None:
        raise HTTPException(503, 'USGS earthquake feed is unavailable.', headers={'Retry-After': str(max(1, ceil(_retry_at - monotonic()))) if _retry_at else '2'})
    now_ms = int(time() * 1000)
    events = [event for event in _snapshot['events'] if event['occurred_at_ms'] >= now_ms - 7 * DAY_MS]
    return {**_snapshot, 'events': events,
            'stale': _unavailable or now_ms - _snapshot['generated_at_ms'] > STALE_MS}
