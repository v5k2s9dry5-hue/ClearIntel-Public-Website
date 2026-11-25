"""On-demand, bounded World Bank WDI observations; no inferred or live estimates."""
from collections import OrderedDict
from datetime import datetime, timezone
from math import isfinite
from threading import Lock
from time import monotonic
from urllib.request import Request, build_opener
from urllib.error import HTTPError
from urllib.parse import urlencode
import json
import logging
from fastapi import APIRouter, HTTPException
from country_news import COUNTRIES
from intelligence_feeds import NoRedirect

router = APIRouter()
logger = logging.getLogger(__name__)
INDICATORS = {
    "SP.POP.TOTL": "Population",
    "NY.GDP.MKTP.CD": "GDP (current US$)",
    "AG.LND.TOTL.K2": "Land area (km²)",
    "NY.GDP.MKTP.KD.ZG": "GDP growth (annual %)",
    "FP.CPI.TOTL.ZG": "Consumer price inflation (annual %)",
    "NY.GDP.PCAP.CD": "GDP per capita (current US$)",
    "SL.UEM.TOTL.ZS": "Unemployment (% of labour force, ILO modelled estimate)",
    "SP.DYN.LE00.IN": "Life expectancy at birth (years)",
    "IT.NET.USER.ZS": "Internet use (% of population)",
}
TTL = 86400
MAX_BYTES = 256 * 1024
_cache = OrderedDict()
_lock = Lock()
_provider = Lock()

def _valid_observations(data, code):
    if not isinstance(data, list) or len(data) != 2 or not isinstance(data[0], dict) or not isinstance(data[1], list):
        raise ValueError("Invalid indicator response")
    year_now = datetime.now(timezone.utc).year
    for row in data[1]:
        if not isinstance(row, dict) or not isinstance(row.get("country"), dict) or row["country"].get("id") != code:
            continue
        indicator = row.get("indicator")
        if not isinstance(indicator, dict) or indicator.get("id") not in INDICATORS:
            continue
        key = indicator["id"]
        year, value = row.get("date"), row.get("value")
        if not isinstance(year, str) or len(year) != 4 or not year.isascii() or not year.isdigit() or not 1960 <= int(year) <= year_now:
            continue
        if type(value) not in (int, float) or not isfinite(value) or (value < 0 and key not in {"NY.GDP.MKTP.KD.ZG", "FP.CPI.TOTL.ZG"}):
            continue
        if key in {"SL.UEM.TOTL.ZS", "IT.NET.USER.ZS"} and value > 100:
            continue
        if key == "SP.DYN.LE00.IN" and not 0 < value <= 130:
            continue
        yield {"indicator": key, "label": INDICATORS[key], "year": year, "value": value,
               "source_url": "https://data.worldbank.org/indicator/" + key}

def parse_indicators(data, code):
    rows = {}
    for row in _valid_observations(data, code):
        key = row["indicator"]
        if key not in rows or row["year"] > rows[key]["year"]:
            rows[key] = row
    return [rows[key] for key in INDICATORS if key in rows]

def _read_response(code, indicators, params, timeout):
    query = urlencode({"source": 2, "format": "json", **params})
    url = "https://api.worldbank.org/v2/country/" + code + "/indicator/" + ";".join(indicators) + "?" + query
    req = Request(url, headers={"User-Agent":"ClearIntel Atlas public data reader", "Accept":"application/json"})
    with build_opener(NoRedirect()).open(req, timeout=timeout) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Oversized response")
    return json.loads(body)

def _read(code, params, timeout):
    return parse_indicators(_read_response(code, INDICATORS, params, timeout), code)

def _fetch_trend(code, indicator):
    last_year = datetime.now(timezone.utc).year
    first_year = last_year - 9
    response = _read_response(code, (indicator,), {"date": f"{first_year}:{last_year}", "per_page": 10}, 8)
    years = {}
    for row in _valid_observations(response, code):
        year = int(row["year"])
        if row["indicator"] == indicator and first_year <= year <= last_year:
            years.setdefault(year, row)
    return [years[year] for year in sorted(years)]

def _fetch(code):
    try:
        return _read(code, {"mrnev":1,"per_page":30}, 8)
    except HTTPError as exc:
        if exc.code != 400:
            raise
    except ValueError:
        pass
    # A documented date-range query can recover rejected recent-value queries.
    # Do not retry network errors, throttling or blocked redirects.
    year = datetime.now(timezone.utc).year
    return _read(code, {"date":f"{year-9}:{year}","per_page":100}, 3)

def _cached_check(key, fetch):
    with _lock:
        cached = _cache.get(key)
        if cached and monotonic()-cached[0]<TTL:
            return cached[1]
    if not _provider.acquire(blocking=False):
        return {"status":"checking","observations":[]}
    try:
        try:
            rows=fetch()
            data={"status":"available" if rows else "no-data","checked_at_utc":datetime.now(timezone.utc).isoformat(),"observations":rows}
        except (OSError, ValueError, TypeError, OverflowError) as exc:
            logger.warning('World Bank request failed: lookup=%s error=%s http_status=%s', key, type(exc).__name__, getattr(exc, 'code', None))
            if cached and cached[1]["observations"]:
                data={**cached[1],"status":"stale"}
            else:
                data={"status":"unavailable","observations":[]}
        with _lock:
            _cache[key]=(monotonic() if data["status"] in ("available","no-data") else monotonic()-TTL+300,data)
            _cache.move_to_end(key)
            while len(_cache)>256:
                _cache.popitem(last=False)
        return data
    finally:
        _provider.release()


@router.get("/api/country-stats/{code}", include_in_schema=False)
def stats(code: str):
    if code not in COUNTRIES:
        raise HTTPException(404, "Unknown country or territory")
    return _cached_check(code, lambda: _fetch(code))

@router.get("/api/country-trend/{code}/{indicator}", include_in_schema=False)
def trend(code: str, indicator: str):
    if code not in COUNTRIES or indicator not in INDICATORS:
        raise HTTPException(404, "Unknown country, territory or indicator")
    return _cached_check((code, indicator), lambda: _fetch_trend(code, indicator))
