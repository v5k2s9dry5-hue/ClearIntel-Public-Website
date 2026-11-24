"""Capture the public dashboard at desktop/mobile sizes, with real source responses."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "https://clearintel-public.onrender.com"
OUT = Path("production-dashboard-audit")
OUT.mkdir(exist_ok=True)

def audit(browser, name, width, height):
    context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)[:200]))
    try:
        response = page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
        page.locator("#global-pulse").wait_for(state="attached", timeout=15000)
        try:
            page.locator("#pulse-coverage").filter(has_text="of 7 automatic sources current").wait_for(timeout=45000)
        except Exception:
            pass
        try:
            page.locator('#earth-texture-credit').wait_for(state='visible', timeout=20000)
        except Exception:
            pass
        # Capture once the initial layout is present; no simulated data or login.
        page.screenshot(path=str(OUT / (name + ".png")), timeout=15000)
        metrics = page.evaluate("""() => ({
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            pulseSeries: document.querySelectorAll('#pulse-series polyline').length,
            categoryTiles: document.querySelectorAll('.pulse-categories > *').length,
            coverage: document.querySelector('#pulse-coverage')?.textContent || null,
            textureCreditVisible: !!document.querySelector('#earth-texture-credit:not([hidden])'),
            archivePhotoConfigured: getComputedStyle(document.querySelector('[data-command-layer=aviation]'), '::before').backgroundImage.includes('archive-card.jpg')
        })""")
        headers = response.headers if response else {}
        metrics.update({"contentEncoding":headers.get('content-encoding','identity'),
                        "resourcePolicy":headers.get('cross-origin-resource-policy','not present'),
                        "incidentDefault": page.locator('#globe-layer').input_value() == 'incidents',
                        "incidentControlsVisible": page.locator('#incident-severity').is_visible(),
                        "incidentCoverage": page.locator('#incident-coverage').inner_text(),
                        "sourceHealthRows": page.locator('#pulse-health-list li').count(),
                        "sanctionsOnDemand": 'Not checked' in page.locator('#sanctions-status').inner_text(),
                        "navigationTiming": page.evaluate("() => {const n=performance.getEntriesByType('navigation')[0];return n?{ttfb_ms:Math.round(n.responseStart),dom_ready_ms:Math.round(n.domContentLoadedEventEnd),transfer_bytes:n.transferSize,encoded_body_bytes:n.encodedBodySize,decoded_body_bytes:n.decodedBodySize}:null;}"),
                        "http": response.status if response else None, "browserErrors": len(errors), "viewport": [width,height]})
        print(name + ": " + json.dumps(metrics), flush=True)
        (OUT / (name + ".json")).write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        audit_workspaces(page, name, errors)
        assert metrics['http'] == 200 and not metrics['horizontalOverflow'], metrics
        assert metrics['incidentDefault'] and metrics['incidentControlsVisible'], metrics
        assert metrics['sanctionsOnDemand'] and metrics['sourceHealthRows'] == 7, metrics
        assert not errors, errors
    finally:
        context.close()

def audit_workspaces(page, name, errors):
    """Exercise deployed navigation and help without making repeated news searches."""
    metrics = {}
    def capture(label):
        page.screenshot(path=str(OUT / f"{name}-{label}.png"), timeout=15000)
        return page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")

    page.locator("#research").scroll_into_view_if_needed()
    metrics["researchNoOverflow"] = capture("research")
    metrics["researchWorkflow"] = page.locator(".research-workflow span").count() == 3
    help_button = page.get_by_role("button", name="Explain public news search")
    help_button.click()
    metrics["researchHelp"] = page.locator("#ci-research-note").is_visible()
    help_button.click()

    response = page.goto(BASE + "/countries", wait_until="domcontentloaded", timeout=60000)
    page.locator("#country-filter").wait_for(state="visible", timeout=15000)
    metrics["directoryHTTP"] = response.status
    metrics["directoryCount"] = page.locator(".directory li").count()
    page.locator("#country-filter").fill("Netherlands")
    metrics["directoryFilter"] = page.locator(".directory li:not([hidden])").count() == 1
    page.locator("#country-filter-clear").click()
    metrics["directoryReset"] = page.locator("#country-filter").input_value() == ""
    metrics["directoryNoOverflow"] = capture("directory")

    response = page.goto(BASE + "/countries/nl", wait_until="domcontentloaded", timeout=60000)
    page.locator("#country-brief").wait_for(state="visible")
    metrics["profileHTTP"] = response.status
    metrics["profileNavigation"] = page.locator(".country-breadcrumb a").count() == 1
    metrics["profileSources"] = page.locator(".profile-source-panel a").count()
    metrics["profileNoOverflow"] = capture("profile")
    metrics['briefingBuilderPresent'] = page.locator('#country-briefing-export').count() == 1
    metrics['manifestControlPresent'] = page.locator('#country-briefing-manifest').count() == 1
    metrics["browserErrors"] = len(errors)
    print(name + " workspaces: " + json.dumps(metrics), flush=True)
    (OUT / f"{name}-workspaces.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    assert metrics['directoryHTTP'] == metrics['profileHTTP'] == 200 and metrics['directoryCount'] == 238, metrics
    assert metrics['directoryNoOverflow'] and metrics['profileNoOverflow'] and metrics['researchNoOverflow'], metrics
    assert metrics['briefingBuilderPresent'] and metrics['manifestControlPresent'], metrics


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            audit(browser, "desktop", 1574, 870)
            audit(browser, "mobile", 390, 844)
        finally:
            browser.close()
