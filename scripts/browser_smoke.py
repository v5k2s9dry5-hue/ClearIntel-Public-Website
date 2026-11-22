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
    "provider_errors": ["gdelt: timeout"],
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
    toggle = page.locator("#sidebar-toggle")
    if width > 1080:
        toggle.click()
        assert toggle.get_attribute("aria-expanded") == "false"
        assert not page.locator("#dashboard-sidebar").is_visible()
        page.reload(wait_until="domcontentloaded")
        page.get_by_role("button", name="Show sidebar").click()
        assert page.locator("#dashboard-sidebar").is_visible()
    else:
        assert not toggle.is_visible()
    if mobile:
        def swipe(selector, dx, dy):
            target = page.locator(selector)
            pointer = {"pointerType": "touch", "pointerId": 8, "isPrimary": True}
            target.dispatch_event("pointerdown", {**pointer, "clientX": 160, "clientY": 200})
            target.dispatch_event("pointerup", {**pointer, "clientX": 160 + dx, "clientY": 200 + dy})
        swipe(".dashboard-map-footer", -20, 90)
        assert page.locator("#dashboard-map").is_visible()
        swipe(".dashboard-map-footer", -95, 4)
        assert page.locator("#dashboard-feed").is_visible()
        swipe("#dashboard-feed-heading", 95, 4)
        assert page.locator("#dashboard-map").is_visible()
    guide = page.locator("#dashboard-source-guide")
    assert not guide.locator("dl").is_visible()
    guide.locator("summary").click()
    assert guide.get_by_text("not live tracking", exact=False).is_visible()
    assert guide.get_by_role("link", name="NASA EONET").is_visible()
    guide.locator("summary").click()
    assert not guide.locator("dl").is_visible()
    query = page.locator("#dashboard-query")
    if mobile:
        page.locator("#dashboard-search-tab").click()
        assert query.evaluate("(field) => field === document.activeElement")
    query.fill("UK")
    query.press("Enter")
    profile_link = page.locator("#dashboard-matches").get_by_role("link", name="United Kingdom · Country profile")
    profile_link.wait_for()
    assert profile_link.get_attribute("href") == "/countries/gb"
    query.fill("UKMTO")
    query.press("Enter")
    page.locator("#dashboard-matches").get_by_role("button", name="Naval activity · Historical map layer").click()
    assert page.locator("#ukmto-bulletins").get_by_role("link", name="Official advisories").is_visible()
    page.locator("#globe-layer").select_option("earthquakes")
    assert not page.locator("#ukmto-bulletins").is_visible()
    query.fill("rail services")
    query.press("Enter")
    page.locator("#dashboard-matches").get_by_role("button", name="Search recent headlines", exact=False).click()
    page.locator("#news-results .result-title").wait_for()
    assert page.locator("#news-query").input_value() == "rail services"
    if mobile:
        page.locator("#dashboard-map-tab").click()
    page.locator("#map-expand").click()
    assert page.get_by_role("dialog", name="Expanded map").is_visible()
    page.locator("#earth-zoom-in").click()
    page.keyboard.press("Escape")
    page.locator("#expanded-map").wait_for(state="hidden")
    page.wait_for_function("() => document.querySelector('#map-expand') === document.activeElement")
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
    assert page.locator("#search-country").get_by_text("Partial source coverage", exact=False).is_visible()
    coverage = page.locator("#search-country .country-coverage-details")
    assert not coverage.locator("ul").first.is_visible()
    coverage.locator("summary").click()
    assert coverage.get_by_text("Gdelt — timeout").is_visible()
    assert coverage.get_by_text("Fixture publisher — check completed").is_visible()
    coverage.locator("summary").click()

    mode = page.locator("#analyst-mode-toggle")
    assert mode.get_attribute("aria-pressed") == "false"
    assert not page.locator("#search-country .analyst-metadata").first.is_visible()
    mode.click()
    assert mode.get_attribute("aria-pressed") == "true"
    assert page.locator("#search-country .analyst-metadata").first.is_visible()
    assert coverage.locator("ul").first.is_visible()
    assert page.locator("#news-results").get_by_text("Requested UTC window:", exact=False).is_visible()
    mode.click()
    assert not page.locator("#search-country .analyst-metadata").first.is_visible()
    assert not coverage.locator("ul").first.is_visible()

    with page.expect_download(timeout=30000) as download:
        page.locator("#news-results .report-export button").filter(has_text="Download PDF").click()
    assert download.value.suggested_filename.endswith(".pdf")

    page.route("**/api/news", lambda route: route.fulfill(
        status=429, headers={"Retry-After": "19"}, content_type="application/json", body="{}"))
    page.locator("#news-submit").click()
    page.get_by_text("Try again in 19 seconds.").wait_for()
    assert page.get_by_text("Filtered search is rate limited").is_visible()
    page.locator("#search-country .country-top-stories li").wait_for()

    page.locator("#globe-layer").select_option("countries")
    if mobile:
        page.locator("#dashboard-feed-tab").click()
    page.wait_for_function(
        "() => [...document.querySelector('#country-select').options].some(x => x.value === 'GB')")
    page.locator("#country-select").select_option("GB")
    page.locator("#quake-detail .country-city-note").wait_for(timeout=15000)
    assert "not verified incident positions" in page.locator("#quake-detail .country-city-note").inner_text()
    page.locator("#quake-detail").get_by_role("link", name="Open country profile").click()
    page.wait_for_url("**/countries/gb")
    page.locator("#country-brief .country-top-stories li").wait_for()
    assert page.get_by_role("heading", name="United Kingdom").is_visible()
    # A complete outage retains prior headlines, but a successful empty search does not.
    page.evaluate("""previous => {
        const outage = {...previous, stories: [], sources_checked: [], provider_errors: ['gdelt: timeout']};
        const retained = countryRefreshResult(previous, outage);
        if (!retained.failed || retained.data !== previous) throw Error('Previous headline snapshot lost');
        const empty = {...outage, sources_checked: ['fixture'], provider_errors: []};
        const success = countryRefreshResult(previous, empty);
        if (success.failed || success.data.stories.length) throw Error('Successful empty result was replaced');
    }""", COUNTRY)
    mode = page.locator("#analyst-mode-toggle")
    mode.click()
    assert page.locator("#country-brief .analyst-metadata").first.is_visible()
    page.reload(wait_until="domcontentloaded")
    page.locator("#country-brief .country-top-stories li").wait_for()
    assert mode.get_attribute("aria-pressed") == "true"
    assert page.locator("#country-brief .country-coverage-details ul").first.is_visible()
    mode.click()
    assert not page.locator("#country-brief .analyst-metadata").first.is_visible()
    page.locator("#country-brief .country-coverage-details summary").click()
    assert page.locator("#country-brief").get_by_text("Gdelt — timeout").is_visible()
    # Exercise the retained snapshot and weekly fallback without calling live providers.
    page.evaluate("""data => {
        data.stories[0].basis = 'weekly';
        renderCountryCard(document.querySelector('#country-brief'),
            {id: 'GB', place: 'United Kingdom'}, {data, failed: true});
    }""", COUNTRY)
    assert page.locator("#country-brief").get_by_text("Last available snapshot", exact=False).is_visible()
    assert page.locator("#country-brief").get_by_text("Older coverage: past week", exact=False).is_visible()
    assert page.locator("#country-brief").get_by_text("Gdelt — timeout").is_visible()
    page.get_by_role("link", name="Country directory").click()
    page.get_by_role("link", name="Netherlands", exact=True).wait_for()
    page.get_by_label("Find a country or territory").fill("UK")
    assert page.get_by_role("link", name="United Kingdom", exact=True).is_visible()
    assert not page.get_by_role("link", name="Netherlands", exact=True).is_visible()
    page.get_by_label("Find a country or territory").fill("xyzxyz")
    page.get_by_text("No matching country or territory").wait_for()
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
