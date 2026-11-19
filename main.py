"""Public-only ClearIntel site. Does not import or expose the private ClearIntel OSINT backend."""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import json
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import HTTPError, URLError
from time import time
from threading import Lock
from urllib.parse import urljoin

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from news import search_news

ROOT = Path(__file__).resolve().parent
PUBLIC_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
app = FastAPI(title="ClearIntel public website", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
_rate_lock = Lock()
_rate = defaultdict(deque)


class Query(BaseModel):
    query: str = Field(min_length=3, max_length=140)
    window: str = Field(default="24h", pattern="^(24h|7d)$")
    incident_only: bool = True


@app.middleware("http")
async def secure_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' mailto:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith('/api/') else "public, max-age=300"
    return response


@app.get("/", include_in_schema=False)
async def home():
    return FileResponse(ROOT / "index.html", media_type="text/html")


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.post("/api/news", include_in_schema=False)
async def news(request: Request, payload: Query):
    query = payload.query.strip()
    if len(query) < 3 or any(ord(x) < 32 for x in query):
        raise HTTPException(400, "Enter a valid search with at least three characters.")
    # Limit anonymous searches. No raw user input is passed to shell commands.
    # Cloud proxy IP handling should be configured at the deployment boundary.
    peer = request.client.host if request.client else "unknown"
    current = datetime.now(timezone.utc)
    with _rate_lock:
        q = _rate[peer]
        while q and q[0] < current - timedelta(hours=1):
            q.popleft()
        if len(q) >= 20:
            raise HTTPException(429, "Search limit reached. Try again later.")
        q.append(current)
        if len(_rate) > 5000:
            for key in list(_rate)[:1000]:
                if not _rate[key] or _rate[key][-1] < current - timedelta(hours=1):
                    _rate.pop(key, None)
    result = await run_in_threadpool(search_news, query,
                                     days=1 if payload.window == "24h" else 7,
                                     incident_only=payload.incident_only)
    if not result["sources_checked"]:
        raise HTTPException(503, "News feeds unavailable (" + "; ".join(result["provider_errors"]) + "). Try again later. No results were fabricated.")
    return result


_iss_lock = Lock()
_iss_cache = {'data': None, 'expires': 0, 'error_expires': 0}
ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544'


def _iss_location() -> dict:
    """Public third-party positional observations; not a satellite imagery feed."""
    now = time()
    with _iss_lock:
        if _iss_cache['data'] and now < _iss_cache['expires']:
            return _iss_cache['data']
        if now < _iss_cache['error_expires']:
            raise ValueError('Feed temporarily unavailable')
        try:
            req = UrlRequest(ISS_URL, headers={'User-Agent':'ClearIntel-PublicResearch/1.1'})
            with urlopen(req,timeout=6) as response:
                payload=json.loads(response.read(16_384))
            lat=float(payload['latitude']); lon=float(payload['longitude'])
            timestamp=int(payload['timestamp'])
            if not (-90<=lat<=90 and -180<=lon<=180 and abs(now-timestamp)<600):
                raise ValueError('Stale or invalid ISS position')
            data={'latitude':round(lat,4),'longitude':round(lon,4),
                  'timestamp':timestamp,'object':'ISS (NORAD 25544)',
                  'source':'Where the ISS at?'}
            _iss_cache.update(data=data,expires=now+25,error_expires=0)
            return data
        except (HTTPError,URLError,TimeoutError,ValueError,KeyError,TypeError,OverflowError):
            _iss_cache.update(data=None,expires=0,error_expires=now+20)
            raise ValueError('ISS position provider unavailable')


@app.get('/api/iss',include_in_schema=False)
async def iss_position():
    try:
        return await run_in_threadpool(_iss_location)
    except ValueError:
        raise HTTPException(503,'ISS position feed is unavailable. Globe animation is illustrative.')


@app.get("/robots.txt", include_in_schema=False)
async def robots(request: Request):
    base = PUBLIC_URL or str(request.base_url).rstrip("/")
    return PlainTextResponse(f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {base}/sitemap.xml\n")


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap(request: Request):
    base = PUBLIC_URL or str(request.base_url).rstrip("/")
    from html import escape
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{escape(base, quote=True)}/</loc></url></urlset>', media_type="application/xml")
