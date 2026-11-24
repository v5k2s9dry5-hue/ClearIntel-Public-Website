"""Server-rendered country directory and source guides."""
from html import escape
import json
from pathlib import Path
from string import Template
from urllib.parse import urlencode

from country_news import COUNTRIES, NATIONAL_FEEDS, REGIONAL_FEEDS, edition_url

PAGE = Template("""<!doctype html>
<html lang="en-GB"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>$title | ClearIntel Atlas</title><meta name="description" content="$description">
<link rel="canonical" href="$canonical"><meta property="og:url" content="$canonical">
<meta property="og:site_name" content="ClearIntel Atlas"><meta property="og:title" content="$title | ClearIntel Atlas"><meta property="og:description" content="$description">
<link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/countries.css?v=evidence-disclosure"><link rel="stylesheet" href="/assets/obsidian.css">
<script src="/assets/workspace-preferences.js" defer></script>$script</head><body>
<a class="country-skip" href="#country-main">Skip to content</a>
<header class="country-header"><a class="brand country-brand" href="/" aria-label="ClearIntel Atlas homepage"><img src="/assets/favicon.svg" alt="" width="42" height="42"><span>Clear<b>Intel</b> Atlas<small>PUBLIC-SOURCE RESEARCH</small></span></a><nav aria-label="Main navigation"><a href="/">Home</a><a href="/#dashboard-map">Map</a><a href="/#research">Research</a><a href="/countries" aria-current="$current">Country directory</a><a href="/#dashboard-source-guide">Sources</a></nav></header>
<main id="country-main" tabindex="-1">$content</main></body></html>""")


def page(base, path, title, description, content, scripts=''):
    return PAGE.substitute(title=escape(title), description=escape(description),
                           canonical=escape(base + path), content=content, script=scripts, current="page" if path == "/countries" else "location")


def directory(base):
    groups = {}
    for code, name in sorted(COUNTRIES.items(), key=lambda item: item[1].casefold()):
        groups.setdefault(name[0].upper(), []).append(
            f'<li data-code="{code}"><a href="/countries/{code.lower()}"><span class="directory-code" aria-hidden="true">{code}</span><span>{escape(name)}</span></a></li>')
    jumps = ' '.join(f'<a href="#group-{letter}">{letter}</a>' for letter in groups)
    sections = ''.join(f'<section><h2 id="group-{letter}">{letter}</h2><ul class="directory">'
                       f'{"".join(links)}</ul></section>' for letter, links in groups.items())
    description = 'Browse recent reporting and news sources by country or territory.'
    body = (f'<div class="country-workspace-hero"><div class="page-kicker">GLOBAL NEWS WORKSPACE</div><h1>Country directory</h1><p>{description}</p><p class="country-directory-total">{len(COUNTRIES)} countries and territories · Select a location to open its briefing.</p></div>'
            '<div id="directory-filter" hidden><label for="country-filter">Find a country or territory</label>'
            '<input type="search" id="country-filter" placeholder="Name or code, e.g. Netherlands or UK">'
            '<button type="button" id="country-filter-clear" hidden>Clear search</button><span id="filter-count" role="status"></span></div>'
            f'<section class="country-context-links" id="country-comparison"><h2>Compare countries</h2><p>Compare the latest available World Bank observations side by side. Different observation years are shown explicitly; missing data is not zero.</p><div class="comparison-selects"><label>First country<select id="compare-first"></select></label><label>Second country<select id="compare-second"></select></label><button type="button" id="compare-load" disabled>Compare indicators</button></div><p id="compare-status" role="status">Choose two countries.</p><div id="compare-results"></div></section><div id="favorite-countries" class="favorite-countries" hidden><strong>Favourite countries</strong><ul id="favorite-country-list"></ul></div><nav aria-label="Jump to letter" class="letters">{jumps}</nav>{sections}')
    return page(base, '/countries', 'Country directory', description, body,
                '<script src="/assets/country-filter.js" defer></script><script src="/assets/country-comparison.js" defer></script>')


_ASSETS = Path(__file__).with_name("assets")
_POINTS = {p["id"]: p for p in json.loads((_ASSETS / "countries.json").read_text(encoding="utf-8"))["events"]}
_COASTS = json.loads((_ASSETS / "world-map.json").read_text(encoding="utf-8"))["coastlines"]
def locator_map(code):
    point = _POINTS[code]
    def xy(lon, lat):
        return (round((lon+180)*0.8, 2), round((90-lat)*0.8, 2))
    x, y = xy(point["longitude"], point["latitude"])
    paths = "".join('<polyline points="' + " ".join(f"{px},{py}" for px,py in (xy(lon,lat) for lon,lat in line)) + '"/>' for line in _COASTS)
    return f'<svg class="country-locator" viewBox="0 0 288 144" role="img" aria-label="Approximate geographic label point for {escape(COUNTRIES[code])}"><g fill="none" stroke="#496c83" stroke-width=".6">{paths}</g><circle cx="{x}" cy="{y}" r="5" fill="#8be9f8" stroke="#071321" stroke-width="1.5"/></svg><small>Natural Earth · indicative geographic label point, not a boundary or event location.</small>'

