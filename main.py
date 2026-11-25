"""Public-only ClearIntel site. Does not import or expose the private ClearIntel OSINT backend."""
from __future__ import annotations

from asyncio import timeout
from collections import OrderedDict, deque
from ipaddress import ip_address
from html import escape
from pathlib import Path
import os
import json
import re
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import HTTPError, URLError
from math import ceil
from time import monotonic, time
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
from starlette.requests import ClientDisconnect
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

from news import _subject
import country_pages
from asset_versions import version_page, cache_policy
from country_news import COUNTRIES, COUNTRY_QUERIES, search_country_news, search_research as search_news
from earthquakes import router as earthquake_router
from wildfires import router as wildfire_router
from globe_texture import router as globe_texture_router
from intelligence_feeds import router as intelligence_feed_router
from country_stats import router as country_stats_router

ROOT = Path(__file__).resolve().parent
PUBLIC_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_URL = PUBLIC_URL or "https://clearintel-public.onrender.com"
HOME_TEMPLATE = version_page((ROOT / "index.html").read_text(encoding="utf-8"))
app = FastAPI(title="ClearIntel public website", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
app.include_router(earthquake_router)
app.include_router(wildfire_router)
app.include_router(globe_texture_router)
app.include_router(intelligence_feed_router)
app.include_router(country_stats_router)
MAX_SEARCH_BODY_BYTES = 2048
SEARCH_CACHE_SECONDS = 20
SEARCH_CACHE_ENTRIES = 128
CLIENT_SEARCHES_PER_MINUTE = 5
CLIENT_SEARCHES_PER_HOUR = 20
SITE_SEARCHES_PER_MINUTE = 60
MAX_ACTIVE_PROVIDER_SEARCHES = 4
_rate_lock = Lock()
_rate: dict[tuple[str, str], deque[float]] = {}
_site_searches: deque[float] = deque()
_search_cache: OrderedDict[tuple[str, str, bool] | tuple[str], tuple[float, dict]] = OrderedDict()
_active_searches = 0
_next_rate_cleanup = 0.0


class Query(BaseModel):
    query: str = Field(min_length=2, max_length=140)
    window: str = Field(default="24h", pattern="^(24h|7d)$")
    incident_only: bool = True


@app.middleware("http")
async def secure_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' mailto:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
    response.headers["Cache-Control"] = cache_policy(
        request.url.path, request.query_params.get("v"), response.status_code)
    if request.url.path == "/globe-texture.jpg" and response.status_code == 200:
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@app.get("/", include_in_schema=False)
async def home():
    return HTMLResponse(HOME_TEMPLATE.replace("{{PUBLIC_HOME}}", escape(PUBLIC_URL + "/")))


@app.get("/google823498a85ac9e7c0.html", include_in_schema=False)
async def google_verification():
    return FileResponse(ROOT / "google823498a85ac9e7c0.html", media_type="text/html")


@app.get("/countries", response_class=HTMLResponse, include_in_schema=False)
async def country_directory():
    return version_page(country_pages.directory(PUBLIC_URL))


@app.get("/countries/{code}", response_class=HTMLResponse, include_in_schema=False)
async def country_profile(code: str):
    if code != code.lower() or code.upper() not in COUNTRIES or not code.isascii():
        raise HTTPException(404, "Unknown country or territory.")
    return version_page(country_pages.profile(PUBLIC_URL, code.upper()))


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get("/api/build", include_in_schema=False)
async def public_build():
    """Read-only public revision marker; never expose environment configuration."""
    commit = os.getenv("RENDER_GIT_COMMIT", "").strip().lower()
    return {
        "product": "ClearIntel Atlas",
        "git_commit": commit if re.fullmatch(r"[0-9a-f]{40}", commit) else None,
    }


async def _search_payload(request: Request) -> Query:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, "Send search requests as JSON.")
    body = bytearray()
    try:
        async with timeout(5):
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_SEARCH_BODY_BYTES:
                    raise HTTPException(413, "Search request is too large.")
                body.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, "Search request took too long to upload.") from None
    except ClientDisconnect:
        raise HTTPException(400, "Search request was interrupted.") from None
    try:
        return Query.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, "Enter a valid search query and time window.") from None


def _rate_limited(detail: str, delay: float) -> HTTPException:
    return HTTPException(429, detail, headers={"Retry-After": str(max(1, ceil(delay)))})


def _client_key(request: Request) -> str | None:
    if request.client is None:
        return None
    try:
        address = ip_address(request.client.host)
    except ValueError:
        return None
    # A private proxy address may represent many visitors. Use the site limit in that case.
    return str(address) if address.is_global else None


