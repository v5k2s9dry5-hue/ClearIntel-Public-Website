"""Version local page assets by content, independently of deployment timestamps."""
from hashlib import sha256
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
ASSET_VERSIONS = {
    "/assets/" + path.name: sha256(path.read_bytes()).hexdigest()[:16]
    for path in (ROOT / "assets").iterdir()
    if path.is_file() and path.suffix in {".js", ".css", ".svg"}
}
REFERENCE = re.compile(r'((?:src|href)=")(/assets/[A-Za-z0-9_.-]+)(?:\?v=[A-Za-z0-9_.-]+)?(")')


def version_page(html: str) -> str:
    def replace(match):
        prefix, path, suffix = match.groups()
        version = ASSET_VERSIONS.get(path)
        return prefix + path + "?v=" + version + suffix if version else match.group(0)
    return REFERENCE.sub(replace, html)


def cache_policy(path: str, version: str | None, status: int) -> str:
    if path.startswith("/api/") or path == "/health" or status >= 400:
        return "no-store"
    if path.startswith("/assets/"):
        if version and version == ASSET_VERSIONS.get(path):
            return "public, max-age=86400"
        return "public, max-age=300, must-revalidate"
    return "no-cache"
