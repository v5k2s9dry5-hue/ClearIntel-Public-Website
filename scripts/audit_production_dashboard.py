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
        metrics.update({"http": response.status if response else None, "browserErrors": len(errors), "viewport": [width,height]})
        print(name + ": " + json.dumps(metrics), flush=True)
        (OUT / (name + ".json")).write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    finally:
        context.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            audit(browser, "desktop", 1574, 870)
            audit(browser, "mobile", 390, 844)
        finally:
            browser.close()
