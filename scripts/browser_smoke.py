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
    # Runs in every document, including reloads. The previous test defined an
    # uninvoked function and therefore never installed the clipboard stub.
    page.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
        configurable:true, value:{writeText:async value=>{window.lastCitation=value;}}
    });""")
    errors = []
    regional_requests = []
    page.on("request", lambda request: regional_requests.append(request.url) if request.url.endswith("/assets/uk-coastline.json") else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/api/country-news/GB", lambda route: route_json(route, COUNTRY))
    def news_fixture(route):
        if route.request.post_data_json["query"] == "rail services":
            return route_json(route, {**NEWS, "provider_errors": ["gdelt: timeout"]})
        return route_json(route, NEWS)
    page.route("**/api/news", news_fixture)
    page.goto(ROOT, wait_until="domcontentloaded")
    page.evaluate("""() => {
        const response = new Response(null, {status: 429, headers: {'Retry-After': '180'}});
        if (ClearIntelMapRefresh.retryAt(response, 1000) !== 181000) throw Error('Retry-After ignored');
        const malformed = new Response(null, {status: 503, headers: {'Retry-After': 'invalid'}});
        if (ClearIntelMapRefresh.retryAt(malformed, 1000) !== 31000) throw Error('Invalid retry fallback');
    }""")
    assert page.locator("#map-layer-source").inner_text() == "USGS · Earthquake observations"
    assert page.locator("#map-layer-kind").inner_text() == "Public feed"
    # A single accessible layer control must sit inside the interactive map,
    # not in the global page header or elsewhere off-screen.
    assert page.locator("#dashboard-map .map-panel-heading #globe-layer").count() == 1
    assert page.locator(".dashboard-toolbar-tools #globe-layer").count() == 0
    map_heading = page.locator("#dashboard-map .map-panel-heading").bounding_box()
    map_picker = page.locator("#dashboard-map .map-layer-picker").bounding_box()
    assert map_heading and map_picker
    assert map_picker["x"] >= map_heading["x"] - 1, (map_heading, map_picker)
    assert map_picker["y"] >= map_heading["y"] - 1, (map_heading, map_picker)
    assert map_picker["x"] + map_picker["width"] <= map_heading["x"] + map_heading["width"] + 1, (map_heading, map_picker)
    assert map_picker["y"] + map_picker["height"] <= map_heading["y"] + map_heading["height"] + 1, (map_heading, map_picker)
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert page.locator("#dashboard-map-heading").is_visible()
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(6, 9, 16)"
    assert page.evaluate("getComputedStyle(document.querySelector('#dashboard-map')).backgroundColor") == "rgb(5, 14, 26)"
    assert page.evaluate("getComputedStyle(document.querySelector('.command-overview-card')).backgroundImage.includes('gradient')")
    assert page.locator('link[href*="/assets/obsidian.css"]').count() == 1
    assert page.get_by_role("heading", name="Intelligence at a glance.").is_visible()
    assert page.locator(".command-overview-card").count() == 3
    assert page.locator("#activity-pulse").is_visible()
    hero_graph = page.locator("#global-pulse").bounding_box()
    guide_box = page.locator("#ci-start-guide").bounding_box()
    category_box = page.locator(".command-overview").bounding_box()
    assert hero_graph and guide_box and category_box
    assert hero_graph["y"] < guide_box["y"], "Graph is below the guide instead of in the hero"
    assert hero_graph["y"] < category_box["y"], "Graph was buried below the cards"
    page.evaluate("""() => {
        const now=Date.now();
        window.dispatchEvent(new CustomEvent('clearintel:earthquake-snapshot', {detail:{
          generated_at_ms:now,
          events:[{occurred_at_ms:now-3600000},{occurred_at_ms:now-9000000}],
          stale:false
        }}));
    }""")
    assert page.locator("#pulse-quakes").inner_text() == "USGS · 2 earthquakes · Last 24h"
    assert "Not checked yet" in page.locator("#pulse-fires").inner_text()
    assert page.locator("#pulse-series polyline.earthquakes").count() == 1
    assert page.locator("#pulse-series polyline.wildfires").count() == 0
    assert "USGS: 0, 0, 0, 0, 0, 2" in page.locator("#pulse-chart").get_attribute("aria-label")
    page.evaluate("""() => {
        const now=Date.now();
        window.dispatchEvent(new CustomEvent('clearintel:wildfire-snapshot', {detail:{
          checked_at_ms:now,events:[{observed_at_ms:now-1800000,title:'Fixture wildfire',url:'https://eonet.gsfc.nasa.gov/'}],stale:false
        }}));
    }""")
    assert page.locator("#pulse-series polyline.wildfires").count() == 1
    assert "NASA EONET: 0, 0, 0, 0, 0, 1" in page.locator("#pulse-chart").get_attribute("aria-label")
    page.evaluate("window.dispatchEvent(new CustomEvent('clearintel:wildfire-snapshot',{detail:{unavailable:true}}))")
    assert page.locator("#pulse-series polyline.wildfires.stale").count() == 1
    for asset in ("card-earth.svg", "card-country.svg", "card-archive.svg"):
        assert page.request.get(ROOT + "/assets/" + asset).ok

    assert page.locator("#activity-pulse-total").inner_text() == "2"
    assert page.locator("#activity-pulse-bars .activity-pulse-bin").count() == 6
    assert page.locator("#activity-pulse-status").inner_text() == "USGS feed checked"
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert page.locator(".dashboard-toolbar-tools").is_visible()
    assert page.locator("#ci-start-guide").is_visible()
    guide = page.locator("#ci-start-guide")
    assert not guide.get_by_text("Choose a map layer").is_visible()
    guide.locator("summary").click()
    assert guide.get_by_text("Choose a map layer").is_visible()
    assert guide.get_by_text("Save and compare evidence").is_visible()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    guide.locator("summary").click()
    assert not guide.get_by_text("Choose a map layer").is_visible()
    map_help = page.locator('button[data-ci-note="ci-map-note"]')
    map_help.click()
    assert map_help.get_attribute("aria-expanded") == "true"
    assert page.locator("#ci-map-note").is_visible()
    assert "not a confirmed incident location" in page.locator("#ci-map-note").inner_text()
    map_help.click()
    assert map_help.get_attribute("aria-expanded") == "false"
    assert not page.locator("#ci-map-note").is_visible()
    assert page.locator("#ci-feed-note").is_hidden()
    feed_help = page.get_by_role("button", name="Explain source feed and timestamps")
    if mobile:
        page.locator("#dashboard-feed-tab").click()
    feed_help.click()
    assert page.locator("#ci-feed-note").is_visible()
    assert map_help.get_attribute("aria-expanded") == "false"
    feed_help.click()
    assert not page.locator("#ci-feed-note").is_visible()
    if mobile:
        page.locator("#dashboard-map-tab").click()
    if not mobile:
        mode_hover = page.locator("#analyst-mode-toggle")
        mode_hover.evaluate("(button) => button.setAttribute('aria-describedby', 'dashboard-map-heading')")
        mode_hover.hover()
        hint = page.locator("#ci-context-tooltip")
        assert hint.is_visible()
        assert mode_hover.get_attribute("aria-describedby").split() == ["dashboard-map-heading", "ci-context-tooltip"]
        assert "extra source details" in hint.inner_text()
        hint_rect = hint.bounding_box()
        assert hint_rect and hint_rect["x"] >= 0
        assert hint_rect["x"] + hint_rect["width"] <= width + 1
        page.locator(".workspace-kicker").hover()
        assert hint.is_hidden()
        assert mode_hover.get_attribute("aria-describedby") == "dashboard-map-heading"
    else:
        bounds = map_help.bounding_box()
        assert bounds and min(bounds["width"], bounds["height"]) >= 44
        assert page.locator("#ci-context-tooltip").is_hidden()
        page.get_by_role("button", name="Explain workspace controls").click()
        assert page.locator("#ci-workspace-note").is_visible()
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
        page.get_by_role("button", name="Explain workspace controls").click()
    assert page.locator(".workspace-layer-picker select").is_visible()
    mode_button = page.locator("#analyst-mode-toggle")
    assert mode_button.is_visible()
    assert mode_button.get_attribute("aria-pressed") == "false"
    assert mode_button.locator(".workspace-control-indicator").inner_text() == "Off"
    assert page.evaluate("() => document.querySelector('#analyst-mode-toggle').closest('.dashboard-heading-group') === null")
    mode_button.click()
    assert mode_button.get_attribute("aria-pressed") == "true"
    assert mode_button.locator(".workspace-control-indicator").inner_text() == "On"
    mode_button.click()
    assert mode_button.get_attribute("aria-pressed") == "false"
    assert mode_button.locator(".workspace-control-indicator").inner_text() == "Off"
    page.locator('[data-command-layer="countries"]').click()
    assert page.locator("#globe-layer").input_value() == "countries"
    assert page.locator("#map-layer-kind").inner_text() == "News coverage"
    assert page.locator('[data-command-layer="countries"]').get_attribute("aria-pressed") == "true"
    page.locator('[data-command-layer="earthquakes"]').click()
    assert page.locator("#globe-layer").input_value() == "earthquakes"
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    toggle = page.locator("#sidebar-toggle")
    if width > 1080:
        assert toggle.locator(".workspace-control-text").inner_text() == "Show sidebar"
        assert not page.locator("#dashboard-sidebar").is_visible()
        toggle.click()
        assert toggle.get_attribute("aria-expanded") == "true"
        assert page.locator("#dashboard-sidebar").is_visible()
        page.reload(wait_until="domcontentloaded")
        assert page.locator("#dashboard-sidebar").is_visible()
        page.get_by_role("button", name="Hide sidebar").click()
        assert toggle.get_attribute("aria-expanded") == "false"
        assert not page.locator("#dashboard-sidebar").is_visible()
    else:
        assert not toggle.is_visible()
    controls = page.locator(".dashboard-toolbar-tools").bounding_box()
    assert controls and controls["x"] >= 0
    assert controls["x"] + controls["width"] <= width + 1
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
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
    rotation = page.locator("#earth-motion")
    assert rotation.get_attribute("aria-pressed") == "true"  # reduced-motion context
    rotation.click()
    assert rotation.get_attribute("aria-pressed") == "false"
    rotation.click()
    assert rotation.get_attribute("aria-pressed") == "true"
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
    profile_link.focus()
    profile_link.press("Escape")
    assert page.locator("#dashboard-matches").is_hidden()
    assert query.input_value() == "UK"
    assert query.evaluate("(field) => field === document.activeElement")
    if mobile:
        page.locator("#dashboard-feed-tab").click()
        page.locator("#dashboard-search-tab").click()
    query.fill("earthquake")
    query.press("Enter")
    page.locator("#dashboard-matches").get_by_role("button", name="Map layer", exact=False).click()
    assert page.locator("#dashboard-map").is_visible()
    assert page.locator("#dashboard-map-heading").evaluate("(heading) => heading === document.activeElement")
    query.fill("UKMTO")
    query.press("Enter")
    page.locator("#dashboard-matches").get_by_role("button", name="Naval activity · Historical map layer").click()
    ukmto = page.locator("#ukmto-bulletins")
    assert ukmto.get_by_role("link", name="Official advisories").is_visible()
    assert ukmto.get_by_role("link", name="Official warnings").get_attribute("href") == "https://www.ukmto.org/ukmto-products/warnings"
    assert ukmto.get_by_role("link", name="Recent incidents").is_visible()
    assert ukmto.get_by_role("link", name="Weekly overview reports").is_visible()
    assert ukmto.locator(".ukmto-source-links a").count() == 4
    ukmto.locator("#ukmto-reports .ukmto-report").first.wait_for(timeout=15000)
    assert ukmto.locator(".ukmto-report").count() == 5
    assert ukmto.get_by_text("NOT live or automatically refreshed", exact=False).is_visible()
    assert ukmto.locator(".ukmto-report-link").first.get_attribute("href") == "https://www.ukmto.org/recent-incidents"
    assert ukmto.get_by_text("UKMTO 217-26", exact=False).is_visible()
    assert "does not automatically import UKMTO reports" in ukmto.inner_text()
    assert "not affiliated with or endorsed by UKMTO" in ukmto.inner_text()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert page.locator("#map-layer-kind").inner_text() == "Historical archive"
    # The layer picker now travels with the map. On mobile, return to the Map
    # tab before using it; it must not remain an off-screen top-bar control.
    if mobile:
        page.locator("#dashboard-map-tab").click()
    assert page.locator("#globe-layer").is_visible()
    page.locator("#globe-layer").select_option("earthquakes")
    assert page.locator("#map-layer-kind").inner_text() == "Public feed"
    assert not page.locator("#ukmto-bulletins").is_visible()
    query.fill("rail services")
    query.press("Enter")
    page.locator("#dashboard-matches").get_by_role("button", name="Search recent headlines", exact=False).click()
    page.locator("#news-results .result-title").wait_for()
    assert page.locator("#news-query").input_value() == "rail services"
    feed_coverage = page.locator("#news-results .search-coverage")
    feed_coverage.get_by_text("Partial feed coverage · 1 of 2 feeds responded").click()
    assert feed_coverage.get_by_text("GDELT — unavailable (timeout)").is_visible()
    assert feed_coverage.get_by_text("Fixture provider — responded").is_visible()
    if mobile:
        page.locator("#dashboard-map-tab").click()
    assert not regional_requests, "UK coastline downloaded before regional view was requested"
    page.locator("#earth-uk-view").click()
    page.wait_for_function("() => performance.getEntriesByType('resource').some(e => e.name.endsWith('/assets/uk-coastline.json'))")
    assert len(regional_requests) == 1
    page.locator("#earth-uk-view").click()
    page.locator("#map-expand").click()
    assert page.get_by_role("dialog", name="Expanded map").is_visible()
    assert page.locator("#expanded-map #globe-layer").is_visible()
    page.locator("#earth-zoom-in").click()
    page.keyboard.press("Escape")
    page.locator("#expanded-map").wait_for(state="hidden")
    page.wait_for_function("() => document.querySelector('#map-expand') === document.activeElement")
    page.locator("#research").scroll_into_view_if_needed()
    page.get_by_role("button", name="Explain public news search").click()
    assert page.locator("#ci-research-note").is_visible()
    page.get_by_role("button", name="Explain public news search").click()
    assert not page.locator("#ci-research-note").is_visible()
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
    # Search health must distinguish total failure, partial coverage and no checks.
    page.evaluate("""() => {
        const unavailable = searchCoverage({sources_checked: [], provider_errors: ['gdelt: timeout']});
        if (unavailable.dataset.health !== 'unavailable' ||
            !unavailable.querySelector('summary').textContent.includes('Feeds unavailable'))
            throw Error('Full outage was misreported as partial or successful');
        const partial = searchCoverage({sources_checked: ['google'], provider_errors: ['gdelt: timeout']});
        if (partial.dataset.health !== 'partial' ||
            !partial.querySelector('summary').textContent.includes('1 of 2 feeds responded'))
            throw Error('Partial feed coverage mislabeled');
        const empty = searchCoverage({sources_checked: [], provider_errors: []});
        if (empty.dataset.health !== 'not-checked') throw Error('Unqueried feeds mislabeled');
    }""")
    page.locator("#news-query").fill("UK")
    page.locator("#news-submit").click()
    page.locator("#news-results .result-title").wait_for()
    assert page.locator("#news-results .result-title").inner_text() == NEWS["results"][0]["title"]
    assert feed_coverage.get_by_text("Feed coverage · 1 of 1 feed responded").is_visible()
    page.locator("#news-results .citation-copy").first.click()
    page.wait_for_function("() => window.lastCitation && window.lastCitation.includes('UK transport news update')")
    assert "Fixture publisher" in page.evaluate("() => window.lastCitation")
    assert "https://example.org/transport-update" in page.evaluate("() => window.lastCitation")
    assert "not independently verified" in page.evaluate("() => window.lastCitation")
    assert page.locator("#news-results .citation-status").inner_text() == "Citation copied."
    # Replay must never retain a query or its news results before explicit action.
    assert page.evaluate("() => localStorage.getItem('clearintel.replay.snapshots.v1')") is None
    page.get_by_role("button", name="Save current snapshot").click()
    page.get_by_text("Snapshot saved to this browser", exact=False).wait_for()
    replay = page.evaluate("() => JSON.parse(localStorage.getItem('clearintel.replay.snapshots.v1'))")
    assert len(replay) == 1
    assert replay[0]["query"] == "UK"
    assert replay[0]["articles"][0]["source"] == "Fixture publisher"
    assert replay[0]["articles"][0]["url"] == "https://example.org/transport-update"
    assert "observed_at_utc" in replay[0]
    assert page.locator("#replay-history").is_visible()
    page.get_by_role("button", name="Explain Intelligence Replay").click()
    assert page.locator("#ci-replay-note").is_visible()
    page.get_by_role("button", name="Explain Intelligence Replay").click()
    assert not page.locator("#ci-replay-note").is_visible()
    assert page.locator("#replay-detail").get_by_text("Observed by this browser:", exact=False).is_visible()
    assert page.locator("#replay-detail").get_by_text("Sources checked when saved: Fixture provider").is_visible()
    # A second, deliberately changed observed result set, not fabricated history.
    page.evaluate("""() => document.dispatchEvent(new CustomEvent('clearintel:news-ready', {
      detail:{search:{query:'UK',window:'24h',incidentOnly:false},
      payload:{results:[{title:'New UK research report',source:'Second publisher',
        provider:'Fixture',url:'https://example.org/new-story',
        feed_time_utc:'2026-11-21T13:00:00Z',time_basis:'Publication time'}],
      sources_checked:['Second fixture provider'],provider_errors:['Fixture provider: timeout']}}
    }))""")
    page.get_by_role("button", name="Save current snapshot").click()
    assert page.locator("#replay-select option").count() == 2
    page.get_by_role("button", name="Compare with earlier snapshot").click()
    assert page.locator("#replay-compare").is_visible()
    assert "1 newly present" in page.locator(".replay-compare-summary").inner_text()
    assert "1 no longer present" in page.locator(".replay-compare-summary").inner_text()
    assert page.locator(".replay-diff-added").get_by_text("New UK research report").is_visible()
    assert page.locator(".replay-diff-removed").get_by_text("UK transport news update").is_visible()
    assert page.get_by_text("These are differences between two saved", exact=False).is_visible()
    assert page.get_by_text("Source coverage caution:", exact=False).is_visible()
    assert page.get_by_text("Earlier provider problems: 0", exact=False).is_visible()
    assert page.get_by_text("Later provider problems: 1", exact=False).is_visible()
    assert page.locator("#replay-detail").get_by_text("Provider problems when saved:", exact=False).is_visible()
    # A selected older snapshot cannot invent history before it was recorded.
    page.locator("#replay-select").select_option(index=1)
    assert page.get_by_role("button", name="Compare with earlier snapshot").is_disabled()
    page.locator("#replay-select").select_option(index=0)
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Clear saved history").click()
    assert page.evaluate("() => localStorage.getItem('clearintel.replay.snapshots.v1')") is None
    assert not page.locator("#replay-history").is_visible()
    # Matching wording is about text similarity, not independent confirmations.
    page.evaluate("""() => document.dispatchEvent(new CustomEvent('clearintel:news-ready', {
      detail:{search:{query:'UK',window:'24h',incidentOnly:false},
      payload:{results:[
        {title:'Manchester council announces railway service improvements',
         source:'Provider One',provider:'Fixture',
         url:'https://example.org/council-one',feed_time_utc:'2026-11-21T13:00:00Z'},
        {title:'Manchester council announces railway service improvements!',
         source:'Provider Two',provider:'Fixture',
         url:'https://example.org/council-two',feed_time_utc:'2026-11-21T14:00:00Z'},
        {title:'Manchester council announces road maintenance closures',
         source:'Provider Three',provider:'Fixture',
         url:'https://example.org/road-closure',feed_time_utc:'2026-11-21T14:00:00Z'}
      ],sources_checked:['Fixture provider'],provider_errors:[]}}
    }))""")
    page.get_by_role("button", name="Save current snapshot").click()
    assert page.locator(".replay-wording-total").inner_text().startswith("1 group")
    assert page.locator(".replay-wording-detail").count() == 1
    assert "2 source links" in page.locator(".replay-wording-detail summary").inner_text()
    assert "2 listed publishers" in page.locator(".replay-wording-detail summary").inner_text()
    assert page.locator(".replay-wording-detail a").count() == 0 or not page.locator(".replay-wording-detail a").first.is_visible()
    page.locator(".replay-wording-detail summary").click()
    assert page.locator(".replay-wording-detail a").count() == 2
    assert page.locator(".replay-wording-detail a").first.is_visible()
    assert page.get_by_text("does not demonstrate independent reporting", exact=False).is_visible()
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Clear saved history").click()
    assert not page.locator("#replay-history").is_visible()
    page.locator("#result-publisher").select_option("Fixture publisher")
    page.locator("#result-order").select_option("oldest")
    assert page.locator(".result-view-count").inner_text() == "Showing 1 of 1 headlines"
    page.get_by_role("button", name="Reset view").click()
    assert page.locator("#result-publisher").input_value() == ""
    assert page.locator("#result-order").input_value() == "original"
    assert page.locator("#news-results .report-include input").first.is_checked()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    page.locator("#search-country .country-top-stories li").wait_for()
    assert page.get_by_text("SEPARATE COUNTRY BRIEF", exact=False).is_visible()
    assert page.locator("#search-country").get_attribute("aria-label") == "Separate country headline briefing"
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
        status=429, headers={"Retry-After": "3"}, content_type="application/json",
        body='{"detail":"News search is busy. Try again shortly."}'))
    page.locator("#news-submit").click()
    page.get_by_text("Try again in 3 seconds.").wait_for()
    assert page.get_by_text("Filtered search is busy across the site").is_visible()
    assert page.locator("#news-submit").is_disabled()
    page.locator("#search-country .country-top-stories li").wait_for()
    retry_requests = []
    def track_search(request):
        if request.url.endswith("/api/news"):
            retry_requests.append(request.url)
    page.on("request", track_search)
    page.locator("#news-form").evaluate("(form) => form.requestSubmit()")
    assert page.get_by_text("independent feed and does not mean this search succeeded", exact=False).is_visible()
    page.locator("#search-country .country-top-stories li").wait_for()
    page.get_by_text("Ready to search again").wait_for(timeout=8000)
    assert page.locator("#news-submit").is_enabled()
    assert not retry_requests, retry_requests
    page.remove_listener("request", track_search)

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
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(6, 9, 16)"
    assert page.locator('link[href*="/assets/obsidian.css"]').count() == 1
    assert page.locator(".profile-source-panel").is_visible()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
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
    # Related coverage is collapsed in simple mode, and remains open after a same-story refresh.
    page.evaluate("""data => {
        const extra = {...data.stories[0].reports[0], source:'Second fixture', title:'Related report', url:'https://example.org/related'};
        data.stories[0].reports.push(extra);
        window.evidenceFixture = data;
        renderCountryCard(document.querySelector('#country-brief'), {id:'GB',place:'United Kingdom'}, {data});
    }""", COUNTRY)
    related = page.locator("#country-brief .country-related-reports")
    assert related.is_visible()
    assert not related.get_by_role("link", name="Related report").is_visible()
    related.locator("summary").click()
    assert related.get_by_role("link", name="Related report").is_visible()
    page.evaluate("""() => renderCountryCard(document.querySelector('#country-brief'),
        {id:'GB',place:'United Kingdom'}, {data:window.evidenceFixture})""")
    assert related.get_by_role("link", name="Related report").is_visible()
    assert related.locator("summary").evaluate("(node) => node === document.activeElement")
    mode.click()
    assert related.get_by_role("link", name="Related report").is_visible()
    mode.click()
    assert not related.get_by_role("link", name="Related report").is_visible()
    page.locator("#country-brief .country-coverage-details summary").click()
    # Exercise the retained snapshot and weekly fallback without calling live providers.
    page.evaluate("""data => {
        data.stories[0].basis = 'weekly';
        renderCountryCard(document.querySelector('#country-brief'),
            {id: 'GB', place: 'United Kingdom'}, {data, failed: true});
    }""", COUNTRY)
    assert page.locator("#country-brief").get_by_text("Last available snapshot", exact=False).is_visible()
    assert page.locator("#country-brief").get_by_text("Older coverage: past week", exact=False).is_visible()
    assert page.locator("#country-brief").get_by_text("Gdelt — timeout").is_visible()
    # An empty result after every provider fails is an outage, not proof of no news.
    # All feed-derived URLs are untrusted, even when the API normally validates them.
    page.evaluate("""() => {
        const box = document.querySelector('#country-brief');
        const country = {id:'GB', place:'United Kingdom'};
        const outage = {...window.evidenceFixture, stories: [], sources_checked: [],
            provider_errors: ['google: HTTP 429']};
        renderCountryCard(box, country, {data: outage});
        if (!box.textContent.includes('no sources responded'))
            throw Error('A complete country source outage was reported as empty news');
        if (box.querySelector('.country-coverage-details')?.dataset.health !== 'unavailable')
            throw Error('Country sources should be marked unavailable');

        const unsafe = {...window.evidenceFixture, sources_checked:['fixture'], provider_errors:[],
            stories:[{basis:'national', reports:[{
                title:'Unsafe fixture', url:'javascript:alert(1)', source:'Fixture',
                feed_time_utc:'2026-11-21T12:00:00+00:00'}]}]};
        renderCountryCard(box, country, {data: unsafe});
        if (box.querySelector('.country-top-stories a') ||
            !box.querySelector('.country-unlinked-source')?.textContent.includes('Unsafe fixture'))
            throw Error('Unsafe headline URL became clickable');

        renderCountryCard(box, country, {data:window.evidenceFixture, failed:true});
        if (box.querySelector('.country-coverage-details')?.dataset.health !== 'previous-snapshot' ||
            !box.querySelector('.country-coverage-details').textContent.includes('previous snapshot'))
            throw Error('Stale country source state was not disclosed');

        unsafe.stories[0].reports[0].url='https://example.org/legitimate';
        renderCountryCard(box, country, {data: unsafe});
        if (!box.querySelector('.country-top-stories a[href="https://example.org/legitimate"]'))
            throw Error('Valid HTTPS headline link disappeared');
    }""")
    page.get_by_role("link", name="Country directory").click()
    page.get_by_role("link", name="Netherlands", exact=True).wait_for()
    assert page.locator(".directory-code").first.is_visible()
    page.get_by_label("Find a country or territory").fill("UK")
    assert page.get_by_role("link", name="United Kingdom", exact=True).is_visible()
    assert not page.get_by_role("link", name="Netherlands", exact=True).is_visible()
    page.get_by_label("Find a country or territory").fill("xyzxyz")
    page.get_by_text("No matching country or territory").wait_for()
    assert not errors, "Browser JS errors: " + "; ".join(errors)
    print(("Mobile" if mobile else "Desktop") + " research, globe, PDF, and tooltip checks passed")
    context.close()


def check_wide_hero_layout(browser):
    """Verify the chart occupies the desktop header gap and uses a real feed."""
    width = 1574
    context = browser.new_context(viewport={"width": width, "height": 870},
                                  reduced_motion="reduce")
    page = context.new_page()
    now = int(time.time() * 1000)
    observation = {"generated_at_ms": now, "events": [{
        "id": "test-earthquake", "occurred_at_ms": now - 3600000,
        "magnitude": 5.0, "place": "Fixture location", "latitude": 1.0,
        "longitude": 2.0, "url": "https://earthquake.usgs.gov/earthquakes/eventpage/test"
    }]}
    page.route("**/api/earthquakes", lambda route: route_json(route, observation))
    page.goto(ROOT, wait_until="domcontentloaded")
    page.wait_for_function("() => document.querySelector('#activity-pulse-total')?.textContent === '1'",
                           timeout=15000)
    chart = page.locator("#global-pulse").bounding_box()
    title = page.locator(".dashboard-heading-group").bounding_box()
    guide = page.locator("#ci-start-guide").bounding_box()
    cards = page.locator(".command-overview").bounding_box()
    assert chart and title and guide and cards
    assert chart["x"] >= title["x"] + title["width"] - 35, (chart, title)
    assert chart["y"] < 430, "Chart should be visible in the initial desktop viewport"
    globe = page.locator("#dashboard-map").bounding_box()
    search = page.locator("#dashboard-search").bounding_box()
    assert globe and search
    assert globe["x"] >= title["x"] + title["width"] - 2
    assert chart["x"] >= globe["x"] + globe["width"] - 2
    assert globe["y"] < 430 and search["y"] < 650
    assert chart["y"] < guide["y"] and chart["y"] < cards["y"]
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert page.locator("#activity-pulse-status").inner_text() == "USGS feed checked"
    assert "1 earthquakes" in page.locator("#pulse-quakes").inner_text()
    assert page.locator("#pulse-latest a").count() == 1
    assert "Fixture location" in page.locator("#pulse-latest a").inner_text()
    assert page.locator("#pulse-latest a").get_attribute("href") == observation["events"][0]["url"]
    assert page.locator("#earth-observations #activity-pulse").count() == 1
    print("Desktop 1574px global pulse, globe-first layout and USGS-driven chart passed")
    context.close()


if __name__ == "__main__":
    wait_for_local_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for size in (390, 1280):
                check_site(browser, size)
            check_wide_hero_layout(browser)
        finally:
            browser.close()