def flag(code):
    if len(code)==2 and code.isascii() and code.isalpha() and code not in {"XX","XK"}:
        return "".join(chr(0x1F1E6+ord(c)-65) for c in code)
    return code

def profile(base, code):
    name = COUNTRIES[code]
    sources = list(REGIONAL_FEEDS.get(code, ()))
    if code in NATIONAL_FEEDS:
        sources.insert(0, NATIONAL_FEEDS[code])
    search_url = 'https://news.google.com/search?' + urlencode({'q': name, 'hl': 'en-GB'})
    sources = [(label + ' (RSS)', url) for label, url in sources]
    if code == 'NL':
        sources.extend([
            ('NOS domestic news (Dutch)', 'https://nos.nl/nieuws/binnenland'),
            ('NOS regional news (Dutch)', 'https://nos.nl/nieuws/regio'),
            ('Dutch government announcements (English)', 'https://www.government.nl/latest/news'),
            ('NOS news feeds', 'https://nos.nl/feeds'),
        ])
    national_edition = edition_url(code)
    if national_edition:
        sources.append((f'Google News national edition for {name}', national_edition))
    sources.append((f'Search Google News for {name}', search_url))
    source_links = ''.join(f'<li><a href="{escape(url)}">{escape(label)}</a></li>' for label, url in sources)
    topic_links = ''.join(f'<li><a href="{escape("https://news.google.com/search?" + urlencode({"q": name + " " + term, "hl": "en-GB"}))}">{label}</a></li>' for label, term in (("Domestic and regional", "regional local news"), ("Politics and government", "politics government"), ("Economy and business", "economy business"), ("Health and environment", "health environment")))
    description = f'Browse recent headlines for {name}, check when sources were last queried and open the original reports.'
    body = (f'<nav class="country-breadcrumb" aria-label="Breadcrumb"><a href="/countries">All countries</a><span aria-hidden="true">/</span><span>{escape(name)}</span></nav><div class="country-workspace-hero"><div class="page-kicker">COUNTRY INTELLIGENCE · {code}</div><h1><span class="country-flag" aria-hidden="true">{flag(code)}</span> {escape(name)}</h1><p>{escape(description)}</p><div class="country-hero-links"><button type="button" id="favorite-country-toggle" data-code="{code}" data-name="{escape(name)}" aria-pressed="false" hidden>Save favourite</button><a href="/#research">Open research desk</a><a href="/#dashboard-map">Explore global map</a></div></div>'
            '<button type="button" id="analyst-mode-toggle" class="globe-control analyst-mode-toggle" aria-pressed="false" hidden>Analyst mode</button>'
            f'<div class="country-profile-grid"><div><section id="country-brief" data-code="{code}" data-place="{escape(name)}">'
            '<h2>Recent headlines</h2><noscript>Enable JavaScript to load headlines or use the source links below.</noscript></section>'
            f'<p class="update-note">Headlines refresh every five minutes while this page is open and visible.</p>'
            '<section id="country-briefing-export" class="country-briefing-export" hidden><h2>Build a country briefing</h2><p>Choose original linked reports from the current snapshot. Exported findings are reporting leads, not verified incidents.</p><p id="country-briefing-summary" role="status"></p><div id="country-briefing-evidence"></div><label for="country-briefing-notes">Researcher notes (included in exported files)</label><textarea id="country-briefing-notes" maxlength="2000" rows="3" placeholder="Questions, limitations or your assessment"></textarea><button type="button" id="country-briefing-download" disabled>Download country briefing PDF</button><button type="button" id="country-briefing-manifest" disabled>Download evidence JSON</button><p id="country-briefing-status" role="status"></p></section>'
            f'</div><section class="profile-source-panel"><h2>Geographic context</h2>{locator_map(code)}<section class="country-context-links"><h2>Country statistics</h2><p>Official World Bank indicators, with observation years. Availability varies by country or territory.</p><button type="button" id="country-stats-load" data-code="{code}">Check latest available statistics</button><p id="country-stats-status" role="status">Not checked. Loads only on request.</p><dl id="country-stats-results"></dl><a href="https://data.worldbank.org/">World Bank Data</a><p><small>World Bank: World Development Indicators. See <a href="https://www.worldbank.org/ext/en/legal/terms-conditions/datasets">dataset terms</a>.</small></p></section><section class="country-context-links"><h2>Official travel advice</h2><p>Check UK government advice for this destination, including safety, entry rules and health. No risk rating inferred by ClearIntel.</p><a href="https://www.gov.uk/foreign-travel-advice">Find destination in FCDO travel advice</a></section><section class="country-context-links"><h2>Explore reporting by topic</h2><p>Targeted source searches, not classifications of existing reports.</p><ul>{topic_links}</ul></section><h2>Browse sources</h2><p>Open these sources directly, including when the headline feed is unavailable.</p><ul>{source_links}</ul></section></div>')
    scripts = '<script src="/assets/analyst-mode.js" defer></script><script src="/assets/country-card.js?v=evidence-disclosure" defer></script><script src="/assets/research-pdf.js" defer></script><script src="/assets/country-profile.js?v=refresh-resilience" defer></script><script src="/assets/country-stats.js" defer></script>'
    return page(base, '/countries/' + code.lower(), name + ' news and sources', description, body, scripts)