def _admit_search(peer: tuple[str, str] | None, key: tuple[str, str, bool] | tuple[str]) -> dict | None:
    global _active_searches, _next_rate_cleanup
    with _rate_lock:
        now = monotonic()
        if now >= _next_rate_cleanup:
            for address in list(_rate):
                if not _rate[address] or _rate[address][-1] <= now - 3600:
                    del _rate[address]
            _next_rate_cleanup = now + 60
        recent = _rate.get(peer, deque()) if peer is not None else deque()
        while recent and recent[0] <= now - 3600:
            recent.popleft()
        if len(recent) >= CLIENT_SEARCHES_PER_HOUR:
            raise _rate_limited("Hourly search limit reached. Try again later.", recent[0] + 3600 - now)
        if len(recent) >= CLIENT_SEARCHES_PER_MINUTE and recent[-CLIENT_SEARCHES_PER_MINUTE] > now - 60:
            raise _rate_limited("Too many searches in a minute. Try again shortly.",
                                recent[-CLIENT_SEARCHES_PER_MINUTE] + 60 - now)

        while _site_searches and _site_searches[0] <= now - 60:
            _site_searches.popleft()
        if len(_site_searches) >= SITE_SEARCHES_PER_MINUTE:
            raise _rate_limited("News search is busy. Try again shortly.", _site_searches[0] + 60 - now)
        cached = _search_cache.get(key)
        if cached is not None and cached[0] <= now:
            del _search_cache[key]
            cached = None
        if cached is None and _active_searches >= MAX_ACTIVE_PROVIDER_SEARCHES:
            raise _rate_limited("News search is busy. Try again shortly.", 5)

        if peer is not None:
            recent.append(now)
            _rate[peer] = recent
        _site_searches.append(now)
        if cached is not None:
            _search_cache.move_to_end(key)
            return cached[1]
        _active_searches += 1
        return None


@app.post("/api/news", include_in_schema=False)
async def news(request: Request):
    payload = await _search_payload(request)
    query = payload.query.strip()
    if len(query) < 2 or any(ord(x) < 32 for x in query):
        raise HTTPException(400, "Enter a valid search with at least two characters.")

    if query not in COUNTRIES and not _subject(query):
        raise HTTPException(400, "Add a location or topic, such as a country or city name.")

    return await _cached_news(
        request, (COUNTRY_QUERIES.get(query.casefold(), query), payload.window, payload.incident_only), SEARCH_CACHE_SECONDS,
        search_news, query, days=1 if payload.window == "24h" else 7,
        incident_only=payload.incident_only,
    )


@app.get("/api/country-news/{code}", include_in_schema=False)
async def country_news(code: str, request: Request):
    if code not in COUNTRIES:
        raise HTTPException(404, "Unknown country or territory.")
    return await _cached_news(request, (code,), 300, search_country_news, code)


async def _cached_news(request, key, cache_seconds, search, *args, **kwargs):
    global _active_searches
    address = _client_key(request)
    route = request.scope["route"].path
    cached = _admit_search((address, route) if address else None, key)
    if cached is not None:
        return cached
    try:
        result = await run_in_threadpool(search, *args, **kwargs)
        if not result["sources_checked"]:
            raise HTTPException(503, "News feeds unavailable (" + "; ".join(result["provider_errors"]) + "). Try again later.")
        with _rate_lock:
            _search_cache[key] = (monotonic() + cache_seconds, result)
            _search_cache.move_to_end(key)
            if len(_search_cache) > SEARCH_CACHE_ENTRIES:
                _search_cache.popitem(last=False)
        return result
    finally:
        with _rate_lock:
            _active_searches -= 1


_iss_lock = Lock()
_iss_cache = {'data': None, 'expires': 0, 'error_expires': 0}
ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544'


def _iss_location() -> dict:
    """Public third-party positional observations; not a satellite imagery feed."""
    try:
        req = UrlRequest(ISS_URL, headers={'User-Agent':'ClearIntel-PublicResearch/1.1'})
        with urlopen(req,timeout=6) as response:
            payload=json.loads(response.read(16_384))
        lat=float(payload['latitude']); lon=float(payload['longitude'])
        timestamp=int(payload['timestamp'])
        if not (-90<=lat<=90 and -180<=lon<=180 and abs(time()-timestamp)<600):
            raise ValueError('Stale or invalid ISS position')
        return {'latitude':round(lat,4),'longitude':round(lon,4),
                'timestamp':timestamp,'object':'ISS (NORAD 25544)',
                'source':'Where the ISS at?'}
    except (HTTPError,URLError,TimeoutError,ValueError,KeyError,TypeError,OverflowError):
        raise ValueError('ISS position provider unavailable') from None


@app.get('/api/iss',include_in_schema=False)
async def iss_position():
    if not _iss_lock.acquire(blocking=False):
        raise HTTPException(503, 'ISS position is refreshing. Try again shortly.', headers={'Retry-After': '2'})
    try:
        now = monotonic()
        if now < _iss_cache['expires']:
            return _iss_cache['data']
        if now >= _iss_cache['error_expires']:
            try:
                data = await run_in_threadpool(_iss_location)
            except ValueError:
                _iss_cache.update(data=None, expires=0, error_expires=monotonic() + 20)
            else:
                _iss_cache.update(data=data, expires=monotonic() + 25, error_expires=0)
                return data
        raise HTTPException(503,'ISS position feed is unavailable. Globe animation is illustrative.')
    finally:
        _iss_lock.release()


@app.get("/robots.txt", include_in_schema=False)
async def robots():
    return PlainTextResponse(f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {PUBLIC_URL}/sitemap.xml\n")


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap():
    paths = ["/", "/countries", *("/countries/" + code.lower() for code in sorted(COUNTRIES))]
    locations = "".join(f"<url><loc>{escape(PUBLIC_URL + path)}</loc></url>" for path in paths)
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{locations}</urlset>', media_type="application/xml")
