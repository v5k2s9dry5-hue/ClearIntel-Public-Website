"""Browser smoke test for mobile and desktop public-site research workflows.

Run against the local FastAPI service. External news providers are mocked:
this checks UI behaviour without depending on unstable third-party feeds.
"""
import json
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = "http://127.0.0.1:8000"
STAMP = "2026-11-21T12:00:00+00:00"
COUNTRY = {
    "country": "United Kingdom",
    "checked_at_utc": STAMP,
    "publisher_count": 2,
    "sources_checked": ["Fixture publisher"],
    "provider_errors": [],
    "edition_url": "https://news.google.com/",
    "basis": "national",
    "stories": [{
        "basis": "national",
        "reports": [{
            "title": "Manchester council announces railway improvements",
            "source": "Fixture publisher",
            "url": "https://example.org/manchester-news",
            "feed_time_utc": STAMP,
            "time_basis": "Publication time",
            "editorial": False,
        }],
    }],
    "city_mentions": [{
        "city": "Manchester",
        "longitude": -2.2426,
        "latitude": 53.4808,
        "headline": "Manchester council announces railway improvements",
        "source": "Fixture publisher",
        "url": "https://example.org/manchester-news",
        "feed_time_utc": STAMP,
        "label": "Headline mentions city",
    }],
}
NEWS = {
    "results": [{
        "title": "UK transport news update",
        "source": "Fixture publisher",
        "url": "https://example.org/transport-update",
        "provider": "Fixture",
        "time_basis": "Publication time",
        "feed_time_utc": STAMP,
        "incident_time_utc": None,
    }],
    "provider_errors": [],
    "sources_checked": ["Fixture provider"],
    "notice": "Headlines are leads, not verified events.",
    "window_start": "2026-11-20T12:00:00+00:00",
    "window_end": STAMP,
}


def wait_for_local_server():
    for _ in range(60):
        try:
            with urlopen(ROOT + "/health", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.5)
    raise AssertionError("Local website failed to start")


def route_json(route, data):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps(data))


def check_site(browser, width):
    mobile = width <= 760
    context = browser.new_context(
        viewport={"width": width, "height": 850},
        device_scale_factor=1,
        accept_downloads=True,
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/api/country-news/GB", lambda route: route_json(route, COUNTRY))
    page.route("**/api/news", lambda route: route_json(route, NEWS))
    page.goto(ROOT, wait_until="domcontentloaded")
    page.locator("#research").scroll_into_view_if_needed()
    page.locator(".field-head .help-button").click()
    tip = page.locator("#help-panel-1")
    tip.wait_for(state="visible")
    bounds = tip.bounding_box()
    assert bounds is not None and bounds["x"] >= 0, (width, bounds)
    assert bounds["x"] + bounds["width"] <= width + 1, (width, bounds)
    if mobile:
        field = page.locator("#news-query").bounding_box()
        assert field is not None
        assert bounds["y"] + bounds["height"] <= field["y"] + 1, (
            "Help obscures the search input", bounds, field)
    page.locator("#news-query").fill("UK")
    page.locator("#news-submit").click()
    page.locator("#news-results .result-title").wait_for()
    assert page.locator("#news-results .result-title").inner_text() == NEWS["results"][0]["title"]
    page.locator("#search-country .country-top-stories li").wait_for()
    assert page.locator("#search-country .country-city-note").is_visible()

    with page.expect_download(timeout=30000) as download:
        page.locator("#news-results .report-export button").filter(has_text="Download PDF").click()
    assert download.value.suggested_filename.endswith(".pdf")

    page.locator("#globe-layer").select_option("countries")
    if mobile:
        page.locator("#dashboard-feed-tab").click()
    page.wait_for_function(
        "() => [...document.querySelector('#country-select').options].some(x => x.value === 'GB')")
    page.locator("#country-select").select_option("GB")
    page.locator("#quake-detail .country-city-note").wait_for(timeout=15000)
    assert "not verified incident positions" in page.locator("#quake-detail .country-city-note").inner_text()
    assert not errors, "Browser JS errors: " + "; ".join(errors)
    print(("Mobile" if mobile else "Desktop") + " research, globe, PDF, and tooltip checks passed")
    context.close()


if __name__ == "__main__":
    wait_for_local_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for size in (390, 1280):
                check_site(browser, size)
        finally:
            browser.close()
