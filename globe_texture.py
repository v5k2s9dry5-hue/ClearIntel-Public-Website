"""Optional, static NASA Earth texture. No user-controlled URLs or tracking."""
import logging
from threading import Lock
from time import monotonic
from urllib.request import Request, build_opener, HTTPRedirectHandler
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()
logger = logging.getLogger("clearintel.artwork")
SOURCE = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg"
MAX_BYTES = 12 * 1024 * 1024
RETRY_SECONDS = 1800
_lock = Lock()
_texture = None
_retry_at = 0.0


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _download(source=SOURCE):
    request = Request(source, headers={"User-Agent": "ClearIntelAtlas/1.0 (https://clearintel-public.onrender.com/; contactclearintel@protonmail.me)", "Accept": "image/jpeg"})
    with build_opener(NoRedirect()).open(request, timeout=8) as response:
        if response.headers.get_content_type() != "image/jpeg":
            raise ValueError("Not a JPEG")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ValueError("Invalid texture")
    return data


@router.get("/globe-texture.jpg", include_in_schema=False)
def texture():
    global _texture, _retry_at
    if _texture is not None:
        return Response(_texture, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    if monotonic() < _retry_at or not _lock.acquire(blocking=False):
        return Response(status_code=503)
    try:
        if _texture is None and monotonic() >= _retry_at:
            try:
                _texture = _download()
            except (OSError, ValueError):
                _retry_at = monotonic() + RETRY_SECONDS
        if _texture is None:
            return Response(status_code=503)
        return Response(_texture, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    finally:
        _lock.release()

# Historical decorative photograph, not a live observation or an event report.
ARCHIVE_SOURCE = "https://upload.wikimedia.org/wikipedia/commons/c/c3/USS_George_Washington_%28CVN-73%29_underway_in_September_2015.JPG"
_archive_lock = Lock()
_archive_photo = None
_archive_retry = 0.0

@router.get("/archive-card.jpg", include_in_schema=False)
def archive_card():
    global _archive_photo, _archive_retry
    if _archive_photo is not None:
        return Response(_archive_photo, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    if monotonic() < _archive_retry or not _archive_lock.acquire(blocking=False):
        return Response(status_code=503)
    try:
        if _archive_photo is None and monotonic() >= _archive_retry:
            try:
                _archive_photo = _download(ARCHIVE_SOURCE)
            except (OSError, ValueError) as error:
                logger.warning("Archive artwork unavailable: %s (HTTP %s)", type(error).__name__, getattr(error, "code", "n/a"))
                _archive_retry = monotonic() + RETRY_SECONDS
        if _archive_photo is None:
            return Response(status_code=503)
        return Response(_archive_photo, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    finally:
        _archive_lock.release()
