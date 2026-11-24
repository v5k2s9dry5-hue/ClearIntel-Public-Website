"""Read-only verification of the deployed public website; no live provider calls."""
import argparse
from html.parser import HTMLParser
import json
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

DEFAULT_BASE = "https://clearintel-public.onrender.com"
VERIFICATION = "google823498a85ac9e7c0.html"
LIMIT = 2 * 1024 * 1024
SITEMAP_NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class Page(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.canonical = None
        self.links, self.ids = set(), set()
        self.has_directory_link = False
        self.description = None
        self.stylesheets = set()
        self.scripts = set()
        self.noindex = False
        self.feed(body)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href")
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.stylesheets.add(urlsplit(attrs.get("href") or "").path)
        if tag == "script" and attrs.get("src"):
            self.scripts.add(urlsplit(attrs["src"]).path)
        if tag == "meta" and (attrs.get("name") or "").lower() == "description":
            self.description = (attrs.get("content") or "").strip()
        if tag == "a" and attrs.get("href") == "/countries":
            self.has_directory_link = True
        if tag == "a" and (attrs.get("href") or "").startswith("/countries/"):
            self.links.add(attrs["href"])
        if tag == "meta" and attrs.get("name", "").lower() in ("robots", "googlebot"):
            self.noindex |= "noindex" in attrs.get("content", "").lower()


def fetch(url):
    request = Request(url, headers={"User-Agent": "ClearIntel-DeploymentCheck/1.0",
                                    "Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:
        if response.geturl() != url:
            raise ValueError("Unexpected redirect; use the canonical public URL")
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response exceeded inspection limit")
        return response.status, dict(response.headers.items()), body.decode("utf-8")


def check(base, requester=fetch, expected_commit=None):
    if expected_commit is not None:
        if not re.fullmatch(r"[0-9a-fA-F]{40}", expected_commit):
            raise ValueError("Expected commit must be a full 40-character hexadecimal SHA")
        expected_commit = expected_commit.lower()
    base = base.rstrip("/")
    parts = urlsplit(base)
    if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
            or parts.path or parts.query or parts.fragment):
        raise ValueError("Supply an HTTPS public origin without a path or credentials")
    results, bodies, headers = [], {}, {}

    def record(name, condition):
        results.append((name, bool(condition)))

    for path in ("/health", "/api/build", "/", "/robots.txt", "/sitemap.xml", "/countries",
                 "/countries/gb", "/countries/es", "/" + VERIFICATION,
                 "/assets/dashboard-visual.css", "/assets/dashboard-visual.js", "/assets/countries.css"):
        try:
            status, response_headers, body = requester(base + path)
            record(path + " HTTP 200", status == 200)
            if status == 200:
                bodies[path] = body
                headers[path] = {k.lower(): v for k, v in response_headers.items()}
        except (OSError, ValueError) as error:
            record(path + " unavailable (" + type(error).__name__ + ")", False)

    try:
        record("Health JSON", json.loads(bodies.get("/health", "")) == {"status": "ok"})
    except ValueError:
        record("Health JSON", False)

    try:
        build_info = json.loads(bodies.get("/api/build", ""))
    except ValueError:
        build_info = None
    valid_build = isinstance(build_info, dict) and build_info.get("product") == "ClearIntel Atlas"
    current_commit = build_info.get("git_commit") if valid_build else None
    valid_commit = current_commit is None or (
        isinstance(current_commit, str) and re.fullmatch(r"[0-9a-f]{40}", current_commit))
    record("Public build endpoint is minimal and valid",
           valid_build and valid_commit and set(build_info) == {"product", "git_commit"})
    if expected_commit is not None:
        record("Live deployment matches expected Git commit", current_commit == expected_commit)

    home = Page(bodies.get("/", ""))
    directory = Page(bodies.get("/countries", ""))
    record("Homepage links to country directory", home.has_directory_link)
    descriptions = [page.description for page in (home, directory)]
    record("Homepage canonical", home.canonical == base + "/")
    record("Homepage indexable", "/" in bodies and not home.noindex and
           "noindex" not in headers.get("/", {}).get("x-robots-tag", "").lower())
    record("Dashboard navigation and source guide present",
           {"dashboard-query", "dashboard-source-guide", "dashboard-view-controls"}
           <= home.ids)
    record("Redesigned dashboard markup",
           {"map-layer-source", "map-layer-kind", "dashboard-map-heading"} <= home.ids and
           "/assets/dashboard-visual.css" in home.stylesheets and
           "/assets/dashboard-visual.js" in home.scripts)
    record("Redesigned dashboard assets",
           ".map-panel-heading" in bodies.get("/assets/dashboard-visual.css", "") and
           ".result-view-controls" in bodies.get("/assets/dashboard-visual.css", "") and
           "map-layer-source" in bodies.get("/assets/dashboard-visual.js", "") and
           "text/css" in headers.get("/assets/dashboard-visual.css", {}).get("content-type", ""))
    record("Country profile redesign",
           ".country-profile-grid" in bodies.get("/assets/countries.css", "") and
           ".country-related-reports" in bodies.get("/assets/countries.css", "") and
           "/assets/countries.css" in Page(bodies.get("/countries/gb", "")).stylesheets)
    record("Robots advertises sitemap", ("Sitemap: " + base + "/sitemap.xml") in
           bodies.get("/robots.txt", "").splitlines())
    record("Google verification file", bodies.get("/" + VERIFICATION, "").strip() ==
           "google-site-verification: " + VERIFICATION)
    try:
        root = ET.fromstring(bodies.get("/sitemap.xml", ""))
        locations = [node.text for node in root.findall("s:url/s:loc", SITEMAP_NS)]
        expected = {base + "/", base + "/countries"} | {base + path for path in directory.links}
        record("Sitemap matches country directory", bool(directory.links) and
               len(locations) == len(set(locations)) and set(locations) == expected)
    except ET.ParseError:
        record("Sitemap matches country directory", False)

    for path in ("/countries", "/countries/gb", "/countries/es"):
        page = Page(bodies.get(path, ""))
        if path != "/countries":
            descriptions.append(page.description)
            record(path + " linked from directory", path in directory.links)
        record(path + " canonical and indexable", page.canonical == base + path and
               not page.noindex and "noindex" not in headers.get(path, {}).get("x-robots-tag", "").lower())

    record("Sampled public pages have distinct descriptions",
           all(descriptions) and len(set(descriptions)) == len(descriptions))

    homepage_headers = headers.get("/", {})
    record("Public security headers",
           "script-src 'self'" in homepage_headers.get("content-security-policy", "") and
           "frame-ancestors 'none'" in homepage_headers.get("content-security-policy", "") and
           homepage_headers.get("x-content-type-options", "").lower() == "nosniff" and
           homepage_headers.get("strict-transport-security", "").startswith("max-age="))
    record("Public APIs are not cached", headers.get("/api/build", {}).get("cache-control") == "no-store" and headers.get("/health", {}).get("cache-control") == "no-store")
    record("Cross-origin resource embedding restricted", homepage_headers.get("cross-origin-resource-policy") == "same-origin")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", nargs="?", default=DEFAULT_BASE)
    parser.add_argument("--expected-commit", help="Full Git SHA expected in the live deployment")
    args = parser.parse_args()
    try:
        results = check(args.base, expected_commit=args.expected_commit)
    except ValueError as error:
        parser.error(str(error))
    for name, passed in results:
        print(("PASS" if passed else "FAIL") + "  " + name)
    print("Checks deployment identity when --expected-commit is supplied; does not test live provider availability or Google indexing.")
    return 0 if all(passed for _, passed in results) else 1


if __name__ == "__main__":
    sys.exit(main())
