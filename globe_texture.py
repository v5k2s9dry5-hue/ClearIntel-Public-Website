"""Optional, static NASA Earth texture. No user-controlled URLs or tracking."""
from threading import Lock
from time import monotonic
from urllib.request import Request, build_opener, HTTPRedirectHandler
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()
SOURCE = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg"
MAX_BYTES = 12 * 1024 * 1024
RETRY_SECONDS = 1800
_lock = Lock()
_texture = None
_retry_at = 0.0


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _download():
    request = Request(SOURCE, headers={"User-Agent": "ClearIntel Atlas static Earth imagery", "Accept": "image/jpeg"})
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
        return Response(_texture, media_type="image/jpeg")
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
        return Response(_texture, media_type="image/jpeg")
    finally:
        _lock.release()
