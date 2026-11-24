"""On-demand, bounded World Bank WDI observations; no inferred or live estimates."""
from collections import OrderedDict
from datetime import datetime, timezone
from math import isfinite
from threading import Lock
from time import monotonic
from urllib.request import Request, build_opener
from urllib.parse import urlencode
import json
from fastapi import APIRouter, HTTPException
from country_news import COUNTRIES
from intelligence_feeds import NoRedirect

router = APIRouter()
INDICATORS = {
    "SP.POP.TOTL": "Population",
    "NY.GDP.MKTP.CD": "GDP (current US$)",
    "AG.LND.TOTL.K2": "Land area (km²)",
}
TTL = 86400
MAX_BYTES = 256 * 1024
_cache = OrderedDict()
_lock = Lock()
_provider = Lock()

def parse_indicators(data, code):
    if not isinstance(data, list) or len(data) != 2 or not isinstance(data[0], dict) or not isinstance(data[1], list):
        raise ValueError("Invalid indicator response")
    rows = {}
    for row in data[1]:
        if not isinstance(row, dict) or not isinstance(row.get("country"), dict) or row["country"].get("id") != code:
            continue
        indicator = row.get("indicator")
        if not isinstance(indicator, dict) or indicator.get("id") not in INDICATORS:
            continue
        key = indicator["id"]
        year, value = row.get("date"), row.get("value")
        if not isinstance(year, str) or len(year) != 4 or not year.isascii() or not year.isdigit() or not 1960 <= int(year) <= datetime.now(timezone.utc).year:
            continue
        if type(value) not in (int, float) or not isfinite(value) or value < 0:
            continue
        if key not in rows or year > rows[key]["year"]:
            rows[key] = {"indicator":key,"label":INDICATORS[key],"year":year,"value":value,
                         "source_url":"https://data.worldbank.org/indicator/"+key}
    return [rows[k] for k in INDICATORS if k in rows]

def _fetch(code):
    query = urlencode({"source":2,"format":"json","mrnev":1,"per_page":30})
    url = "https://api.worldbank.org/v2/country/"+code+"/indicator/"+";".join(INDICATORS)+"?"+query
    req = Request(url, headers={"User-Agent":"ClearIntel Atlas public data reader", "Accept":"application/json"})
    with build_opener(NoRedirect()).open(req, timeout=8) as response:
        body = response.read(MAX_BYTES+1)
    if len(body)>MAX_BYTES:
        raise ValueError("Oversized response")
    return parse_indicators(json.loads(body),code)

@router.get("/api/country-stats/{code}",include_in_schema=False)
def stats(code: str):
    if code not in COUNTRIES:
        raise HTTPException(404,"Unknown country or territory")
    with _lock:
        cached = _cache.get(code)
        if cached and monotonic()-cached[0]<TTL:
            return cached[1]
    if not _provider.acquire(blocking=False):
        return {"status":"checking","observations":[]}
    try:
        try:
            rows=_fetch(code)
            data={"status":"available" if rows else "no-data","checked_at_utc":datetime.now(timezone.utc).isoformat(),"observations":rows}
        except (OSError, ValueError, TypeError, OverflowError):
            if cached and cached[1]["observations"]:
                data={**cached[1],"status":"stale"}
            else:
                data={"status":"unavailable","observations":[]}
        with _lock:
            _cache[code]=(monotonic() if data["status"] in ("available","no-data") else monotonic()-TTL+300,data)
            _cache.move_to_end(code)
            while len(_cache)>256:
                _cache.popitem(last=False)
        return data
    finally:
        _provider.release()
