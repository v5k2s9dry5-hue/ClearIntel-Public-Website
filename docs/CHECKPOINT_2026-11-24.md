# ClearIntel Atlas — end-of-session checkpoint
24 November 2026, 10:56 UTC. Resume on 25 November. Public site: https://clearintel-public.onrender.com/

## Confirmed production
Render service srv-dbvk1bsipgvc73derd20, workspace tea-dbvjuqvlk1mc73dv90t0. Live deployment dep-dc2mloe0tbcc7386t5h0, main commit 668a91594be13d488e84d398ec2756da23a5cc91 (PR116), live since 10:46:51. Approved original cyan monogram restored on homepage, footer and country pages. Preserve exact artwork, not old favicon.
Production visual audit run 45377974091 at 10:47 passed desktop 1574x870 and mobile 390x844: HTTP 200, 7/7 automatic sources current, 8 category icons, no horizontal overflow or browser errors, logo verified, severity above globe, CSP/HSTS/CORP verified, directory 238 and filter/reset passed, country profile map/favourite/export controls present. Mobile GDACS returned 30 alerts in last 24h; desktop was still checking at capture. World Bank GB endpoint returned unavailable, zero observations: not verified working. Do not misrepresent this as successful live data.

## Outstanding pull requests (not deployed)
- PR118 feature/country-art-left-briefing-20261124 head be9f8e25bbff31a0df29b895cc5f4789e8c99db4; run 45379324048 in progress at checkpoint. User's last two requested fixes: country intelligence middle card different from Earth observations, replace satellite texture with decorative geopolitical network SVG; fill desktop blank area beneath search with four current official publications and source freshness/links, reuse existing data, hide duplicate on mobile. Check tests and merge only if successful; inspect actual live screenshots and panel height/scroll.
- PR115 feature/country-comparison-timeline-weather-20261124 head a8a544215945a09636d45ca1707993f4ff66c2b1; corrected directory selector regression, run 45377905422 passed. Branch based before logo restoration: inspect merge conflict and preserve approved monogram, check combined tests before merge. Adds comparison, GDP growth/inflation, collection chronological filters, official weather warning links (not integrated live alerts).
- PR117 feature/production-regression-audit-20261124 head cb9293bf2e9e9c9d8f496e7e987fc17c2d86ba90; runs 45377974200 and 45377974091 passed. Audit only, can merge after checking combined main. Check World Bank response and audit actual live source coverage; no claims of complete verification yet.

## Resume order
1. Check PR118 CI and deployment; verify visual result on desktop and mobile; don't undo logo.
2. Reconcile and test outstanding PR115/117 against latest main. Verify live World Bank API (response structure, country code matching, multi-indicator request, licensing, timeout/redirect), fix explicitly unavailable state before claiming working.
3. Repeat production browser and source audit; test actual interactions, saved research and export, country directory, swipe panels, no blank gaps, no horizontal overflow, security headers. Source check freshness not incident verification. 
4. Continue roadmap in docs/ROADMAP_2026-11-22.md: integrated official weather warnings subject to access/licensing, installable PWA, optional notifications, UI cohesion, saved evidence, country profiles and reliable source expansion. User asks batches of five tasks, but fix defects before new features.
5. ReliefWeb access application submitted, response expected around 26 Nov but not guaranteed. UKMTO feed permission reminder 4 Dec 09:00; manual dated source links only until approval. No real-time tactical military tracking. Free-first, £0 additional expenditure; no accounts/paid features yet.

This branch is a saved handoff only, not a deployed change. Do not deploy merely to save a checkpoint.
