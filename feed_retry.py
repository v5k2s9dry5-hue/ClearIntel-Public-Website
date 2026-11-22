"""Respect upstream retry instructions without exposing provider diagnostics."""
from datetime import timezone
from email.utils import parsedate_to_datetime
from math import ceil, isfinite
from time import time
from urllib.error import HTTPError


def retry_delay(error, now=None):
    default = 30
    if not isinstance(error, HTTPError) or error.code not in (429, 503):
        return default
    raw = error.headers.get('Retry-After', '') if error.headers else ''
    try:
        delay = int(raw)
    except (ValueError, TypeError):
        try:
            date = parsedate_to_datetime(raw)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            delay = date.timestamp() - (time() if now is None else now)
        except (ValueError, TypeError, OverflowError):
            return 60 if error.code == 429 else default
    if not isfinite(delay):
        return default
    return max(default, ceil(delay))
