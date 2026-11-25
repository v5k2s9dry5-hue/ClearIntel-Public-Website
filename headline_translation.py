"""Optional, bounded English translation of public country-news titles only.

Requires a dedicated Azure Translator F0 resource. No general translation
endpoint or user text is sent. Original source records stay intact.
"""
from collections import OrderedDict
from datetime import datetime, timezone
import json
import os
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen

URL = "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=en"
MAX_TITLES = 20
MAX_TITLE_CHARS = 500
MAX_CACHE = 2048
DAILY_LIMIT = 30000
_lock = Lock()
_cache = OrderedDict()
_day = ""
_used = 0
_retry_at = 0.0


def _translate(titles, key, region):
    headers = {"Content-Type": "application/json",
               "Ocp-Apim-Subscription-Key": key}
    if region:
        headers["Ocp-Apim-Subscription-Region"] = region
    req = Request(URL, data=json.dumps([{"Text": title} for title in titles]).encode("utf-8"),
                  headers=headers, method="POST")
    with urlopen(req, timeout=5) as response:
        data = json.loads(response.read(100_000))
    if not isinstance(data, list) or len(data) != len(titles):
        raise ValueError("Invalid translation response")
    translated = {}
    for title, item in zip(titles, data):
        language = item["detectedLanguage"]["language"]
        text = item["translations"][0]["text"]
        if isinstance(language, str) and isinstance(text, str) and text.strip() and len(text) <= 2000:
            translated[title] = (language, text.strip())
    return translated


def translate_country_headlines(payload):
    global _day, _used, _retry_at
    key = os.getenv("AZURE_TRANSLATOR_F0_KEY", "").strip()
    region = os.getenv("AZURE_TRANSLATOR_REGION", "").strip()
    if not key:
        return payload
    articles = [article for group in payload.get("stories", [])
                for article in group.get("reports", [])
                if isinstance(article.get("title"), str) and
                0 < len(article["title"]) <= MAX_TITLE_CHARS and not article.get("editorial")]
    titles = list(dict.fromkeys(article["title"] for article in articles))[:MAX_TITLES]
    if not titles or not _lock.acquire(blocking=False):
        return payload
    try:
        today = datetime.now(timezone.utc).date().isoformat()
        if today != _day:
            _day, _used = today, 0
        missing = [title for title in titles if title not in _cache]
        # UTF-16 units are conservative for quota accounting.
        cost = sum(len(title.encode("utf-16-le")) // 2 for title in missing)
        if missing and _used + cost <= DAILY_LIMIT and monotonic() >= _retry_at:
            _used += cost  # failed calls also consume the local budget
            try:
                _cache.update(_translate(missing, key, region))
            except Exception:
                # Never log provider credentials or replace original headlines.
                _retry_at = monotonic() + 300
            while len(_cache) > MAX_CACHE:
                _cache.popitem(last=False)
        for article in articles:
            result = _cache.get(article["title"])
            if result is None:
                continue
            language, english = result
            _cache.move_to_end(article["title"])
            article["translation_language"] = language
            if language.lower().split("-")[0] != "en" and english != article["title"]:
                article["title_en"] = english
                article["translation_provider"] = "Azure Translator"
    finally:
        _lock.release()
    return payload
